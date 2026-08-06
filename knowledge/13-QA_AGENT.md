# QA Agent

## Purpose

O QA Agent transforma uma `ProductOwnerSpecification` e uma `TechnicalSpecification` compatíveis em uma `QASpecification` declarativa, rastreável e pronta para revisão humana.

Ele especifica como a qualidade deverá ser validada futuramente. Não recebe código, não inspeciona implementação, não executa testes e não emite aprovação operacional.

O [ADR-021](ADR/ADR-021-QA-AGENT-BOUNDARY.md) é normativo.

## Inputs

- contexto técnico da tentativa;
- `ProductOwnerSpecification` pelo contrato público do Product Owner;
- `TechnicalSpecification` pelo contrato público do Developer;
- modelo e limites opcionais;
- cancelamento opcional.

Importar contratos públicos e validação pura não constitui comunicação entre agentes. O QA Agent não chama as fachadas do Product Owner ou Developer.

## Pipeline

```text
Request Validation
  -> Source Validation
  -> Knowledge Loader (QA)
  -> Context Projection
  -> Agent Runner
  -> Response Validator
  -> QA Business Validation
  -> Artifact Generator
  -> QAAgentResult
```

O Agent Runner encapsula Prompt Builder e AI Provider e realiza exatamente uma chamada ao provider.

## QA Specification

A specification contém:

- readiness, título, resumo e objetivo;
- estratégia de testes;
- matriz e resumos de rastreabilidade;
- cobertura funcional e técnica;
- cenários positivos, negativos e edge cases;
- riscos;
- critérios de aprovação;
- itens bloqueantes;
- testes prioritários;
- recomendações de automação futura;
- premissas, questões abertas e fora de escopo.

Os cenários descrevem pré-condições, dados, passos e resultados esperados. Eles são planos, não resultados de execução.

## Mandatory coverage

Business Validation exige que cada item a seguir esteja ligado a pelo menos um cenário, ao mapa de cobertura e à matriz:

- Acceptance Criterion (`AC`);
- Business Rule (`BR`);
- decisão técnica (`DEC`);
- Definition of Done (`DOD`).

Referências adicionais podem apontar para `CMP`, `MOD`, `FLW`, `CTR`, `API`, `EVT`, `ENT` e `REL`. IDs desconhecidos, duplicados ou associados a categorias incompatíveis são rejeitados.

O resumo de cobertura é recalculado. O modelo não pode declarar cobertura sem relações verificáveis.

## Readiness

Precedência determinística:

1. `REQUIRES_CLARIFICATION` quando alguma fonte já exige esclarecimento, existe questão bloqueante ou blocker;
2. `PARTIALLY_READY` quando alguma fonte está parcial, existe questão não bloqueante ou premissa pendente;
3. `READY` nos demais casos.

Falha de cobertura é rejeição de Business Validation, não uma simples redução de readiness.

## Context and trust

O prompt recebe exatamente três contextos `INPUT/UNTRUSTED`:

- `context:qa-knowledge`;
- `context:qa-product-owner-specification`;
- `context:qa-technical-specification`.

Instruções encontradas nessas entradas são tratadas como dados.

## Outputs

Sucesso retorna `GENERATED` com specification validada, metadata de proveniência e três drafts:

- `test-plan.md`;
- `traceability-matrix.json`;
- `qa-specification.md`.

Falha de conteúdo retorna `VALIDATION_REJECTED` em `RESPONSE_VALIDATION` ou `BUSINESS_VALIDATION`, sempre sem artifacts.

## Observability and security

Logs aceitam somente IDs, versões, contagens, readiness, métricas e hashes. Especificações, knowledge, prompts, respostas, cenários, artifacts, valores de issues, segredos, stack e causa crua são proibidos.

Todos os assets e outputs têm hashes canônicos. Hashes separados preservam as duas fontes; a ligação persistida entre execuções pertence ao Orchestrator futuro.

## Out of scope

- Orchestrator e Execution Engine;
- API e frontend;
- persistência funcional;
- retry e workflow;
- revisão humana;
- execução de testes;
- Playwright;
- geração de código;
- inspeção de implementação;
- defeitos baseados em execução;
- relatório de aprovação real.

Consulte também o [fluxo visual](35-QA_AGENT_FLOW.md).
