# ADR-024 — HTTP API Adapter Boundary and Application Composition Root

## Status

Accepted

## Date

2026-08-06

## Context

O ADR-023 estabeleceu o `@brq/execution-engine` como única fronteira autorizada a iniciar o
Orchestrator. A plataforma precisa expor essa capacidade por HTTP sem mover regras de negócio,
estado, retry ou persistência para o transporte.

O ADR-008 fixa Next.js com App Router e o ADR-011 reserva `apps/web` para o host web. Criar um
workspace de domínio apenas para compor dependências misturaria bootstrap da aplicação com o
nicho funcional do núcleo.

## Decision

Implementar a API exclusivamente com Next.js 16 Route Handlers em `apps/web/src/app/api/`. A API é
um adapter síncrono e stateless. Ela recebe HTTP, aplica controles de transporte, valida contratos
com Zod, chama somente a API pública do Execution Engine e converte o resultado sem recalcular ou
alterar hashes, lineage, provenance ou métricas.

Os únicos endpoints da Sprint 14 são:

- `GET /api/health`;
- `POST /api/executions`;
- `GET /api/executions/[id]`.

`POST /api/executions` recebe o shape público de `ExecutionRequest` sem `requestId` e sem
`executionId`. O adapter gera `requestId` com `crypto.randomUUID()`, devolve-o no header e nos
metadados e o injeta antes de chamar o Engine. A execução continua determinística para o
`ExecutionRequest` completo recebido pelo Engine; duas chamadas HTTP possuem correlações distintas
e, portanto, entradas distintas. Os hashes retornados pelo Engine são apenas transportados.

A criação é síncrona e não persistida. Um `ExecutionResult` resolvido, inclusive `FAILED`
funcional, retorna HTTP 200. Não se utiliza 201 porque nenhum recurso consultável é criado.
`GET /api/executions/[id]` valida o formato do ID e retorna HTTP 501 com contrato estável até que
uma futura Sprint implemente persistência. `GET /api/health` retorna versões estáticas e não
inicializa knowledge, provider, Engine ou workflow.

O body de criação exige `application/json`, UTF-8, ausência de compressão e no máximo 512 KiB. O
limite é verificado tanto no `Content-Length` quanto nos bytes realmente lidos. Schemas são
estritos, query parameters são rejeitados, métodos suportados pelo Route Handler são expostos
explicitamente para respostas 405 uniformes e não existe CORS permissivo.

Todas as respostas seguem `{ success, data, metadata, errors }`, usam versão HTTP `1.0.0`, incluem
`x-request-id`, `Cache-Control: no-store` e headers mínimos de segurança. Erros têm códigos e
mensagens sanitizados; causas internas não atravessam a fronteira.

O composition root pertence ao host e fica em `apps/web/src/server/runtime.ts`. Ele apenas monta
o grafo imutável de factories públicas e fornece um `ExecutionEngine` lazy para o Route Handler.
Não existe workspace `core/ai-factory-runtime`. O runtime não armazena execuções, não implementa
service locator de domínio e não é carregado pelo health check.

O mesmo `AbortSignal` da requisição é propagado ao Engine. A API não implementa timeout próprio,
retry, execução assíncrona, cache ou registro de resultados.

## Dependency boundary

O código do adapter em `apps/web/src/app/api` pode depender apenas de:

```text
public @brq/execution-engine API
@brq/shared logger/schemas
zod
Web Request/Response APIs
Next.js Route Handler conventions
```

Imports de Product Owner, Developer, QA, Orchestrator, AI Provider, Knowledge Loader, Prompt
Builder, Agent Runner, Response Validator, Artifact Generator, Prisma ou repositories são
proibidos no adapter.

Exclusivamente o composition root do host pode importar factories públicas desses componentes
para construir o grafo. Essa composição não adiciona regras de negócio e não altera suas
fronteiras.

## HTTP status mapping

| Situação                                     | Status |
| -------------------------------------------- | -----: |
| health                                       |    200 |
| `ExecutionResult` resolvido                  |    200 |
| JSON, contrato, query ou ID inválido         |    400 |
| cancelamento propagado pelo Engine           |    408 |
| payload acima de 512 KiB                     |    413 |
| media type ou encoding não suportado         |    415 |
| método não permitido                         |    405 |
| consulta por ID ainda indisponível           |    501 |
| configuração/runtime indisponível            |    503 |
| falha técnica ou violação contratual interna |    500 |

## Logging and security

Eventos HTTP registram somente `requestId`, endpoint estático, método, status, duração,
`executionId` quando conhecido e código sanitizado de erro. URL completa, query, headers, body,
demanda, prompts, specifications, artifacts, respostas do modelo e `ExecutionResult` são
proibidos.

O `requestId` e a duração são observacionais. A geração de correlação não usa conteúdo do usuário
e não substitui os identificadores determinísticos do Engine.

## Consequences

- toda execução HTTP passa obrigatoriamente pelo Execution Engine;
- health permanece disponível mesmo sem configuração OpenAI válida;
- não existe consulta real após a resposta de criação;
- a inicialização do grafo ocorre apenas na primeira criação e pode retornar 503;
- o contrato já diferencia falha HTTP de resultado funcional `FAILED`;
- o host conhece a composição concreta, enquanto o adapter conhece somente o Engine;
- a API permanece incompatível com uso assíncrono até uma decisão futura.

## Out of scope

- autenticação e autorização;
- persistência, banco, repositories e consulta real;
- filas, workers, scheduler, retry e concorrência;
- websocket, SSE, eventos externos e monitoramento distribuído;
- cache, rate limit, upload e download;
- Swagger/OpenAPI, SDK e CLI;
- frontend funcional, Playwright e deploy;
- qualquer item da Sprint 15.
