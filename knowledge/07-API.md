# API

## Objetivo

Expor o Execution Engine por HTTP sem transferir qualquer regra de negócio para o transporte. A
implementação normativa está no ADR-024 e utiliza somente Next.js 16 Route Handlers.

## Fronteira

```text
HTTP Request
  → controles de transporte
  → schema Zod
  → public Execution Engine API
  → HTTP Response
```

A API não conhece Product Owner, Developer, QA, Orchestrator interno, Prompt Builder, Knowledge
Loader, AI Provider, Agent Runner, Response Validator ou Artifact Generator. Também não acessa
Prisma, repositories ou banco.

O composition root é parte do host Next.js em `apps/web/src/server/runtime.ts`. Ele apenas monta
o grafo com factories públicas e fornece o `ExecutionEngine` de forma lazy. Não existe workspace
de runtime no domínio.

## Endpoints implementados

| Método | Endpoint               | Comportamento                                                |
| ------ | ---------------------- | ------------------------------------------------------------ |
| GET    | `/api/health`          | versões estáticas, sem inicializar Engine, IA ou banco       |
| POST   | `/api/executions`      | execução síncrona pelo Engine e retorno de `ExecutionResult` |
| GET    | `/api/executions/[id]` | valida ID e retorna 501 enquanto não existe persistência     |

Nenhum outro endpoint integra a Sprint 14.

## Request de execução

O body segue `ExecutionRequest`, exceto por:

- `executionId`, sempre criado pelo Engine e proibido no HTTP request;
- `requestId`, sempre criado pelo adapter e proibido no HTTP request.

`workflowId`, demanda, contexto opcional, trace opcional e configurações públicas dos três agentes
são validados por schema estrito. IDs de execução dos agentes devem ser distintos.

## Response pattern

Todas as respostas seguem:

```text
{
  success,
  data,
  metadata: { requestId, apiVersion, executionId? },
  errors
}
```

A versão do contrato HTTP é `1.0.0`. Os paths continuam sem prefixo de versão nesta fase. Uma
mudança incompatível exigirá nova decisão arquitetural.

## Status

- 200: health ou `ExecutionResult` resolvido, inclusive `FAILED` funcional;
- 400: JSON, query, ID ou contrato inválido;
- 405: método não permitido;
- 408: cancelamento propagado pelo Engine;
- 413: payload acima de 512 KiB;
- 415: media type, encoding ou UTF-8 não suportado;
- 500: falha técnica ou violação de contrato interno;
- 501: consulta por ID não suportada no MVP;
- 503: runtime ou configuração indisponível.

Não existe 201 porque a Sprint não cria um recurso persistido e consultável.

## Segurança

`POST` exige `application/json`, encoding ausente ou `identity`, UTF-8 válido e no máximo 512 KiB.
O limite é verificado no header e durante a leitura real do stream. Query parameters e campos
desconhecidos são rejeitados.

Respostas usam JSON UTF-8, `Cache-Control: no-store`, `X-Content-Type-Options`, `X-Frame-Options`,
CSP, Referrer Policy, Permissions Policy e Cross-Origin Resource Policy restritivas. Não existe
CORS permissivo, autenticação ou rate limit nesta Sprint.

## Observabilidade

O adapter cria `requestId` com `crypto.randomUUID()`, ecoa-o em `x-request-id` e nos metadados e o
passa ao Engine. Logs HTTP contêm somente correlações, endpoint estático, método, status, duração e
código sanitizado. Conteúdo do usuário, URLs completas, headers, prompts, specifications, artifacts,
respostas da IA e resultados nunca são registrados pela camada HTTP.

## Fora do escopo

Projects, Agents, Prompts, logs e artifacts como endpoints; autenticação; autorização;
persistência; banco; filas; execução assíncrona; websocket; SSE; cache; rate limit; upload;
download; OpenAPI; SDK; CLI; frontend funcional e qualquer item da Sprint 15.
