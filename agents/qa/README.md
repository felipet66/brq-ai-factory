# @brq/qa-agent

Fachada funcional de tentativa única da Sprint 11. Consome `ProductOwnerSpecification` e `TechnicalSpecification` e produz uma `QASpecification` declarativa e três drafts determinísticos.

## Fluxo

```text
request + source validation
  -> Knowledge Loader (QA)
  -> 3 PromptContextInput não confiáveis
  -> Agent Runner
  -> Response Validator
  -> QA Business Validation
  -> Artifact Generator
  -> QAAgentResult
```

O Agent Runner encapsula Prompt Builder e AI Provider. O pacote não chama outros agentes, não acessa persistência e não executa testes.

## Entrada

- contexto técnico da tentativa;
- `ProductOwnerSpecification` válida;
- `TechnicalSpecification` válida e compatível;
- modelo e limites opcionais;
- `AbortSignal` opcional.

## Saída

- `GENERATED`: specification, validações, metadata e drafts;
- `VALIDATION_REJECTED`: rejeição do Response Validator ou da Business Validation, sem drafts.

Artifacts canônicos:

1. `test-plan.md`;
2. `traceability-matrix.json`;
3. `qa-specification.md`.

## Garantias

- uma chamada ao provider por execução;
- assets ativos `prompts/qa/1.0.1` validados e pinados por hash, com o release histórico `1.0.0` preservado;
- três contextos `INPUT/UNTRUSTED`;
- cobertura obrigatória de `AC`, `BR`, `DEC` e `DOD`;
- consistência relacional entre coverage, matriz e referências dos cenários orientada pelo prompt e validada autoritativamente pela Business Validation;
- readiness derivado pela tabela ordenada das duas fontes, bloqueios, dúvidas e premissas;
- logs allowlisted;
- resultado profundamente imutável;
- ausência de retry, workflow, código, Playwright e execução de testes.

Consulte [ADR-021](../../knowledge/ADR/ADR-021-QA-AGENT-BOUNDARY.md) e [fluxo visual](../../knowledge/35-QA_AGENT_FLOW.md).

## API pública

O entrypoint também expõe a função pura `projectQAPromptContexts` como seam mínimo do Prompt Inspector. Ela reutiliza a transformação canônica de conhecimento e specifications sem executar o QA Agent. Logging, montagem de requests do runner e montagem de resultado permanecem internos.
