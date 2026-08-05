# ADR-013 — AI Provider Boundary and Resilience

## Status

Accepted

## Date

2026-08-05

## Context

O ADR-011 definiu `core/ai-provider` como parte da camada central, mas ainda era necessário separar o contrato abstrato dos detalhes da OpenAI, estabelecer uma política de resiliência sem antecipar o Agent Runner e distinguir tentativas técnicas de transporte dos retries funcionais controlados futuramente pelo Orchestrator.

## Decision

A interface `AIProvider` e seus contratos específicos pertencem a `core/ai-provider`. Eles são independentes de SDK, endpoint, agente, prompt, persistência e regras do Orchestrator. Apenas tipos realmente transversais de `shared`, como `TokenUsage`, JSON e logger, podem ser reutilizados.

`OpenAIProvider` é o primeiro adapter e utiliza a Responses API por meio do SDK oficial. Esse detalhe não aparece na interface abstrata. A implementação envia solicitações síncronas com armazenamento remoto desabilitado, endpoint oficial fixo e logging interno do SDK desligado, traduzindo respostas e erros para contratos canônicos.

`FakeAIProvider` é o adapter determinístico utilizado pela suíte padrão. Ele simula sucesso, timeout, cancelamento, rate limit, resposta técnica inválida, falha de conexão, falha permanente, JSON malformado e structured output incompatível.

O timeout padrão é de 60 segundos e pode ser sobrescrito por configuração server-side ou por chamada dentro de limites validados. Cancelamento usa `AbortSignal` e nunca gera retry.

Retries técnicos pertencem ao adapter e são limitados a falhas de conexão nas quais nenhuma resposta HTTP válida foi recebida. O SDK é configurado com retry interno desabilitado. Erros HTTP, autenticação, permissão, entrada inválida, rate limit, indisponibilidade respondida por HTTP, recusas, respostas funcionais e conteúdo inválido nunca são repetidos pelo provider.

Retries funcionais permanecem responsabilidade futura do Orchestrator e criam uma nova `AgentExecution`. Tentativas técnicas do provider permanecem dentro da mesma chamada e não alteram o domínio.

A chave `OPENAI_API_KEY` é lida somente no servidor. Logs do provider contêm apenas metadados técnicos e nunca registram prompts, respostas completas, chaves, headers de autorização, cookies ou JSON Schemas completos.

## Consequences

- novos providers podem implementar o contrato sem conhecer a Responses API;
- o Agent Runner futuro poderá depender apenas da interface abstrata;
- falhas de conexão transitórias possuem recuperação limitada sem criar uma nova tentativa de agente;
- respostas recebidas por HTTP nunca geram custo duplicado por retry automático do adapter;
- validação funcional de JSON e schemas continua reservada ao Response Validator;
- chamadas reais à OpenAI permanecem opcionais e fora da suíte padrão e da CI.
