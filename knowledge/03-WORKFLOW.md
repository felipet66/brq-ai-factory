# Workflow

## Fluxo Geral

Nova Demanda

↓

Orchestrator

↓

Product Owner

↓

Developer

↓

QA

↓

Resultado Final

---

# Product Owner

Entrada

Requisito

Saída

- story.md
- acceptance.md
- backlog.json

---

# Developer

Entrada

User Story

Saída

- source-code
- implementation.md

---

# QA

Entrada

Código

Saída

- test-plan.md
- playwright.spec.ts
- quality-report.md

---

# Resultado Final

O usuário recebe:

- História
- Critérios
- Código
- Testes
- Relatório

---

# Regras

Nenhum agente conversa diretamente com outro.

Todos os agentes recebem contexto apenas através do Orchestrator.

Todo artefato deve ser persistido.

Toda execução deve gerar logs.
