# HTTP API Flow

## Objetivo

Documentar a camada HTTP implementada na Sprint 14 e a fronteira do adapter definida pelo
ADR-024. A API não é um serviço de domínio: ela transporta um `ExecutionRequest` até o
Execution Engine e devolve seu `ExecutionResult`.

## Fluxo completo de criação

```mermaid
sequenceDiagram
    autonumber
    actor Client as HTTP Client
    participant Route as Next.js Route Handler
    participant Guard as HTTP validation
    participant Runtime as App composition root
    participant Engine as Execution Engine public API
    participant Orchestrator as Orchestrator public API
    participant Result as ExecutionResult

    Client->>Route: POST /api/executions + JSON
    Route->>Route: generate requestId and start sanitized log
    Route->>Guard: validate media type, encoding, bytes, JSON and Zod contract
    Guard-->>Route: ExecutionRequest HTTP without IDs
    Route->>Runtime: getExecutionEngine()
    Runtime-->>Route: lazy immutable Engine instance
    Route->>Engine: execute(ExecutionRequest + requestId, same AbortSignal)
    Engine->>Orchestrator: execute(public WorkflowRequest)
    Orchestrator-->>Engine: WorkflowResult
    Engine->>Result: consolidate lifecycle, hashes, metrics, lineage and provenance
    Result-->>Route: validated public ExecutionResult
    Route->>Route: transport unchanged + finish sanitized log
    Route-->>Client: 200 { success, data, metadata, errors }
```

O Route Handler não enxerga nenhum agente ou componente interno. O composition root é bootstrap do
host: ele monta as factories públicas, mas não participa da chamada após fornecer o Engine.

## Fronteiras

```mermaid
flowchart LR
    HTTP["Request / Response"] --> API["apps/web/src/app/api"]
    API -->|"public execute()"| ENGINE["@brq/execution-engine"]
    RUNTIME["apps/web/src/server/runtime.ts"] -->|"provides"| ENGINE
    RUNTIME --> GRAPH["public factories of the existing graph"]

    API -. forbidden .-> AGENTS["Product Owner / Developer / QA"]
    API -. forbidden .-> ORCH["Orchestrator internals"]
    API -. forbidden .-> LOWER["Provider / Knowledge / Prompt / Runner / Validator / Generator"]
    API -. forbidden .-> DATA["Prisma / repositories / database"]
```

Não existe `core/ai-factory-runtime`. A composição concreta pertence à aplicação Next.js.

## Endpoints

### `GET /api/health`

```mermaid
sequenceDiagram
    actor Client
    participant Health as Health Route Handler
    Client->>Health: GET /api/health
    Health->>Health: read static API and Engine versions
    Health-->>Client: 200 status + version + engineVersion + contractVersion
```

O endpoint não acessa banco, IA, knowledge, runtime ou workflow.

### `POST /api/executions`

Recebe o contrato do Engine sem `requestId` e sem `executionId`. O adapter cria apenas o
`requestId`; o Engine continua sendo o único responsável por criar `executionId`.

Um resultado funcional `FAILED` é um resultado válido e retorna 200. Falhas técnicas são mapeadas
para respostas HTTP sanitizadas.

### `GET /api/executions/[id]`

```mermaid
flowchart TD
    GET["GET with id"] --> FORMAT{"execution-&lt;32 hex&gt;?"}
    FORMAT -->|"no"| BAD["400 INVALID_REQUEST"]
    FORMAT -->|"yes"| FUTURE["501 EXECUTION_LOOKUP_NOT_SUPPORTED"]
```

Não existe store em memória, repository ou banco oculto. O 501 mantém explícita a ausência de
consulta no MVP.

## Validação do payload

```mermaid
flowchart TD
    REQUEST["POST request"] --> TYPE{"application/json?"}
    TYPE -->|"no"| E415["415"]
    TYPE -->|"yes"| ENCODING{"identity encoding?"}
    ENCODING -->|"no"| E415
    ENCODING -->|"yes"| LENGTH{"Content-Length ≤ 512 KiB?"}
    LENGTH -->|"no"| E413["413"]
    LENGTH -->|"yes"| STREAM["read stream with real byte counter"]
    STREAM -->|"over limit"| E413
    STREAM --> UTF8{"valid UTF-8 and JSON?"}
    UTF8 -->|"no"| E400OR415["400 or 415"]
    UTF8 --> ZOD{"strict Zod contract?"}
    ZOD -->|"no"| E400["400"]
    ZOD -->|"yes"| ENGINE["Execution Engine"]
```

Campos desconhecidos, query parameters e IDs de etapa duplicados são rejeitados antes do Engine.

## Contratos de resposta

Sucesso:

```json
{
  "success": true,
  "data": {},
  "metadata": {
    "requestId": "request-...",
    "apiVersion": "1.0.0"
  },
  "errors": []
}
```

Erro:

```json
{
  "success": false,
  "data": null,
  "metadata": {
    "requestId": "request-...",
    "apiVersion": "1.0.0"
  },
  "errors": [{ "code": "INVALID_REQUEST", "message": "...", "path": "body" }]
}
```

`executionId` é incluído nos metadados quando já existe. Causas, stacks e mensagens internas não
são retornadas.

## Status HTTP

| Código | Uso                                                      |
| -----: | -------------------------------------------------------- |
|    200 | health ou `ExecutionResult` resolvido                    |
|    400 | JSON, query, path ou contrato inválido                   |
|    405 | método não permitido, com `Allow`                        |
|    408 | cancelamento propagado                                   |
|    413 | payload acima de 512 KiB                                 |
|    415 | media type, encoding ou bytes incompatíveis              |
|    500 | falha técnica ou violação do resultado público           |
|    501 | lookup por ID ainda não suportado                        |
|    503 | composition root ou configuração do runtime indisponível |

## Segurança e observabilidade

Todas as respostas são JSON, `no-store`, `nosniff`, negam framing e usam CSP, referrer policy,
permissions policy e resource policy restritivas. A Sprint não habilita CORS, autenticação,
autorização ou rate limit.

Eventos `http.request.started`, `http.request.completed` e `http.request.failed` registram somente
requestId, endpoint estático, método, status, duração, executionId quando conhecido e código de
erro. Body, URL completa, query, headers, prompts, specifications, artifacts, respostas do modelo
e resultados nunca são registrados pela API.

## Determinismo

O adapter não recalcula nem altera hashes, lineage, provenance ou métricas do `ExecutionResult`.
O `requestId` criado por chamada integra o `ExecutionRequest` entregue ao Engine; a partir dessa
entrada completa, toda sequência e todos os hashes continuam determinísticos. Timestamps e duração
HTTP permanecem somente observacionais.

## Fora do escopo

Persistência, lookup real, autenticação, autorização, filas, execução assíncrona, retry, scheduler,
workers, concorrência, cache, rate limit, websocket, SSE, upload, download, OpenAPI, SDK, CLI,
frontend funcional, Playwright, monitoramento distribuído e qualquer item da Sprint 15.
