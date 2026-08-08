# Live Agent Workspace & Factory Visualization Flow

## Objetivo

Documentar a Factory View da Sprint 21 e a fronteira definida pelo
[ADR-031](ADR/ADR-031-FACTORY-VISUALIZATION-BOUNDARY.md). A rota
`/executions/[id]/factory` transforma read models públicos e sanitizados em uma sala de controle
visual sem executar agentes, inventar atividade ou acessar conteúdo funcional.

## Factory View Architecture

```mermaid
flowchart LR
    USER["Authenticated USER or ADMIN"] --> PAGE["/executions/[id]/factory"]
    PAGE --> CONTROLLER["Factory live-data controller"]
    CONTROLLER --> CLIENTS["Internal HTTP clients"]
    CLIENTS --> DETAIL["GET execution detail"]
    CLIENTS --> JOB["GET job"]
    CLIENTS --> TIMELINE["GET execution timeline"]
    DETAIL --> MAPPER["Deterministic Factory mapper"]
    JOB --> MAPPER
    TIMELINE --> MAPPER
    MAPPER --> VM["Immutable FactoryViewModel"]
    VM --> UI["AI Software Factory Control Room"]

    UI -. "cannot reach" .-> FORBIDDEN["Agents / prompts / runtime / OpenAI"]
```

`FactoryViewModel` é a única fronteira da camada de apresentação. O controller e os clients
conhecem DTOs HTTP; os componentes visuais conhecem apenas projeções do view model.

## Execution to FactoryViewModel

```mermaid
flowchart TB
    DETAIL["Execution detail"] --> EXECUTION["Identity, project, status and duration"]
    DETAIL --> JOBMETA["Job metadata"]
    DETAIL --> HASHES["Final hashes"]
    DETAIL --> LINEAGE["Verified lineage"]
    DETAIL --> PROVENANCE["Agent provenance and artifact hashes"]

    SNAPSHOT["Observability snapshot"] --> EVENTS["Typed events"]
    SNAPSHOT --> STAGES["Knowledge, PO, Developer and QA stages"]
    SNAPSHOT --> METRICS["Stage metrics"]
    SNAPSHOT --> SUMMARY["Execution summary"]

    EXECUTION --> MAP["Pure allowlisted mapper"]
    JOBMETA --> MAP
    HASHES --> MAP
    LINEAGE --> MAP
    PROVENANCE --> MAP
    EVENTS --> MAP
    STAGES --> MAP
    METRICS --> MAP
    SUMMARY --> MAP
    MAP --> VM["FactoryViewModel v1.0.0"]
```

O mapper não lê clocks globais, browser storage, internals do servidor ou conteúdo de execução.
Elapsed live é observacional e não participa de hashes nem de decisões do workflow.

## Agent State Mapping

```mermaid
flowchart LR
    PENDING["Timeline PENDING"] --> WAITING["Factory WAITING"]
    RUNNING["Timeline RUNNING"] --> WORKING["Factory WORKING"]
    SUCCESS["Timeline SUCCESS"] --> COMPLETED["Factory COMPLETED"]
    FAILED_IN["Timeline FAILED"] --> FAILED_OUT["Factory FAILED"]
    CANCELLED_IN["Timeline CANCELLED"] --> CANCELLED_OUT["Factory CANCELLED"]
    SKIPPED_IN["Timeline SKIPPED"] --> SKIPPED_OUT["Factory SKIPPED"]
    ABSENT["Terminal execution without snapshot"] --> NOTOBS["Factory NOT_OBSERVED"]
```

Knowledge usa o mesmo status público, mas é um estágio de sistema. Não existem estados live
`VALIDATING` ou `GENERATING_ARTIFACTS`: os eventos atuais não comprovam essas transições. Métricas
retrospectivas de validação e artifact generation continuam disponíveis quando registradas.

### Visual asset projection

A Factory Floor aplica uma segunda projeção, exclusivamente visual, sobre os estados autoritativos
do `FactoryViewModel`. Ela seleciona um asset versionado por papel sem criar novos eventos, atrasar
transições ou alterar o status técnico exibido:

