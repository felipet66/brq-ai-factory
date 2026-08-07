# Execution Engine

Fronteira de ciclo de vida efêmero da BRQ AI Factory. O workspace cria um `executionId`
determinístico, controla a máquina local `CREATED → RUNNING → SUCCESS | FAILED | CANCELLED`,
invoca uma única vez a API pública do Orchestrator e consolida um `ExecutionResult` imutável.

O Engine não conhece agentes ou componentes inferiores, não persiste, não retenta e não cria
concorrência. `startedAt`, `finishedAt`, timeline, durações e métricas são observacionais e não
participam dos hashes determinísticos.

## Reserva de identidade

O entrypoint público `deriveExecutionIdentity(request)` valida a mesma `ExecutionRequest` e usa o
mesmo algoritmo versionado de `execute()` para devolver `executionId` e `executionRequestHash`.
Essa operação é pura: não inicia o Orchestrator, não registra lifecycle e não executa efeitos.

O dispatcher assíncrono usa essa capacidade para criar o registro e o job antes do processamento.
O Engine continua sendo o único proprietário da identidade; API, fila, Worker e Frontend não
duplicam o hashing nem aceitam um `executionId` fornecido pelo caller.
