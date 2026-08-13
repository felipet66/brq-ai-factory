# Product Owner Agent

Agente funcional genérico do domínio de Product Owner. O pacote coordena, para uma única execução, o carregamento determinístico de conhecimento, o Agent Runner, a validação de resposta e a geração em memória de artifacts.

## Fronteira

O pacote:

- recebe dependências prontas por `createProductOwnerAgent`;
- carrega e valida seu bundle declarativo versionado em `prompts/product-owner/`;
- produz `story.md`, `acceptance.md` e `backlog.json` somente após validação técnica e funcional;
- retorna resultado e metadados imutáveis e rastreáveis.

O pacote não persiste dados, não altera estados de execução, não implementa retry, não conhece Orchestrator ou agentes futuros e não grava artifacts no filesystem.

## Assets versionados

Os releases históricos `prompts/product-owner/1.0.0` e `1.0.1` permanecem imutáveis. O bundle ativo
`prompts/product-owner/1.0.2` mantém a regra de referências de dependência e define, nas instruções
confiáveis, que somente decisões concretas com impacto funcional material são elegíveis para
`openQuestions`. Em GREENFIELD completo, defaults convencionais, locais e reversíveis não criam
dúvidas nem premissas com validação pendente; incerteza concreta continua preservando
`PARTIALLY_READY` e `REQUIRES_CLARIFICATION`. O JSON Schema e a Business Validation não foram
alterados.

## API pública

O entrypoint `@brq/product-owner-agent` expõe a factory, os contratos e schemas canônicos, a validação de negócio, o carregador validado de prompt assets e a função pura `projectProductOwnerPromptContexts`. Essa projeção pública é o seam mínimo usado pelo Prompt Inspector; ela reutiliza exatamente a transformação do agente sem executar o agente. Logging, montagem de requests do runner e montagem de resultado permanecem internos.
