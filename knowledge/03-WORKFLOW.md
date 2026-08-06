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

Desde a Sprint 12, o Orchestrator entrega o contrato público validado de uma etapa à seguinte no workflow fixo Product Owner → Developer → QA. As fachadas continuam sem chamar outros agentes; o Orchestrator injeta as specifications públicas nos requests posteriores e preserva resultados anteriores em qualquer interrupção.

Desde a Sprint 13, o Execution Engine cria a identidade e inicia esse workflow exatamente uma vez
pela API pública do Orchestrator. O ciclo completo permanece em memória, sem persistir estado,
criar novas tentativas ou executar revisão humana.

Desde a Sprint 14, `POST /api/executions` entrega o request validado ao Execution Engine e devolve
o resultado terminal de forma síncrona. O adapter HTTP não decide progressão, não acessa agentes e
não mantém registro consultável da execução.

Desde a Sprint 15, a página inicial envia Project Name e Objective exclusivamente por esse endpoint.
O client HTTP complementa o request exigido pela API `1.0.0` e reduz o `ExecutionResult` bruto para
`ExecutionSummary` antes de devolver dados ao React. IDs técnicos no browser são uma limitação
temporária; sua responsabilidade definitiva deve migrar ao backend em evolução futura do contrato.

Persistência de artifacts pertence ao fluxo futuro. Product Owner, Developer e QA retornam somente drafts em memória.

Toda execução deve gerar logs.
