# ADR-028 — Job Queue Boundary and Local Asynchronous Dispatch

## Status

Accepted

## Date

2026-08-07

## Context

Até a Sprint 17, `POST /api/executions` mantinha a conexão HTTP aberta enquanto o Execution Engine
coordenava todo o workflow. O histórico e a timeline já são duráveis, mas o transporte síncrono
acopla a latência dos agentes à resposta HTTP e não oferece uma fronteira substituível de dispatch.

A Sprint 18 precisa aceitar a execução imediatamente, processá-la em uma fila local e permitir que
o cliente consulte o job. Redis, RabbitMQ, Kafka, BullMQ, Temporal, filas externas, retry e workers
externos continuam fora do escopo.

Existe uma restrição adicional: o ADR-023 torna o Execution Engine proprietário do
`executionId`, mas o contrato assíncrono precisa devolver esse ID antes de chamar `execute()`. A
API e a fila não podem duplicar o algoritmo privado de hashing.

## Decision

Criar dois workspaces privados e independentes:

```text
@brq/job-queue
@brq/execution-worker
```

`@brq/job-queue` define o port `JobQueue`, os contratos e schemas do lifecycle, eventos, métricas e
o adapter `InMemoryJobQueue`. A fila é FIFO, process-local, possui um único consumidor na Sprint 18
e mantém cada job com `attempt: 1`.

`@brq/execution-worker` contém:

- o dispatcher que reserva a identidade, registra o job e o enfileira;
- o worker que consome FIFO e chama somente a API pública do Execution Engine;
- a propagação de cancelamento por `AbortController` local;
- a consolidação do estado terminal do job, sem retry ou requeue.

O host da aplicação compõe e mantém singletons locais da fila e do worker:

```text
HTTP Adapter
  → Execution Dispatcher
    → InMemoryJobQueue
      → Execution Worker
        → Persistent / Observed Execution Engine
          → Execution Repository
```

O Worker recebe o Engine já decorado pelo host. Assim, os mecanismos aprovados de persistência e
observabilidade continuam sendo executados sem duplicar lifecycle, timeline, métricas ou regras do
workflow dentro do Worker.

## Execution identity reservation

O Execution Engine passa a expor `deriveExecutionIdentity(request)`, uma capacidade pública,
pura e somente leitura. Ela:

- valida a mesma `ExecutionRequest` usada por `execute()`;
- utiliza exatamente o algoritmo interno e a versão contratual do Engine;
- devolve `executionId` e `executionRequestHash` imutáveis;
- não inicia o Orchestrator, não muda estado e não registra observação;
- não aceita identidade fornecida pelo caller.

`execute()` usa a mesma função interna que sustenta essa API, impedindo drift. Esta decisão refina
somente o momento de exposição da identidade descrito nos ADRs 023 e 027; o Engine permanece seu
único proprietário.

O dispatcher cria `jobId` deterministicamente no namespace `job-<32 hex>`, com correspondência
um-para-um ao `executionId`. Fila, API e Frontend nunca calculam `executionId`.

## Queue contracts and lifecycle

O lifecycle permitido é:

```text
QUEUED → RUNNING → SUCCESS
                 → FAILED
                 → CANCELLED
QUEUED → CANCELLED
```

Estados terminais são imutáveis. Não existem `RUNNING → QUEUED`, retry, requeue, backoff,
scheduling ou segunda tentativa. Duplicidade de `jobId`, `workflowId` ou `executionId` é rejeitada
durante a vida do adapter.

`JobRecord` é metadata-only e pode ser projetado para HTTP. `ClaimedJob` é restrito ao Worker e
contém a `ExecutionRequest` necessária ao dispatch. O payload permanece somente em memória enquanto
o job está ativo e é removido ao alcançar qualquer estado terminal.

A fila publica eventos imutáveis e tipados:

```text
job.created
job.started
job.finished
job.failed
job.cancelled
```

Os eventos e logs usam allowlist de `jobId`, `executionId`, `workflowId`, status, timestamp,
duração e código sanitizado. Demanda, prompts, knowledge, specifications, respostas, artifacts,
segredos e erros crus são proibidos.

`QueueMetrics` consolida contagens por estado, total de jobs, payloads ativos e disponibilidade para
novos enfileiramentos. Métricas e timestamps são observacionais e não participam dos hashes do
Engine ou do workflow.

## Execution Repository integration

O agregado `ExecutionRecord` recebe uma relação normalizada e opcional com `ExecutionJob`:

```text
ExecutionJob
- jobId
- executionRecordId
- status
- queuedAt
- startedAt
- finishedAt
```

Os timestamps do job não substituem os timestamps da execução:

