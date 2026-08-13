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

O modo generativo mantém o Agent Runner com Prompt Builder e AI Provider. O modo determinístico
usa o mesmo Prompt Builder e compila a saída localmente, sem AI Provider. O pacote não chama
outros agentes, não acessa persistência e não executa testes.

## Entrada

- contexto técnico da tentativa;
- `ProductOwnerSpecification` válida;
- `TechnicalSpecification` válida e compatível;
- `deliveryIntent` host-owned válido e compatível com a especificação técnica;
- modelo e limites opcionais;
- `AbortSignal` opcional.

O `deliveryIntent` é usado exclusivamente no preflight host-side da source. Ele não é projetado nos
três contextos nem enviado ao prompt do QA.

## Saída

- `GENERATED`: specification, validações, metadata e drafts;
- `VALIDATION_REJECTED`: rejeição do Response Validator ou da Business Validation, sem drafts.

Artifacts canônicos:

1. `test-plan.md`;
2. `traceability-matrix.json`;
3. `qa-specification.md`.

## Garantias

- uma chamada ao provider por execução;
- assets ativos `prompts/qa/1.0.4` validados e pinados por hash, com os releases históricos `1.0.0`–`1.0.3` preservados;
- três contextos `INPUT/UNTRUSTED`;
- cobertura obrigatória de `AC`, `BR`, `DEC` e `DOD`;
- consistência relacional entre coverage, matriz e referências dos cenários orientada pelo prompt e validada autoritativamente pela Business Validation;
- auditoria por ID de cada `AC` e `BR` nas três superfícies funcionais e resumo derivado da interseção dessas evidências;
- auditoria por ID de cada `DEC` e `DOD` em `technicalReferences`, `technicalCoverage` e `technicalSourceIds` da matriz;
- `traceability.summary` derivado por identidade das quatro categorias somente depois dos detalhes e da rastreabilidade final;
- preflight par-a-par final de cada associação funcional, técnica e da matriz antes da emissão do JSON;
- readiness derivado pela tabela ordenada das duas fontes, bloqueios, dúvidas e premissas;
- logs allowlisted;
- resultado profundamente imutável;
- ausência de retry, autocorreção, workflow, código, Playwright e execução de testes.

Consulte [ADR-021](../../knowledge/ADR/ADR-021-QA-AGENT-BOUNDARY.md) e [fluxo visual](../../knowledge/35-QA_AGENT_FLOW.md).

## API pública

O entrypoint também expõe a função pura `projectQAPromptContexts` como seam mínimo do Prompt Inspector. Ela reutiliza a transformação canônica de conhecimento e specifications sem executar o QA Agent. Logging, montagem de requests do runner e montagem de resultado permanecem internos.

Para execução sem modelo, `createDeterministicQAAgent` preserva a fachada e os validadores atuais,
substituindo apenas o runner. `compileCanonicalQASpecification` oferece a compilação pura das
specifications PO e Developer; `createDeterministicQAAgentRunner` é o seam compatível com
`AgentRunner`. Nesse modo, a resposta registra zero tokens e `providerDurationMs` igual a zero.
