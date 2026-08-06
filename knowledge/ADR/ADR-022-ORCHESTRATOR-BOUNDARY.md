# ADR-022 — Orchestrator Boundary and Deterministic Sequential Workflow

## Status

Accepted

## Date

2026-08-05

## Context

As fachadas funcionais de Product Owner, Developer e QA já existem e são independentes. A
plataforma precisa coordená-las sem transferir para o coordenador a lógica de negócio, o pipeline
interno dos agentes ou responsabilidades futuras do Execution Engine.

O ADR-001 define um Orchestrator central e o ADR-002 proíbe comunicação direta entre agentes. O
ADR-011 fixa `core/` como diretório canônico da lógica central e já reserva
`core/orchestrator/`. Portanto, criar `orchestrator/` como novo diretório de raiz violaria o layout
aceito e exigiria alterar uma decisão histórica.

## Decision

Implementar o workspace privado `@brq/orchestrator` em `core/orchestrator/`, com um único
workflow fixo e sequencial:

```text
Human Request → Product Owner Agent → Developer Agent → QA Agent → WorkflowResult
```

O Orchestrator depende somente dos entrypoints públicos dos três agentes e de utilitários
transversais do Shared Layer. As fachadas são injetadas como interfaces e cada uma é chamada no
máximo uma vez por workflow.

O chamador fornece `workflowId`, `executionId`, correlações opcionais e um
`agentExecutionId` distinto para cada etapa. O Orchestrator não gera IDs e fixa `attempt: 1`.

O estado é local e efêmero: `CREATED → RUNNING → SUCCESS | FAILED | CANCELLED`. Não existe
persistência, resume ou transição de entidades do Execution Engine nesta Sprint.

Rejeições funcionais `VALIDATION_REJECTED` encerram o fluxo e retornam um `WorkflowResult` com
status `FAILED`. Erros técnicos e cancelamentos são propagados como `OrchestratorError`, que
carrega um `WorkflowResult` terminal imutável com os resultados públicos concluídos antes da
falha.

O mesmo `AbortSignal` é propagado às três fachadas. O Orchestrator verifica cancelamento antes da
primeira etapa, entre etapas e antes da finalização.

`WorkflowResult` mantém contratos separados para:

- `lineage`: hashes das specifications e verificação dos handoffs;
- `provenance`: identidade técnica, assets, knowledge, prompt, response, validação e geração de
  cada resultado público;
- `timeline`: sequência observacional monotônica de eventos e durações;
- `metrics`: métricas observadas e reportadas sem mistura;
- `hashes`: request, etapas, lineage, provenance e workflow.

Timeline, timestamps, durações e métricas não participam dos hashes determinísticos. O
`workflowHash` depende somente da entrada validada, do estado terminal, dos hashes das etapas, de
lineage, de provenance e do código estável de falha.

O Orchestrator valida somente as fronteiras públicas dos resultados. Ele não executa Response
Validator nem interpreta respostas de modelo.

Logs usam allowlist e contêm apenas identidade do workflow, etapa, agente, duração, hashes,
métricas e erro sanitizado. Demanda, prompts, specifications, artifacts e respostas nunca são
registrados.

## Dependency boundary

Produção pode depender apenas de:

```text
@brq/product-owner-agent
@brq/developer-agent
@brq/qa-agent
@brq/shared
zod
node:crypto
```

Imports internos dos agentes e dependências diretas de AI Provider, Knowledge Loader, Prompt
Builder, Agent Runner, Response Validator, Artifact Generator, Prisma, apps ou Execution Engine
são proibidos.

## Consequences

- a ordem de chamadas é determinística e testável;
- resultados anteriores permanecem disponíveis após falhas;
- lineage e provenance ficam explícitos sem expor implementações internas;
- observabilidade temporal existe, mas não compromete hashes;
- o workflow inicial não é configurável e não executa em paralelo;
- o resultado pode ser volumoso porque consolida os resultados públicos dos três agentes;
- cancelamento continua cooperativo nos limites das fachadas chamadas.

O ADR-001 continua prevendo retries centralizados como responsabilidade futura do Orchestrator,
mas retry e backoff não são implementados na Sprint 12.

## Out of scope

- Execution Engine;
- persistência, filas, scheduler e concorrência;
- retry funcional ou automático;
- revisão humana;
- API, frontend, websocket e eventos externos;
- execução de testes e geração de código;
- workflows dinâmicos;
- qualquer item da Sprint 13.
