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

`ProductOwnerSpecification` válida

Saída

- architecture.md
- implementation-plan.md
- technical-decisions.json

Na Sprint 10, essa etapa produz somente uma `TechnicalSpecification` declarativa e os três drafts em memória. Não gera código ou testes, não executa o plano e não persiste artifacts.

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

No fluxo completo futuro, o Orchestrator entregará o contrato validado de uma etapa à seguinte. As fachadas atuais não chamam outros agentes; o Developer recebe a `ProductOwnerSpecification` diretamente de seu caller sem executar o Product Owner.

Persistência de artifacts pertence ao fluxo futuro. Product Owner e Developer retornam somente drafts em memória.

Toda execução deve gerar logs.