| Evidência pública                                                      | Estado visual                                | Asset                           |
| ---------------------------------------------------------------------- | -------------------------------------------- | ------------------------------- |
| execução ainda não iniciada                                            | `IDLE`                                       | `01-idle.png`                   |
| estágio futuro durante execução                                        | `WAITING`                                    | `05-waiting.png`                |
| estágio `WORKING`                                                      | `WORKING`                                    | `03-working.png`                |
| source concluído e handoff primário `OBSERVED` para target trabalhando | `HANDOFF`                                    | `04-handoff.png`                |
| estágio `COMPLETED` fora de handoff ativo                              | `SUCCESS`                                    | `06-success.png`                |
| estágio `FAILED`                                                       | `ERROR`                                      | `07-error.png`                  |
| `CANCELLED`, `SKIPPED` ou `NOT_OBSERVED`                               | apresentação específica e texto autoritativo | `07-error.png` ou `01-idle.png` |

`02-analyzing.png` permanece deliberadamente reservado. O contrato observacional atual não oferece
evidência suficiente para distinguir análise de trabalho, e a UI não utiliza timers para simular
essa granularidade. Developer e QA usam PNGs com fundo transparente preparados visualmente; essa
normalização não participa de estados, contratos, hashes ou decisões do workflow.

## Software Factory Line

```mermaid
flowchart LR
    KNOWLEDGE["System stage<br/>Knowledge"] --> PO["Product Owner<br/>station"]
    PO -->|"ProductOwnerSpecification"| DEV["Developer<br/>station"]
    DEV -->|"TechnicalSpecification"| QA["QA<br/>station"]
    QA --> RESULT["Workflow result"]
```

No desktop, essa é a linha horizontal da fábrica. No mobile, o CSS reorganiza os mesmos elementos
em uma sequência vertical e preserva a ordem semântica.

## Handoff Flow

```mermaid
flowchart TB
    PO["Product Owner"] -->|"primary: ProductOwnerSpecification"| DEV["Developer"]
    DEV -->|"primary: TechnicalSpecification"| QA["QA"]
    PO -. "supplemental: ProductOwnerSpecification" .-> QA

    PUBLIC["Public stage transitions"] --> OBSERVED["OBSERVED connection"]
    LINEAGE["Lineage tuple with verified true"] --> VERIFIED["VERIFIED connection"]
    FAILURE["Source failed or target skipped"] --> BLOCKED["BLOCKED connection"]
    NONE["No real evidence"] --> PENDING["PENDING connection"]
```

O handoff suplementar Product Owner → QA aparece no painel do QA, sem criar uma conexão diagonal
na linha principal. Como não existe `handoffAt`, a UI apresenta somente um instante observado,
baseado em `target.startedAt` ou, como fallback, `source.finishedAt`, e identifica essa base.

## Live Activity Flow

```mermaid
flowchart LR
    JOB["Job status and timestamps"] --> DICTIONARY["Fixed activity dictionary"]
    EVENTS["Typed observability events"] --> DICTIONARY
    DICTIONARY --> ORDER["Timestamp + source priority + sequence + stable ID"]
    ORDER --> FEED["Accessible activity feed"]

    RESPONSE["AI response"] -. "never" .-> FEED
    SPEC["Specifications"] -. "never" .-> FEED
    PROMPT["Prompt or Knowledge content"] -. "never" .-> FEED
```

Exemplos de textos fixos são “Execution queued”, “Knowledge loading started”, “Knowledge loaded”,
“Developer started” e “Execution failed”. Handoffs e artifacts não ganham entradas cronológicas
porque seus contratos não possuem timestamps próprios.

## Phase-aware Polling

```mermaid
stateDiagram-v2
    [*] --> ACCEPTED: POST accepted
    ACCEPTED --> QUEUED: navigate to Factory
    QUEUED --> QUEUED: poll GET job
    QUEUED --> RUNNING: job RUNNING
    RUNNING --> RUNNING: poll GET timeline and accept newer revision
    RUNNING --> TERMINAL: SUCCESS, FAILED or CANCELLED
    QUEUED --> TERMINAL: job terminal before timeline
    TERMINAL --> REFRESH: refresh execution detail once
    REFRESH --> STOPPED: stop polling
    QUEUED --> SUSPENDED: tab hidden
    RUNNING --> SUSPENDED: tab hidden
    SUSPENDED --> QUEUED: visible and job not started
    SUSPENDED --> RUNNING: visible and execution running
    QUEUED --> STOPPED: unmount, abort or transport failure
    RUNNING --> STOPPED: unmount, abort or transport failure
```

