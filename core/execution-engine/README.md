# Execution Engine

Fronteira de ciclo de vida efêmero da BRQ AI Factory. O workspace cria um `executionId`
determinístico, controla a máquina local `CREATED → RUNNING → SUCCESS | FAILED | CANCELLED`,
invoca uma única vez a API pública do Orchestrator e consolida um `ExecutionResult` imutável.

O Engine não conhece agentes ou componentes inferiores, não persiste, não retenta e não cria
concorrência. `startedAt`, `finishedAt`, timeline, durações e métricas são observacionais e não
participam dos hashes determinísticos.
