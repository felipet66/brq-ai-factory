# ADR-023 — Execution Engine Boundary and Ephemeral Execution Lifecycle

## Status

Accepted

## Date

2026-08-05

## Context

O ADR-022 consolidou o workflow sequencial Product Owner → Developer → QA atrás da API pública
do Orchestrator. A plataforma ainda precisa de uma fronteira que crie a identidade de uma
execução, controle seu ciclo de vida e converta `WorkflowResult` em `ExecutionResult`, sem
antecipar persistência, API, filas ou retry.

O ADR-011 reserva `core/execution-engine/` para essa responsabilidade. Os estados persistentes do
Shared Layer incluem revisão humana e retomada, mas essas transições não pertencem ao ciclo local
e efêmero da Sprint 13.

## Decision

Implementar o workspace privado `@brq/execution-engine` em `core/execution-engine/`. Ele é o único
componente de produção autorizado a iniciar `Orchestrator.execute()` e depende funcionalmente
somente do entrypoint público `@brq/orchestrator`.

O caller fornece `ExecutionRequest` sem `executionId`. O Engine valida o request, calcula seu hash
canônico e cria um identificador determinístico no formato `execution-<32 hex>`, derivado do
`executionRequestHash` e de `contractVersion`. Não há relógio, contador global, UUID ou
aleatoriedade na identidade.

O ciclo de vida é local:

```text
CREATED → RUNNING → SUCCESS | FAILED | CANCELLED
CREATED → CANCELLED
```

Cada execução possui `attempt: 1` e realiza no máximo uma invocação do Orchestrator. Não existe
retomada, revisão humana, retry, backoff ou transição a partir de estado terminal.

O Engine compõe um `WorkflowRequest` público com o `executionId` criado, propaga o mesmo
`AbortSignal`, valida o `WorkflowResult` com o schema público e verifica `executionId`,
`workflowId` e `requestHash`. Nenhum contrato ou arquivo interno do Orchestrator é acessado.

`ExecutionResult` contém:

- status terminal e `attempt: 1` em metadata;
- `engineVersion` e `contractVersion` explícitos;
- `startedAt`, `finishedAt` e timeline observacionais;
- `WorkflowResult` válido ou `null` quando a falha impede sua obtenção;
- lineage e provenance promovidos em contratos separados;
- métricas observadas do Engine e métricas públicas do workflow;
- hashes da requisição, workflow, lineage, provenance e execução;
- falha sanitizada quando o status não é `SUCCESS`.

Rejeição funcional retornada pelo Orchestrator produz `ExecutionResult` resolvido com `FAILED`.
Falhas técnicas e cancelamentos lançam `ExecutionEngineError` com resultado terminal parcial.
Cancelamento previamente sinalizado produz `CREATED → CANCELLED` e não chama o Orchestrator.

`startedAt`, `finishedAt`, timeline, duração e métricas não participam de nenhum hash. O
`executionHash` vincula versões, identidades, attempt, status, hashes públicos e códigos estáveis
de falha.

Logs usam allowlist e registram somente identidades, estado, status terminal, versões, duração,
hashes, métricas, resumo de lineage por hash/contagem e erro sanitizado. Requests, demanda,
contexto do usuário, `WorkflowResult`, prompts, specifications, artifacts e respostas são
proibidos.

## Dependency boundary

Produção pode depender apenas de:

```text
@brq/orchestrator
@brq/shared
zod
node:crypto
```

Shared é usado somente para logger e tipos utilitários transversais. Imports de agentes, AI
Provider, Knowledge Loader, Prompt Builder, Agent Runner, Response Validator, Artifact Generator,
Prisma, repositories ou apps são proibidos.

## Consequences

- a mesma entrada validada produz o mesmo `executionId`, sequência e hashes;
- duas demandas canonicamente idênticas compartilham o mesmo ID nesta fase sem persistência;
- o estado desaparece ao fim da chamada e não pode ser consultado por ID;
- cancelamento é cooperativo e requer um `AbortSignal` do caller;
- `ExecutionResult` pode ser volumoso por preservar o resultado público do workflow;
- falhas sem resultado válido possuem lineage, provenance e hashes de workflow nulos;
- evolução de engine e contrato fica explícita nos metadados e no hash terminal.

## Out of scope

- persistência, repositories, Prisma e banco;
- retry, resume, backoff e revisão humana;
- filas, scheduler, workers, cron, concorrência e paralelismo;
- registro global, consulta ou cancelamento por executionId;
- API, frontend, websocket, autenticação e autorização;
- eventos externos;
- execução de testes e geração de código;
- qualquer item da Sprint 14.
