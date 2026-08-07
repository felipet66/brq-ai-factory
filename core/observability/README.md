# @brq/observability

Fronteira efêmera de histórico e observabilidade da AI Factory.

O módulo decora exclusivamente a API pública do Execution Engine, normaliza logs já sanitizados
em eventos tipados e mantém snapshots minimizados em memória. Ele nunca armazena requests,
prompts, specifications, respostas ou artifacts.

O histórico é limitado, local ao processo e perdido em restart, HMR ou eviction. Eventos,
timeline, métricas e custo estimado são observacionais e não participam dos hashes existentes.
Sem um rate card explícito e versionado, `totalCostEstimate` permanece `null`.

Consulte `knowledge/ADR/ADR-026-OBSERVABILITY-BOUNDARY.md` e
`knowledge/40-OBSERVABILITY_FLOW.md`.
