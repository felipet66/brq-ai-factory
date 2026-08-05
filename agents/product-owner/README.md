# Product Owner Agent

Agente funcional genérico do domínio de Product Owner. O pacote coordena, para uma única execução, o carregamento determinístico de conhecimento, o Agent Runner, a validação de resposta e a geração em memória de artifacts.

## Fronteira

O pacote:

- recebe dependências prontas por `createProductOwnerAgent`;
- carrega e valida seu bundle declarativo versionado em `prompts/product-owner/`;
- produz `story.md`, `acceptance.md` e `backlog.json` somente após validação técnica e funcional;
- retorna resultado e metadados imutáveis e rastreáveis.

O pacote não persiste dados, não altera estados de execução, não implementa retry, não conhece Orchestrator ou agentes futuros e não grava artifacts no filesystem.

## API pública

O entrypoint `@brq/product-owner-agent` expõe a factory, os contratos e schemas canônicos, a validação de negócio e o carregador validado de prompt assets. Funções internas de projeção, logging e montagem de resultado não fazem parte da API pública.
