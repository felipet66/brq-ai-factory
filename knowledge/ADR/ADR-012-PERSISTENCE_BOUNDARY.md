# ADR-012 — Persistence Boundary

## Status

Accepted

## Date

2026-08-04

## Context

O ADR-011 definiu o layout do repositório e as fronteiras gerais, mas não registrou onde os contratos de repositories e suas implementações deveriam residir. A Sprint 2 também precisava mapear contratos com datas ISO e payloads JSON para os tipos físicos do Prisma e preservar rastreabilidade sem levar regras de negócio para a persistência.

## Decision

Os ports dos repositories, seus tipos de entrada e schemas Zod pertencem a `shared/`. As implementações concretas, o Prisma Client, os mapeadores, as migrations e os testes de integração pertencem a `prisma/`.

As dependências seguem estas regras:

- `shared` não depende de Prisma;
- `prisma` depende de `shared` e do client gerado;
- componentes futuros de `core` dependem somente dos ports de `shared`;
- um composition root futuro pode importar `prisma` exclusivamente para injetar implementações concretas;
- repositories validam, mapeiam, persistem, recuperam e traduzem erros, sem executar transições de estado ou decisões do Orchestrator.

Na persistência física:

- estados e tipos canônicos são armazenados como strings e validados por Zod;
- input e output de AgentExecution, provenance de Artifact e context de Log são snapshots JSON;
- datas são `DateTime` no Prisma e strings ISO 8601 nos contratos;
- métricas consultáveis, como tokens e duração, usam colunas escalares;
- Artifact é imutável e versionado por `(executionId, filename)`;
- PromptVersion é imutável, exceto pelo status, e é única por `(agent, version)`;
- relações históricas obrigatórias usam `Restrict`; correlações opcionais de Log usam `SetNull`;
- o MVP não expõe hard delete e não possui seed obrigatório.

SQLite continua sendo uma solução exclusivamente local do MVP.

## Consequences

- `core` poderá ser testado futuramente contra ports sem conhecer Prisma;
- a Shared Layer permanece a fonte canônica dos contratos;
- acessos diretos ao banco podem contornar validações de estados, pois SQLite armazena esses valores como texto;
- snapshots JSON favorecem auditoria, mas aumentam o arquivo local;
- versionamento de Artifact entre Executions exigirá um identificador de linhagem futuro;
- política de retenção e purge permanece uma decisão posterior.
