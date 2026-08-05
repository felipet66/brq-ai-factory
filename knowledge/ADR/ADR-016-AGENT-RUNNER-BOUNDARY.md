# ADR-016 — Agent Runner Boundary and Single-Call Execution

## Status

Accepted

## Date

2026-08-05

## Context

O ADR-011 reservou `core/agent-runner` como componente genérico, o ADR-013 definiu a abstração `AIProvider` e o ADR-015 estabeleceu o `PromptResult` provider-neutral. Ainda era necessário definir a fronteira que integra esses contratos sem expor tipos internos entre módulos, duplicar resiliência do provider ou antecipar agentes e Orchestrator.

## Decision

O `AgentRunner` pertence ao workspace `core/agent-runner`. Em produção, ele depende somente das APIs públicas de `@brq/prompt-builder`, `@brq/ai-provider` e dos tipos transversais, schemas e logger de `@brq/shared`. O módulo não importa adapters concretos, OpenAI, Responses API, agentes, Orchestrator, Knowledge Loader, Prisma, aplicações ou frontend.

O contrato público `PromptRequest` pertence ao Runner e contém `template`, `ruleSets`, `contexts`, `variables`, `constraints`, `outputContract` e `maxBytes` opcional. Ele não expõe nem reutiliza `PromptBuildInput` como parte de sua API. O Runner realiza o mapeamento explícito para o Prompt Builder injetado, preserva a separação dos canais `instructions` e `input` e não altera nem renderiza novamente o `PromptResult`.

Uma solicitação de execução possui:

- `context.execution`, com `executionId`, `agentExecutionId`, `agent`, `attempt` e `agentVersion`;
- `context.requestId` e `context.traceId` opcionais;
- `prompt` do tipo `PromptRequest`;
- `model` solicitado;
- `maxOutputTokens` e `timeoutMs` opcionais.

O `agentExecutionId` é obrigatório e constitui a correlação canônica da invocação. O `AgentRunOptions` aceita somente um `AbortSignal` opcional.

Depois de construir e validar o prompt, o Runner converte `TEXT` para o formato textual abstrato do provider e `JSON_SCHEMA` para structured output estrito. O nome técnico do structured output é determinístico e compatível com o contrato do AI Provider: `contract_` seguido dos primeiros 55 caracteres de `outputContractHash`. O JSON Schema completo nunca é registrado em logs.

Cada chamada a `run` executa exatamente uma chamada a `AIProvider.generate`. O Runner não possui retry, backoff ou timer. Ele encaminha `timeoutMs` ao provider, que é o único componente que aplica o timeout técnico, e encaminha o `AbortSignal` recebido. Retry técnico permanece interno ao adapter conforme o ADR-013; retry funcional permanece decisão futura do Orchestrator e cria uma nova `AgentExecution`.

A resposta do provider é tecnicamente validada e mantida em um `ResponseEnvelope` interno com sua representação canônica, hash e tamanho. Esse envelope não atravessa a API pública. O `AgentRunResult` projeta somente:

- `output`, com `content`, `structuredData`, `finishReason` e `responseHash`;
- metadados e orçamento do prompt;
- o output contract provider-neutral;
- `provider`, com provider, modelo solicitado, modelo respondido e response ID;
- `metrics.observed`, com duração total, duração do Prompt Builder, duração observada da chamada ao provider e bytes enviados e recebidos;
- `metrics.reported`, com duração, tentativas e uso de tokens informados pelo provider.

Métricas observadas e reportadas permanecem separadas porque representam fontes e limites de medição diferentes. O Runner não recalcula tokens nem substitui valores reportados pelo provider.

As validações do Runner são exclusivamente técnicas e estruturais: entrada, configuração, coerência do resultado do Builder, resposta normalizada do provider e projeção final. Ele não valida contratos funcionais de PO, Developer ou QA, aderência do conteúdo ao JSON Schema, segurança semântica ou regras de negócio; essas responsabilidades continuam reservadas ao Response Validator.

Os eventos são `agent.run.started`, `agent.run.prompt.completed`, `agent.run.provider.completed`, `agent.run.completed`, `agent.run.failed`, `agent.run.cancelled` e `agent.run.timed_out`. Logs contêm apenas IDs, agente, tentativa, versões, hashes, modelo, provider, finish reason, durações, tentativas, uso, bytes e códigos de erro aplicáveis. Nunca contêm prompts, respostas, structured data, API keys, authorization headers, cookies, segredos ou JSON Schemas completos.

O Runner não seleciona prompts, conhecimento, agentes ou modelos; não cria `AgentExecution`; não altera estados; não persiste resultados; não cria artifacts; e não decide a ordem do pipeline.

## Consequences

- Prompt Builder, AI Provider e Runner mantêm contratos independentes e testáveis;
- adapters de provider podem ser substituídos sem alterar o Runner;
- a resposta pública não vaza `AIResponse` nem detalhes do SDK;
- correlação, hashes e métricas permitem auditoria sem registrar conteúdo sensível;
- cancelamento e timeout possuem um único caminho, sem timers concorrentes;
- retries, validação funcional, persistência e coordenação permanecem fora desta Sprint.
