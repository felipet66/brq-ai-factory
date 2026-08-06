# ADR-025 — Frontend MVP Boundary

## Status

Accepted

## Date

2026-08-06

## Context

O ADR-024 expôs o ciclo completo da AI Factory por uma API HTTP síncrona e stateless em
`apps/web`. A Sprint 15 precisa provar esse contrato por uma interface real sem permitir que o
navegador acesse o Execution Engine, o Orchestrator, agentes ou qualquer componente inferior.

O contrato HTTP `1.0.0` recebe o `ExecutionRequest` público sem `requestId` e `executionId`, mas
ainda exige `workflowId` e configurações técnicas distintas para Product Owner, Developer e QA.
Ao mesmo tempo, o formulário do MVP expõe somente Project Name e Objective ao usuário. Essa
diferença precisa ser resolvida na borda de transporte sem criar uma entidade Project, persistência
ou regra de negócio na apresentação.

O `ExecutionResult` transportado pela API contém specifications, artifacts e outros dados públicos
do workflow que não devem ser exibidos nem propagados pela árvore React desta Sprint.

## Decision

Implementar o Frontend MVP como Presentation Adapter dentro de `apps/web`. Todo início de execução
ocorre exclusivamente por `POST /api/executions`; código executado no browser não importa módulos
`@brq/*`, implementação de Route Handler, composition root, schemas server-side ou arquivos do
núcleo.

`src/app/page.tsx` permanece um Server Component responsável somente pela composição da página. A
menor subárvore interativa necessária é um Client Component. Ela controla localmente uma máquina
de estados discriminada:

```text
idle → loading → success
               → error
```

Não existe store global, cache de dados, polling, atualização em tempo real ou retomada. Uma nova
submissão explícita pode iniciar novamente o ciclo local.

Um único client HTTP interno concentra `fetch`, DTOs de transporte, validação defensiva do envelope
e mapeamento do formulário. Componentes React nunca chamam `fetch` diretamente. O mapeamento
inicial é:

```text
Project Name → ExecutionRequest.demand.title
Objective    → ExecutionRequest.demand.description
```

O client complementa o request com um perfil técnico versionado (`agentVersion` e `model`) e não
editável pela interface e gera, por submissão, `workflowId` e três `agentExecutionId` distintos.
Esses campos no browser são uma limitação temporária imposta pelo contrato HTTP `1.0.0`; sua
responsabilidade definitiva deve migrar para configuração confiável no backend por meio de uma
futura evolução explícita do contrato HTTP. A Sprint 15 não altera o ADR-024 nem cria um endpoint
alternativo.

`ExecutionResult` bruto é um DTO restrito ao escopo interno do client HTTP. Antes de retornar ao
React, o client o reduz para o único contrato aceito pela interface, `ExecutionSummary`, contendo
somente:

- `executionId`;
- status terminal;
- duração observada em `metrics.observed.totalDurationMs`;
- readiness final do QA, quando disponível;
- hashes públicos;
- resumo de lineage;
- resumo de provenance.

Specifications, artifacts, prompts, contextos, knowledge, respostas de modelo, timeline completa,
logs e o próprio `ExecutionResult` nunca são propagados por props ou estado React. O Frontend não
recalcula hashes, readiness, lineage, provenance ou métricas.

Sucesso de transporte e resultado funcional são conceitos distintos. Um HTTP 200 com
`ExecutionResult.status = FAILED` é uma execução resolvida e usa o estado visual `success`, exibindo
o status terminal e os resumos disponíveis. O estado visual `error` representa falha HTTP, rede ou
envelope incompatível; o cancelamento técnico causado pelo unmount é silenciado.

A interface usa somente React, TypeScript, Next.js App Router e o CSS existente. Não são
adicionadas bibliotecas de UI, estado ou data fetching. Conteúdo recebido é renderizado apenas como
texto React; `dangerouslySetInnerHTML` e interpretação de HTML são proibidos. Requests e respostas
não são registrados no console, persistidos ou colocados em APIs de storage do navegador.

## Dependency boundary

Código browser-side do Frontend MVP pode depender somente de:

```text
React
Web Fetch API
DTOs locais do HTTP client
CSS da aplicação
```

São proibidos imports de:

```text
Execution Engine
Orchestrator
Product Owner / Developer / QA Agents
Prompt Builder / Knowledge Loader / AI Provider
Agent Runner / Response Validator / Artifact Generator
apps/web/src/server
apps/web/src/app/api internals
```

## Consequences

- a arquitetura completa pode ser exercitada por uma interface real usando exclusivamente HTTP;
- Project Name identifica a demanda no formulário, mas não cria uma entidade Project persistente;
- o React observa apenas dados minimizados por `ExecutionSummary`;
- resultado funcional `FAILED` não é confundido com falha de transporte;
- a criação síncrona pode manter a tela em loading durante todo o workflow;
- o payload HTTP completo continua inspecionável pelo browser antes da projeção local;
- configuração técnica no client permanece acoplamento temporário à API `1.0.0`;
- sem autenticação, autorização e rate limit, a interface é apropriada apenas para ambiente local ou
  explicitamente permitido e dados sintéticos.

## Out of scope

- novas páginas, dashboard, projetos, histórico, logs ou visualização completa de artifacts;
- persistência, lookup funcional, cache ou storage no browser;
- autenticação, autorização, rate limit e exposição pública;
- polling, websocket, SSE e atualização em tempo real;
- cancelamento por UI, retry, retomada ou revisão humana;
- upload, download, geração ou execução de código;
- Playwright e testes end-to-end;
- alteração do contrato HTTP `1.0.0`, do Execution Engine ou de agentes;
- qualquer item da Sprint 16.
