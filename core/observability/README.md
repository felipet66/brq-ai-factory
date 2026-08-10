# @brq/observability

Fronteira efêmera de histórico e observabilidade da AI Factory.

O módulo decora exclusivamente APIs públicas do Execution Engine e do Factory Pipeline, normaliza logs já sanitizados
em eventos tipados e mantém snapshots minimizados em memória. Ele nunca armazena requests,
prompts, specifications, respostas ou artifacts.

O contrato histórico `1.x` permanece aceito com os quatro estágios originais. O contrato `2.0.0`
é aditivo e observa `KNOWLEDGE`, os três agentes, `CODE_GENERATOR`, `WORKSPACE` materializado e os
quatro passos fixos da sandbox. Um `execution.completed` interno não terminaliza o snapshot v2: a
terminalização ocorre somente quando existe um `FactoryExecutionResult` real.

O histórico é limitado, local ao processo e perdido em restart, HMR ou eviction. Eventos,
timeline, métricas e custo estimado são observacionais e não participam dos hashes existentes.
Sem um rate card explícito e versionado, `totalCostEstimate` permanece `null`.

Consulte `knowledge/ADR/ADR-026-OBSERVABILITY-BOUNDARY.md` e
`knowledge/40-OBSERVABILITY_FLOW.md`.