Existe no máximo uma consulta em andamento. O polling apenas lê estado, nunca repete o POST e
nunca representa retry de job, workflow ou agente. Uma Timeline ainda ausente durante a transição
inicial é tratada como estado observacional esperado.

## Security Boundary

```mermaid
flowchart TD
    REQUEST["Factory page or API request"] --> SESSION{"Authenticated?"}
    SESSION -- "No" --> UNAUTH["Login redirect or 401"]
    SESSION -- "Yes" --> ACCESS{"Repository capability"}
    ACCESS -- "OWNER" --> OWN["Read own execution"]
    ACCESS -- "GLOBAL_READ_ONLY" --> GLOBAL["ADMIN read"]
    ACCESS -- "Cross-owner USER" --> HIDDEN["404"]
    OWN --> ALLOWLIST["Safe read-model allowlist"]
    GLOBAL --> ALLOWLIST
    ALLOWLIST --> VM["FactoryViewModel"]

    SENSITIVE["Prompts / specifications / responses / artifact content / secrets"]
    SENSITIVE -. "excluded" .-> VM
```

O Playground permanece ADMIN-only e isolado. A Factory pode oferecer um link genérico para ele
somente a ADMIN, sem transferir conteúdo, hashes de candidato ou contexto da execução.

## Frontend Component Flow

```mermaid
flowchart TB
    EXPERIENCE["FactoryExperience"] --> LIVE["Factory live-data controller"]
    LIVE --> MAPPER["FactoryViewModel mapper"]
    MAPPER --> WORKSPACE["FactoryWorkspace"]
    WORKSPACE --> HEADER["ExecutionHeader"]
    WORKSPACE --> PROGRESS["FactoryProgress"]
    WORKSPACE --> KNOWLEDGE["KnowledgeStage"]
    WORKSPACE --> PROJECTOR["Pure visual-state projector"]
    PROJECTOR --> STATIONS["AgentStation × 3"]
    STATIONS --> AVATARS["Versioned role avatars"]
    STATIONS --> CONNECTIONS["AgentConnection"]
    STATIONS --> DETAILS["AgentDetailPanel"]
    DETAILS --> ARTIFACTS["ArtifactCard"]
    WORKSPACE --> ACTIVITY["FactoryActivityFeed"]
    WORKSPACE --> STATES["Loading and error states"]
```

O painel de detalhes é não modal. No desktop ocupa a lateral da sala de controle; no mobile fica
abaixo da estação selecionada. Status textual, foco visível e ordem de tabulação permanecem
independentes de animação e cor.

## Visual behavior

- a linha PO → Developer → QA ocupa um único piso visual, com personagens como foco principal;
- `WAITING`: personagem atenuado e estação estática em slate;
- `WORKING`: personagem em atividade, energia amber e pulso discreto;
- `HANDOFF`: pose específica no source somente enquanto o handoff `OBSERVED` possui target trabalhando;
- `COMPLETED`: personagem de sucesso e confirmação teal;
- `FAILED`: personagem de erro e destaque vermelho sem flashing;
- `CANCELLED`, `SKIPPED` e `NOT_OBSERVED`: estados textuais distintos;
- handoff `OBSERVED`: movimento unidirecional sutil enquanto houver trabalho real no target;
- `prefers-reduced-motion`: remove pulse, deslocamentos e transições decorativas.

Progresso geral é representado pela situação real das estações, nunca por percentual estimado.

## Limitações explícitas

- não há fase live de validação ou geração de artifacts;
- artifact cards não possuem filename, tipo, media type ou conteúdo;
- handoff não possui timestamp autoritativo;
- polling não oferece atualização push;
- nenhum estado, mensagem, conversa ou atividade é produzido por IA;
- não existe endpoint agregado, novo workspace, dependency visual ou item da Sprint 22.
