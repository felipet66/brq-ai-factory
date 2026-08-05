# Architecture Decisions Index

## Objetivo

Centralizar todas as decisões arquiteturais do projeto.

Cada decisão relevante deve possuir um ADR.

Este documento funciona apenas como índice.

---

# ADRs

| ADR     | Título                                                   | Status   |
| ------- | -------------------------------------------------------- | -------- |
| ADR-001 | Orchestrator Central                                     | Accepted |
| ADR-002 | Agent Isolation                                          | Accepted |
| ADR-003 | JSON Contract                                            | Accepted |
| ADR-004 | AI First                                                 | Accepted |
| ADR-005 | Knowledge Layer                                          | Accepted |
| ADR-006 | SQLite no MVP                                            | Accepted |
| ADR-007 | Prisma ORM                                               | Accepted |
| ADR-008 | Next.js Full Stack                                       | Accepted |
| ADR-009 | Prompt Versioning                                        | Accepted |
| ADR-010 | Human Review                                             | Accepted |
| ADR-011 | Repository Layout and Workspace Boundaries               | Accepted |
| ADR-012 | Persistence Boundary                                     | Accepted |
| ADR-013 | AI Provider Boundary and Resilience                      | Accepted |
| ADR-014 | Knowledge Loader Boundary and Deterministic Context      | Accepted |
| ADR-015 | Prompt Builder Boundary and Deterministic Model          | Accepted |
| ADR-016 | Agent Runner Boundary and Single-Call Execution          | Accepted |
| ADR-017 | Response Validator Boundary and Deterministic Validation | Accepted |
| ADR-018 | Artifact Generator Boundary and Deterministic Rendering  | Accepted |
| ADR-019 | Product Owner Agent Boundary and Single-Agent Pipeline   | Accepted |

---

## Processo

Uma nova decisão arquitetural deve criar um novo ADR.

ADRs nunca devem ser sobrescritos.

Caso uma decisão seja alterada:

Status:

- Superseded
- Deprecated

Jamais apagar histórico.
