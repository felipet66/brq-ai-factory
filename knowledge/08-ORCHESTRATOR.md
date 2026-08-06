# Orchestrator

## Objetivo

O Orchestrator é a fronteira central de coordenação entre agentes. Na Sprint 12 ele executa um
único workflow fixo, sequencial e efêmero, sem assumir responsabilidades internas das fachadas.

Decisão normativa: [ADR-022](ADR/ADR-022-ORCHESTRATOR-BOUNDARY.md).

## Workflow implementado

```text
Human Request
  → Product Owner Agent
  → Developer Agent
  → QA Agent
  → WorkflowResult
```

Cada etapa inicia somente depois de um resultado `GENERATED` da anterior. Uma readiness diferente
de `READY` é preservada, mas não bloqueia o avanço nesta Sprint porque revisão humana não integra o
workflow.

## Responsabilidades atuais

- validar `WorkflowRequest`;
- controlar a ordem fixa das três chamadas;
- projetar somente contracts e specifications públicas;
- fixar `attempt: 1` e usar IDs fornecidos pelo caller;
- propagar o mesmo `AbortSignal`;
- validar o `AgentResult` na fronteira pública;
- interromper imediatamente em rejeição, erro ou cancelamento;
- preservar resultados concluídos;
- verificar lineage dos handoffs;
- consolidar timeline, lineage, provenance, métricas e hashes;
- produzir `WorkflowResult` imutável;
- emitir logs allowlisted.

Validar a fronteira pública não significa executar Response Validator: o Orchestrator não acessa a
resposta do modelo e não interpreta a lógica funcional dos agentes.

## Responsabilidades proibidas na Sprint 12

- chamar OpenAI ou AI Provider;
- carregar knowledge ou construir prompts;
- executar Agent Runner, Response Validator ou Artifact Generator;
- gerar ou persistir artifacts;
- criar ou alterar entidades de execução;
- retry, backoff ou nova tentativa;
- revisão humana;
- concorrência, filas ou scheduler;
- API, frontend ou eventos externos.

## Estados locais

```text
CREATED → RUNNING → SUCCESS | FAILED | CANCELLED
CREATED → CANCELLED
```

Esses estados existem somente durante `execute`. Eles não substituem os estados persistentes de
`Execution` e não usam o Execution Engine.

## Falhas

`VALIDATION_REJECTED` é uma falha funcional controlada e retorna `WorkflowResult` com `FAILED`.
Erros técnicos e cancelamento são propagados como `OrchestratorError`, que mantém um
`WorkflowResult` terminal parcial quando o request já foi validado.

Nenhuma falha chama o agente seguinte. Não há retry.

## Timeline

A timeline registra eventos ordenados de início e término do workflow e das etapas. Cada evento
possui sequência, estágio, agente, `timestampMs` monotônico e duração opcional. Timestamps e
durações são observacionais e ficam fora de todos os hashes determinísticos.

## Lineage

Lineage registra hashes canônicos das specifications e verifica os três handoffs possíveis:

- Product Owner → Developer;
- Product Owner → QA;
- Developer → QA.

## Provenance

Provenance registra separadamente as identidades de execução e hashes públicos de assets,
knowledge, prompt, response, validação, geração e artifacts. Não contém specifications ou conteúdo
de artifacts.

## Logs

Além do envelope do logger, somente `workflowId`, `executionId`, etapa, agente, duração, hashes,
métricas e erro sanitizado são permitidos. Prompts, specifications, artifacts, resposta do modelo e
conteúdo do usuário são proibidos.

## Integração com o Execution Engine

Desde a Sprint 13, o único caller de produção é `@brq/execution-engine`. O Engine cria o
`executionId` e o fornece no `WorkflowRequest`; o Orchestrator continua sem gerar IDs, alterar
estado de execução ou conhecer o Engine. A dependência permanece unidirecional
`Execution Engine → Orchestrator`.

## Evolução futura preservada

ADRs e documentos de domínio preveem persistência, revisão humana, retomada e retries
centralizados. Essas responsabilidades não foram transferidas para agentes e continuam futuras;
serão integradas somente em Sprints próprias de Persistence e workflow avançado. O Execution
Engine da Sprint 13 também permanece sem essas capacidades.

## Regras

- nunca executar dois agentes simultaneamente no workflow inicial;
- nunca permitir comunicação operacional direta entre agentes;
- nunca gerar IDs aleatórios;
- nunca incluir timeline ou métricas nos hashes;
- nunca acessar deep imports das fachadas.
