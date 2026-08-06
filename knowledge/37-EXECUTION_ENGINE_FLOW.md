# Execution Engine Flow

## Objetivo

Documentar o ciclo de vida efêmero implementado na Sprint 13 e a fronteira do
`@brq/execution-engine` definida pelo ADR-023.

## Sequência completa

```mermaid
sequenceDiagram
    autonumber
    actor Caller
    participant Engine as Execution Engine
    participant Orchestrator
    participant Workflow as WorkflowResult
    participant Result as ExecutionResult

    Caller->>Engine: execute(ExecutionRequest, AbortSignal?)
    Engine->>Engine: validate request and create deterministic executionId
    Engine->>Engine: CREATED → RUNNING
    Engine->>Orchestrator: execute(public WorkflowRequest, same AbortSignal)
    Orchestrator-->>Workflow: WorkflowResult
    Workflow-->>Engine: public validated result
    Engine->>Engine: correlate IDs and hashes
    Engine->>Result: consolidate lifecycle, metrics, hashes, lineage and provenance
    Result-->>Caller: ExecutionResult or ExecutionEngineError.result
```

O Engine não enxerga Product Owner, Developer, QA ou qualquer componente usado internamente pelo
Orchestrator.

## Fronteira de dependências

```mermaid
flowchart TB
    Caller["Caller futuro"] --> Engine["@brq/execution-engine"]
    Engine --> PublicOrchestrator["Public @brq/orchestrator API"]
    PublicOrchestrator --> WorkflowResult
    WorkflowResult --> Engine
    Engine --> ExecutionResult

    Engine -. forbidden .-> Agents["Product Owner / Developer / QA"]
    Engine -. forbidden .-> Lower["Provider / Knowledge / Prompt / Runner / Validator / Generator"]
    Engine -. forbidden .-> Persistence["Prisma / repositories / database"]
```

Os vínculos pontilhados representam dependências proibidas, não chamadas de runtime.

## Criação da identidade

```text
ExecutionRequest sem executionId
  → validação Zod estrita
  → executionRequestHash canônico
  → SHA-256({ contractVersion, executionRequestHash })
  → execution-<32 primeiros caracteres hex>
```

O ID não utiliza `Math.random()`, `Date.now()`, UUID, contador, processo externo ou estado global.

## Máquina de estados

```mermaid
stateDiagram-v2
    [*] --> CREATED
    CREATED --> RUNNING
    CREATED --> CANCELLED: signal previamente abortado
    RUNNING --> SUCCESS
    RUNNING --> FAILED
    RUNNING --> CANCELLED
    SUCCESS --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

Não existe `REQUIRES_REVIEW`, retomada ou transição a partir de estado terminal.

## Resultado

```mermaid
flowchart LR
    WR["WorkflowResult | null"] --> ER["ExecutionResult"]
    TL["Timeline + startedAt + finishedAt"] --> ER
    META["engineVersion + contractVersion + attempt"] --> ER
    LM["Execution metrics"] --> ER
    LINEAGE["Lineage"] --> ER
    PROVENANCE["Provenance"] --> ER
    HASHES["Execution hashes"] --> ER
    FAILURE["Sanitized failure | null"] --> ER
```

Lineage preserva continuidade das specifications. Provenance preserva evidências técnicas. Os
dois contratos são promovidos do `WorkflowResult` sem mistura ou interpretação pelo Engine.

## Falhas e cancelamento

```mermaid
flowchart TD
    Start["Validated ExecutionRequest"] --> Aborted{"Signal already aborted?"}
    Aborted -->|yes| CancelBefore["CREATED → CANCELLED / no Orchestrator call"]
    Aborted -->|no| Running["CREATED → RUNNING"]
    Running --> Call["Call Orchestrator exactly once"]
    Call -->|SUCCESS| Success["ExecutionResult SUCCESS"]
    Call -->|functional FAILED| FailedResult["Return ExecutionResult FAILED"]
    Call -->|technical error| FailedError["Throw ExecutionEngineError with FAILED result"]
    Call -->|cancelled| CancelError["Throw ExecutionEngineError with CANCELLED result"]
```

Um `WorkflowResult` parcial somente é preservado depois de validado e correlacionado. Na ausência
de resultado válido, lineage, provenance, métricas e hashes do workflow permanecem nulos.

## Determinismo e observabilidade

Participam do `executionHash`:

- `engineVersion` e `contractVersion`;
- execution e workflow IDs;
- attempt e status;
- request hashes;
- workflow, lineage e provenance hashes;
- códigos estáveis de falha.

Não participam:

- `startedAt` e `finishedAt`;
- timeline e timestamps;
- durações;
- métricas;
- mensagens de erro;
- conteúdo de requests, specifications ou artifacts.

## Logs

Eventos: `execution.created`, `execution.started`, `execution.completed`, `execution.failed` e
`execution.cancelled`.

O contexto contém somente IDs, estado/status, versões, duração, hashes, métricas, resumo de
lineage e erro sanitizado. Demanda, contexto do usuário, `WorkflowRequest`, `WorkflowResult`,
prompts, specifications, artifacts e respostas nunca são registrados.

## Fora do escopo

Persistência, repositories, Prisma, retry, resume, revisão humana, filas, scheduler, workers,
concorrência, paralelismo, consulta ou cancelamento por ID, API, frontend, websocket, autenticação,
autorização, eventos externos, execução de testes, geração de código e qualquer item da Sprint 14.
