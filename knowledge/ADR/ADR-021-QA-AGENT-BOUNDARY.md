# ADR-021 — QA Agent Boundary and Dual-Specification Handoff

## Status

Accepted

## Context

As Sprints 9 e 10 introduziram fachadas funcionais de tentativa única para Product Owner e Developer. A Sprint 11 precisa transformar uma `ProductOwnerSpecification` e uma `TechnicalSpecification` em uma especificação de qualidade sem antecipar Orchestrator, Execution Engine, persistência ou execução de testes.

Os ADRs 001–020 permanecem normativos. Em particular, agentes não se comunicam operacionalmente entre si, o Agent Runner encapsula Prompt Builder e AI Provider, o Response Validator é genérico e o Artifact Generator só recebe resultados aceitos e uma specification server-side.

## Decision

Criar o workspace `@brq/qa-agent` como fachada independente de uma única tentativa.

O contrato de entrada contém `ProductOwnerSpecification` e `TechnicalSpecification` importadas exclusivamente pelos entrypoints públicos dos respectivos pacotes. A fachada não chama Product Owner Agent nem Developer Agent. O uso da validação pura do Developer é permitido somente para provar que o par recebido continua semanticamente compatível antes de consumir recursos de IA.

O fluxo canônico é:

1. validar configuração, assets e request;
2. validar a compatibilidade das duas especificações;
3. carregar conhecimento no contexto `QA`;
4. projetar exatamente três `PromptContextInput`: knowledge, Product Owner Specification e Technical Specification;
5. invocar o Agent Runner exatamente uma vez;
6. aplicar Response Validator;
7. aplicar QA Business Validation;
8. gerar drafts com Artifact Generator somente após as duas validações;
9. retornar `QAAgentResult` profundamente imutável.

Os três contextos dinâmicos usam canal `INPUT` e trust `UNTRUSTED`. O Agent Runner continua sendo a única fronteira operacional para Prompt Builder e AI Provider.

## QA Specification

A saída declarativa contém readiness, objetivo, estratégia, matriz de rastreabilidade, cobertura funcional e técnica, cenários positivos, negativos e edge cases, riscos, critérios de aprovação, bloqueios, testes prioritários, recomendações futuras de automação, premissas, questões abertas e fora de escopo.

Business Validation exige:

- cobertura de todo `AC` e `BR` em cenário, mapa e matriz;
- cobertura de todo `DEC` e `DOD` em cenário, mapa e matriz;
- referências conhecidas e não duplicadas;
- IDs e categorias de cenário consistentes;
- totais de cobertura recalculados;
- ranking prioritário contíguo;
- readiness recalculado;
- completude mínima quando readiness não exige esclarecimento.

Uma falha de conteúdo retorna `VALIDATION_REJECTED`. A fachada nunca corrige a resposta do modelo.

## Readiness

`REQUIRES_CLARIFICATION` tem precedência quando alguma fonte já exige esclarecimento, existe dúvida bloqueante ou item bloqueante. `PARTIALLY_READY` é usado quando alguma fonte está parcial, existe dúvida não bloqueante ou premissa pendente. `READY` só é possível na ausência dessas condições.

Readiness classifica a especificação. Não representa teste executado, aprovação operacional ou estado persistido.

## Assets and artifacts

O bundle `prompts/qa/1.0.0` contém manifesto, template, três rule sets, Output Contract e Artifact Specification. O Validation Contract é derivado do Output Contract. Todos os assets e o bundle possuem hashes canônicos fixos.

O Artifact Generator produz somente:

- `test-plan.md`;
- `traceability-matrix.json`;
- `qa-specification.md`.

Os artifacts são drafts determinísticos e continuam não confiáveis.

## Security and observability

Logs usam allowlist e podem conter IDs técnicos, versões, contagens, readiness, métricas e hashes. Não podem conter especificações, knowledge, prompt, resposta, cenários, artifacts, schemas, valores de issues, segredos, stack ou causa crua.

O agente não executa código, testes, browser, shell, filesystem ou persistência. Cancelamento é encaminhado ao Runner; não existe retry ou timer próprio.

## Lineage limitation

O resultado preserva hashes canônicos separados das duas especificações e valida sua compatibilidade semântica. Sem Orchestrator ou persistência não há prova criptográfica de que ambas vieram da mesma cadeia de execuções. Essa ligação permanece responsabilidade futura da camada de orquestração.

## Consequences

- A especificação de qualidade é independente e revisável.
- O handoff entre agentes permanece contratual, nunca operacional.
- Cobertura pode ser validada sem executar testes.
- O agente não pode afirmar que o produto foi testado ou aprovado.
- Mudanças futuras de workflow ou lineage exigirão decisão própria do Orchestrator.

## Out of scope

Orchestrator, Execution Engine, API, frontend, persistência funcional, retry, workflow, revisão humana, execução de testes, Playwright, geração de código, inspeção de implementação e defeitos baseados em evidência de execução.
