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

- `ProductOwnerSpecification` válida
- `TechnicalSpecification` válida e compatível

Saída

- test-plan.md
- traceability-matrix.json
- qa-specification.md

Na Sprint 11, essa etapa produz somente uma `QASpecification` declarativa e os três drafts em memória. Não recebe código, não executa testes, não gera Playwright e não emite aprovação operacional.

---

# Resultado Final

O usuário recebe:

- História
- Critérios
- Especificação técnica
- Especificação de qualidade
- Drafts rastreáveis

---

# Regras

Nenhum agente conversa diretamente com outro.

No fluxo completo futuro, o Orchestrator entregará o contrato validado de uma etapa à seguinte. As fachadas atuais não chamam outros agentes; Developer e QA recebem contratos diretamente de seus callers.

Persistência de artifacts pertence ao fluxo futuro. Product Owner, Developer e QA retornam somente drafts em memória.

Toda execução deve gerar logs.
