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

## API pública

O entrypoint `@brq/developer-agent` expõe a factory, os contratos e schemas canônicos, a Developer Business Validation e o carregador validado de prompt assets. Funções internas de projeção, logging e montagem de resultado não fazem parte da API pública.
