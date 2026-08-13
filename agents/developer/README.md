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

O loader seleciona estaticamente `prompts/developer/1.0.4`. Os releases históricos `1.0.0`–`1.0.3`
permanecem inalterados. O `1.0.4` preserva o schema e a tabela de readiness do `1.0.3`, e torna
trusted a interpretação do `deliveryIntent.mode` fornecido pelo host. Em GREENFIELD, cada
Component e Module deve usar exatamente `changeType: CREATE`; em CHANGE, `CREATE`, `MODIFY` ou
`DELETE` seguem somente a semântica real, sem forçar CREATE nem inventar alteração. O preflight é
repetido na instrução final, e uma saída GREENFIELD não-CREATE é explicitamente inválida. O bundle
está pinado por `90cc14824bdb1abf6879692a8a0924171434f30ec956caa25ef03463ba611a9a`.

JSON Schema Draft 2020-12 mede `maxLength` por code points e não expressa normalização Unicode NFC,
enquanto o contrato Zod preserva comprimento JavaScript UTF-16 e NFC para paths. Essas limitações
permanecem explícitas nas regras confiáveis, cobertas pela suíte de paridade e autoritativamente
verificadas pelo Zod. O schema público não foi alterado; a Developer Business Validation agora
recebe o `deliveryIntent` host-owned e rejeita deterministicamente um `changeType` diferente de
`CREATE` em GREENFIELD, sem corrigir ou reescrever a resposta.

## Diagnóstico local de Structured Outputs

O harness de desenvolvimento executa uma resposta capturada por `Response Validator real → Zod
público → Developer Business Validation real`, sem construir prompt e sem instanciar ou chamar um
AI Provider. Use somente um arquivo local dentro do diretório ignorado pelo Git:

```bash
mkdir -p .ai/debug/structured-output
AI_FACTORY_STRUCTURED_OUTPUT_RAW_DEBUG=true npm run --silent debug:developer-output -- .ai/debug/structured-output/developer-output.json
```

O JSON pode ser a `TechnicalSpecification` direta ou o wrapper
`{ "candidate": ..., "productOwnerSpecification": ..., "deliveryIntent": ... }`. O wrapper exige
o intent host-owned explícito. Uma entrada direta usa a fixture funcional canônica com o intent
GREENFIELD atual e informa `businessContextSource: DEFAULT_FIXTURE`; para reproduzir a Business
Validation histórica, forneça o wrapper completo com o intent da execução. O relatório informa
somente estágio, codes, paths, keywords, hashes, versão e modo do intent; não imprime o payload.
`candidateHash` é o hash do JSON local, não o
`responseHash` do envelope retornado em produção. A flag separada confirma a leitura deliberada de
conteúdo bruto. Esse arquivo deve permanecer local e sem segredos.

O modo seguro do Response Validator também exige simultaneamente `NODE_ENV=development` e
`AI_FACTORY_STRUCTURED_OUTPUT_DEBUG=true`. Produção, API HTTP, Execution Repository e frontend não
recebem o relatório. O bundle `1.0.3` decorre de uma reprodução concreta de
`DEVELOPER_READINESS_MISMATCH`; o `1.0.4` adiciona a orientação confiável de `changeType`, alinhada
à verificação host-side. Não houve alteração de schema público ou enfraquecimento da Developer
Business Validation.

## API pública

O entrypoint `@brq/developer-agent` expõe a factory, os contratos e schemas canônicos, a Developer Business Validation, o carregador validado de prompt assets e a função pura `projectDeveloperPromptContexts`. Essa projeção pública é o seam mínimo usado pelo Prompt Inspector; ela reutiliza exatamente a transformação do agente sem executar o agente. Logging, montagem de requests do runner e montagem de resultado permanecem internos.
