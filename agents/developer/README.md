# Developer Agent

Agente funcional do domínio de arquitetura técnica. O pacote transforma uma `ProductOwnerSpecification` validada em uma `TechnicalSpecification` declarativa, sem gerar código ou testes.

## Fronteira

O pacote:

- recebe dependências prontas por `createDeveloperAgent`;
- carrega e valida seu bundle declarativo versionado em `prompts/developer/`;
- executa uma única tentativa sobre Knowledge Loader, Agent Runner, Response Validator, Developer Business Validation e Artifact Generator;
- produz `architecture.md`, `implementation-plan.md` e `technical-decisions.json` somente após as validações técnica e de domínio;
- retorna resultado e metadados imutáveis e rastreáveis.

O pacote não gera código, não gera testes, não persiste dados, não altera estados de execução, não implementa retry, não conhece QA Agent ou Orchestrator e não grava artifacts no filesystem.

## Bundle ativo

O loader seleciona estaticamente `prompts/developer/1.0.3`. Os releases históricos `1.0.0`,
`1.0.1` e `1.0.2` permanecem inalterados. O `1.0.2` alinhou o JSON Schema versionado ao schema Zod
público. O `1.0.3` preserva esse mesmo schema e torna normativa a tabela de readiness: condições
bloqueantes prevalecem, perguntas não bloqueantes ou premissas com `requiresValidation: true`
exigem `PARTIALLY_READY`, e `READY` somente é permitido sem pendências. A instrução final exige
recalcular a decisão sobre as coleções finais antes de emitir o JSON.

JSON Schema Draft 2020-12 mede `maxLength` por code points e não expressa normalização Unicode NFC,
enquanto o contrato Zod preserva comprimento JavaScript UTF-16 e NFC para paths. Essas limitações
permanecem explícitas nas regras confiáveis, cobertas pela suíte de paridade e autoritativamente
verificadas pelo Zod. Schemas públicos e Developer Business Validation não foram alterados.

## Diagnóstico local de Structured Outputs

O harness de desenvolvimento executa uma resposta capturada por `Response Validator real → Zod
público → Developer Business Validation real`, sem construir prompt e sem instanciar ou chamar um
AI Provider. Use somente um arquivo local dentro do diretório ignorado pelo Git:

```bash
mkdir -p .ai/debug/structured-output
AI_FACTORY_STRUCTURED_OUTPUT_RAW_DEBUG=true npm run --silent debug:developer-output -- .ai/debug/structured-output/developer-output.json
```

O JSON pode ser a `TechnicalSpecification` direta ou o wrapper
`{ "candidate": ..., "productOwnerSpecification": ... }`. O relatório informa somente estágio,
codes, paths, keywords e hashes; não imprime o payload. Uma entrada direta usa a fixture funcional
canônica e informa `businessContextSource: DEFAULT_FIXTURE`; para reproduzir a Business Validation
histórica, forneça o wrapper completo. `candidateHash` é o hash do JSON local, não o
`responseHash` do envelope retornado em produção. A flag separada confirma a leitura deliberada de
conteúdo bruto. Esse arquivo deve permanecer local e sem segredos.

O modo seguro do Response Validator também exige simultaneamente `NODE_ENV=development` e
`AI_FACTORY_STRUCTURED_OUTPUT_DEBUG=true`. Produção, API HTTP, Execution Repository e frontend não
recebem o relatório. O bundle `1.0.3` decorre de uma reprodução concreta de
`DEVELOPER_READINESS_MISMATCH`; não houve drift estrutural no `1.0.2`, alteração de schema público
ou enfraquecimento da Developer Business Validation.

## API pública

O entrypoint `@brq/developer-agent` expõe a factory, os contratos e schemas canônicos, a Developer Business Validation, o carregador validado de prompt assets e a função pura `projectDeveloperPromptContexts`. Essa projeção pública é o seam mínimo usado pelo Prompt Inspector; ela reutiliza exatamente a transformação do agente sem executar o agente. Logging, montagem de requests do runner e montagem de resultado permanecem internos.
