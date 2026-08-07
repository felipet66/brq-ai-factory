# Job Queue Flow

## Objetivo

Representar a arquitetura assíncrona local aprovada no
[`ADR-028`](ADR/ADR-028-JOB-QUEUE-BOUNDARY.md), sem introduzir execução paralela, retry ou fila
externa.

## Queue Lifecycle

```mermaid
stateDiagram-v2
    [*] --> QUEUED: enqueue
    QUEUED --> RUNNING: claimNext FIFO
    QUEUED --> CANCELLED: cancel ou shutdown
    RUNNING --> SUCCESS: Engine SUCCESS
    RUNNING --> FAILED: Engine FAILED ou falha técnica
    RUNNING --> CANCELLED: cancelamento reconhecido
    SUCCESS --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

Não existe retorno para `QUEUED`. Todo job possui `attempt: 1` e uma única entrega ao Worker.

## Worker

```mermaid
sequenceDiagram
    participant Queue as InMemoryJobQueue
    participant Worker as Execution Worker
    participant Repository as Execution Repository
    participant Engine as Execution Engine público
    participant Observability as Observability existente

    Queue->>Worker: ClaimedJob RUNNING
    Worker->>Repository: markJobRunning(jobId)
    Worker->>Engine: execute(ExecutionRequest, job signal)
    Engine->>Observability: lifecycle e métricas
    Engine->>Repository: lifecycle e resultado persistidos
    Engine-->>Worker: ExecutionResult ou ExecutionEngineError
    Worker->>Queue: complete / fail / cancel
    Queue-->>Worker: JobRecord terminal
    Worker->>Repository: markJobTerminal(status, queue finishedAt)
```

O Worker nunca chama Orchestrator ou agentes. Esses componentes permanecem atrás do Execution
Engine.

## HTTP Async Flow

```mermaid
sequenceDiagram
    actor User as Usuário
    participant Frontend
    participant API as HTTP API 2.0
    participant Dispatcher
    participant Queue as JobQueue
    participant Worker
    participant Repository

    User->>Frontend: Execute Workflow
    Frontend->>API: POST /api/executions
    API->>Dispatcher: dispatch(validated request)
    Dispatcher->>Repository: create QUEUED metadata
    Dispatcher->>Queue: enqueue payload in memory
    Queue-->>Dispatcher: JobRecord QUEUED
    Dispatcher-->>API: executionId + jobId
    API-->>Frontend: 202 Accepted
    Worker->>Queue: claimNext
    loop Polling sequencial
        Frontend->>API: GET /api/jobs/{jobId}
        API->>Repository: findByJobId
        Repository-->>API: persisted job metadata
        API-->>Frontend: QUEUED / RUNNING / terminal
    end
    Frontend->>Frontend: SUCCESS → /executions/{executionId}
```

## Job State Machine

```mermaid
flowchart TD
    A["Job metadata created"] --> B{"Queue accepting jobs?"}
    B -- No --> C["Persist CANCELLED"]
    B -- Yes --> D["QUEUED"]
    D --> E{"Claimed by the single worker?"}
    E -- Cancel / shutdown --> C
    E -- Yes --> F["RUNNING"]
    F --> G{"Public Engine outcome"}
    G -- Success --> H["SUCCESS"]
    G -- Functional or technical failure --> I["FAILED"]
    G -- Cooperative cancellation --> C
    C --> J["Terminal; payload purged"]
    H --> J
    I --> J
```

## Execution Dispatch

```mermaid
flowchart LR
    HTTP["POST adapter"] --> Identity["Engine identity reservation"]
    Identity --> Durable["ExecutionRecord + ExecutionJob"]
    Durable --> Queue["InMemoryJobQueue"]
    Queue --> Worker["Execution Worker"]
    Worker --> Persistent["Persistent Engine decorator"]
    Persistent --> Observed["Observed Engine decorator"]
    Observed --> Engine["Concrete Execution Engine"]
    Engine --> Workflow["Product Owner → Developer → QA"]
    Persistent --> Repository["Prisma Execution Repository"]
```

## Fronteiras de dados

Persistidos:

- `jobId`, `jobStatus`, `queuedAt`, início e término do job;
- metadata minimizada da execução, timeline, métricas, hashes, lineage e provenance já aprovados.

Somente em memória enquanto ativo:

- `ExecutionRequest` necessária ao Worker;
- `AbortController` do job.

Nunca armazenados pela fila:

- prompts, respostas do modelo, knowledge context, specifications completas, artifacts ou segredos.

Os eventos `job.*` são observacionais e separados da timeline de etapas do workflow. Nenhum
timestamp, polling ou evento participa dos hashes determinísticos.

O adapter local elimina o payload em estados terminais, mas mantém records e eventos técnicos pela
vida do processo para lookup e métricas. Política de retenção ou capacidade limitada pertence a um
adapter futuro e não é implementada nesta Sprint.
