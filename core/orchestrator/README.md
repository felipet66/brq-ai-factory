# Orchestrator

Workspace responsável exclusivamente por coordenar o workflow sequencial da BRQ AI Factory.

## Fluxo da Sprint 12

```text
Human Request → Product Owner Agent → Developer Agent → QA Agent → WorkflowResult
```

O módulo depende apenas dos entrypoints públicos dos três agentes. Ele não chama OpenAI, não
constrói prompts, não valida respostas do modelo, não gera artifacts, não persiste estado e não
executa retry.

## API pública

- `createOrchestrator(options)`
- `Orchestrator.execute(request, { signal? })`
- contratos e schemas de `WorkflowRequest`, `WorkflowResult`, timeline, lineage, provenance,
  métricas e hashes
- `OrchestratorError` e códigos sanitizados

Rejeições funcionais retornam `WorkflowResult` com status `FAILED`. Falhas técnicas e
cancelamentos lançam `OrchestratorError` com o resultado parcial terminal disponível em `result`.

Timeline e métricas temporais são observacionais e nunca participam dos hashes determinísticos.
