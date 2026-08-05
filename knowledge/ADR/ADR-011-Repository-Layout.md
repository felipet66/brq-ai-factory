# ADR-011 — Repository Layout and Workspace Boundaries

## Status

Accepted

## Date

2026-08-04

## Context

Os documentos iniciais apresentavam duas estruturas concorrentes: módulos dentro de `packages/` e módulos de domínio diretamente na raiz. Também era necessário definir onde o Agent Runner seria implementado e quais dependências seriam permitidas entre as camadas.

## Decision

A estrutura canônica utiliza os diretórios de raiz:

```text
apps/
core/
agents/
prompts/
shared/
prisma/
knowledge/
.ai/
```

O repositório utiliza npm workspaces, coordenados pelo `package.json` da raiz. Cada módulo será registrado como workspace apenas quando for implementado pela Sprint correspondente.

O Agent Runner é um componente genérico localizado em `core/agent-runner`. Agentes não implementam acesso próprio ao provider de IA.

As fronteiras de dependência são:

- `apps` pode depender de `core` e `shared`;
- `core` pode depender de `agents`, `prompts` e `shared`;
- `agents` pode depender apenas de `shared` e nunca de outro agente;
- `prompts` contém somente instruções versionadas e não depende de código;
- `shared` não contém regras específicas de agentes;
- `knowledge` e `.ai` não dependem da implementação.

SQLite é a persistência local do MVP. Não será utilizado como banco durável em deploy serverless.

## Consequences

- remove a ambiguidade entre a estrutura raiz e `packages/`;
- mantém o Agent Runner independente de agentes específicos;
- permite crescimento incremental dos npm workspaces;
- preserva baixo acoplamento e isolamento dos agentes;
- limita o MVP com SQLite ao ambiente local;
- qualquer alteração futura dessas fronteiras exige um novo ADR.
