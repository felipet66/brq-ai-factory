# Frontend MVP Flow

## Objetivo

Documentar a interface implementada na Sprint 15 e a fronteira definida pelo
[ADR-025](ADR/ADR-025-FRONTEND-MVP.md). O Frontend é um Presentation Adapter: ele recebe dois campos
do usuário, chama exclusivamente a API HTTP e exibe um resumo seguro do resultado.

## Fluxo completo

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuário
    participant Page as Frontend Next.js
    participant Client as HTTP execution-client
    participant API as POST /api/executions
    participant Engine as Execution Engine
    participant Workflow as Orchestrator Workflow

    User->>Page: Project Name + Objective
    Page->>Page: validar campos e entrar em loading
    Page->>Client: executeWorkflow(form input)
    Client->>Client: mapear demand + configuração MVP estável
    Client->>API: POST JSON
    API->>Engine: execute(ExecutionRequest + requestId)
    Engine->>Workflow: Product Owner → Developer → QA
    Workflow-->>Engine: WorkflowResult
    Engine-->>API: ExecutionResult
    API-->>Client: envelope HTTP 200
    Client->>Client: ExecutionResult → ExecutionSummary
    Client-->>Page: somente ExecutionSummary
    Page-->>User: status, duração, readiness, hashes, lineage e provenance
```

O `ExecutionResult` bruto termina no client HTTP. Specifications, artifacts, prompts, contextos,
knowledge, respostas da IA, timeline completa e logs não entram em props nem no estado React.

## Fronteira de dependências

```mermaid
flowchart LR
    USER["Usuário"] --> UI["Frontend MVP<br/>apps/web/src/app"]
    UI --> CLIENT["execution-client<br/>DTOs locais"]
    CLIENT --> HTTP["HTTP API pública<br/>POST /api/executions"]
    HTTP --> ENGINE["Execution Engine"]
    ENGINE --> WORKFLOW["Workflow completo"]

    UI -. forbidden .-> CORE["Core / Orchestrator / Agents"]
    CLIENT -. forbidden .-> SERVER["Runtime e internals da API"]
    UI -. forbidden .-> PROVIDER["AI Provider e componentes inferiores"]
```

Somente o client interno conhece a forma do envelope HTTP. Componentes recebem o contrato local
`ExecutionSummary` e não importam contratos do núcleo.

## Mapeamento do formulário

```text
FrontendExecutionInput
├── projectName → demand.title
└── objective   → demand.description

HTTP client configuration
├── workflowId técnico gerado no submit
├── Product Owner: agentExecutionId + agentVersion + model
├── Developer: agentExecutionId + agentVersion + model
└── QA: agentExecutionId + agentVersion + model
```

Project Name não representa uma entidade persistida. Ele nomeia somente a demanda enviada à API.

Os IDs e metadados técnicos no browser existem porque a API `1.0.0` ainda os exige. Essa é uma
limitação temporária, não a responsabilidade arquitetural final: uma evolução futura e versionada
do contrato deverá mover esses defaults para configuração confiável no backend. A Sprint 15 não
altera o contrato existente.

## Contrato de apresentação

```text
ExecutionSummary
├── executionId
├── status
├── durationMs
├── readiness | null
├── hashes
├── lineage | null (resumo de outputs e handoffs)
└── provenance | null (resumo por estágio)
```

- `durationMs` vem de `ExecutionResult.metrics.observed.totalDurationMs`;
- readiness vem do resultado público do QA e pode não estar disponível;
- lineage resume a quantidade de outputs e handoffs verificados;
- provenance resume estágios, versões dos agentes, outcomes e readiness;
- hashes são apenas transportados, nunca recalculados.

O payload completo permanece visível na inspeção de rede do browser porque a API o transporta. A
minimização desta Sprint ocorre imediatamente depois do parse, antes de qualquer dado chegar ao
React. Reduzir o payload na origem exige evolução futura do contrato HTTP.

## Estados da interface

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> loading: submit válido
    loading --> success: envelope válido
    loading --> error: HTTP, rede ou envelope inválido
    success --> loading: nova submissão explícita
    error --> loading: nova submissão explícita
```

Um HTTP 200 cujo resultado possui status `FAILED` segue para `success`: o transporte concluiu e a
execução possui resultado terminal válido. Não existe polling, refresh automático ou retry.

## Componentes

```text
HomePage — Server Component de composição
└── ExecutionExperience — Client Component e estado local
    ├── ExecutionForm
    ├── LoadingState
    ├── ErrorState
    └── ExecutionResult
```

Os componentes são pequenos, acessíveis e não contêm lógica de domínio. O botão fica indisponível
durante loading, estados assíncronos são anunciados semanticamente e erros exibem apenas mensagens
sanitizadas.

## Segurança

- nenhum segredo ou acesso ao provider chega ao navegador;
- não há `dangerouslySetInnerHTML` nem interpretação de Markdown/HTML;
- todo valor remoto é renderizado por interpolação textual do React;
- requests, responses e summaries não são registrados em console ou storage;
- erros internos e payloads proibidos não são exibidos;
- uso restrito a ambientes permitidos e dados sintéticos enquanto autenticação, autorização e
  rate limit não existirem.

## Testes

Vitest e Testing Library cobrem formulário, validação, loading, sucesso, resultado funcional
`FAILED`, erros HTTP/rede/contrato, projeção do client, componentes e acessibilidade. Testes de
fronteira rejeitam imports do núcleo, `fetch` fora do client e `dangerouslySetInnerHTML`.

Playwright, browser real e chamadas reais ao provider não integram esta Sprint.

## Fora do escopo

Persistência, consulta por ID, páginas adicionais, dashboard, artifacts completos, logs, polling,
websocket, SSE, cache, autenticação, autorização, rate limit, cancelamento pela UI, retry, revisão
humana, upload, download, Playwright e qualquer item da Sprint 16.