- `queuedAt`: aceitação pelo dispatcher;
- `ExecutionJob.startedAt`: aquisição pelo Worker;
- `ExecutionRecord.startedAt`: início efetivo do Engine;
- `ExecutionRecord.finishedAt`: término efetivo do Engine;
- `ExecutionJob.finishedAt`: término observado do job.

O dispatcher cria o `ExecutionRecord` e o `ExecutionJob` antes de tornar o payload consumível. O
coordinator persistente pode reutilizar somente um record `CREATED` cuja identidade reservada
corresponda à request e cujo job esteja `RUNNING`. Outros registros preexistentes continuam sendo
conflito.

O resultado terminal do Engine atualiza o agregado da execução. Em seguida, o Worker projeta no
repository o `status` e o `finishedAt` devolvidos pela transição terminal da fila. Assim,
`ExecutionRecord.finishedAt` continua representando o Engine e `ExecutionJob.finishedAt`
representa o encerramento observado do job, sem participar de hashes.

O repository nunca persiste a `ExecutionRequest`, o payload da fila, `AbortSignal`, prompts,
respostas, knowledge ou conteúdo funcional dos agentes.

Não existe transação distribuída entre SQLite e memória. Se o registro durável for criado e a fila
recusar o enqueue, o dispatcher encerra o job persistido como `CANCELLED`. Falha depois dos efeitos
do Engine nunca autoriza uma nova execução.

## Cancellation and shutdown

O `AbortSignal` da requisição HTTP termina na aceitação do POST e não controla o job. Um job em
execução possui `AbortController` próprio do Worker.

- cancelamento de `QUEUED` remove o job da fila, persiste `CANCELLED` e não chama o Engine;
- cancelamento de `RUNNING` solicita aborto cooperativo e aguarda o resultado autoritativo do
  Engine;
- shutdown rejeita novos jobs, cancela os ainda enfileirados, propaga aborto ao job ativo e aguarda
  sua conclusão cooperativa;
- `start()` e `shutdown()` são idempotentes.

O workspace não instala handlers globais de processo. O host controla o singleton e seu ciclo.

## Observability boundary

Os eventos `job.*` permanecem na união `QueueEvent`; eles não são adicionados a
`ExecutionObservabilityEvent`. O contrato do ADR-026 descreve etapas do workflow e exige semântica
de timeline diferente da fila. O logger do host recebe os eventos sanitizados, enquanto Timeline e
Stage Metrics continuam sendo produzidos pelo decorator existente sem alteração.

## HTTP and Frontend

O contrato HTTP evolui para `2.0.0`:

- `POST /api/executions` devolve `202 Accepted` com `executionId`, `jobId` e `QUEUED`;
- `GET /api/jobs/{id}` lê o estado persistido e devolve somente metadados do job;
- endpoints de histórico e timeline continuam consultando o Execution Repository.

O Frontend envia uma única vez, consulta sequencialmente o job e nunca repete o workflow. Ele
renderiza Fila, Executando e Finalizado; em `SUCCESS`, navega para `/executions/{executionId}`. O
polling termina em estado terminal, aborto ou unmount.

## Dependency boundaries

`@brq/job-queue` não conhece repository, Prisma, Observability, agentes, Orchestrator ou aplicações.

`@brq/execution-worker` depende somente das APIs públicas de Job Queue, Execution Engine,
Execution Repository e Shared. Ele não pode importar agentes, Orchestrator, Prisma, Observability
ou componentes inferiores do pipeline de IA.

Somente `apps/web/src/server/runtime.ts` instancia o adapter em memória, o Worker e o adapter
Prisma.

## Consequences

- o POST deixa de carregar a latência do workflow;
- FIFO e um único consumidor preservam ordem e ausência de concorrência nesta Sprint;
- o resultado passa a ser consultado pelo repository;
- restart perde payloads queued/running, embora seus metadados persistidos permaneçam;
- registros `QUEUED` ou `RUNNING` podem ficar stale após crash, pois recovery é proibido;
- records e eventos técnicos terminais permanecem em memória durante a vida do adapter; retenção,
  eviction e capacidade limitada ficam para uma decisão futura;
- múltiplas instâncias possuem filas independentes;
- hosts serverless podem suspender trabalho depois do `202`; esta implementação é local,
  single-process e não é uma garantia de produção distribuída;
- eventos, cadência de polling e timestamps não alteram hashes, lineage, provenance ou decisões.

## Out of scope

- Redis, RabbitMQ, Kafka, BullMQ, Temporal, SQS ou Pub/Sub;
- retry, requeue, backoff, scheduler, cron ou recovery;
- threads, workers externos e background services distribuídos;
- autenticação, autorização, WebSocket, SSE ou streaming;
- Playwright;
- alteração de agentes, prompts, output contracts ou Prompt Builder;
- hotfix de Structured Outputs do Developer Agent;
- qualquer item da Sprint 19.
