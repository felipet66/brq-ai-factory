# ADR-027 — Execution Repository Boundary

## Status

Accepted

## Date

2026-08-07

## Context

A Sprint 16 consolidou timeline, eventos, métricas por etapa e resumo de execução em uma projeção
imutável mantida em memória. Essa projeção permite observar um POST ativo e consultar um resultado
enquanto o processo permanece vivo, mas desaparece em restart, HMR ou substituição da instância e
não oferece paginação nem filtros para histórico.

A Sprint 17 precisa tornar esses metadados duráveis sem persistir o `ExecutionResult` completo e
sem levar Prisma para o Execution Engine, Observability, HTTP Adapter ou Frontend. A fronteira deve
preservar simultaneamente:

- o Execution Engine concreto definido pelo ADR-023, que permanece sem conhecimento de
  repositories e continua sendo o único componente autorizado a iniciar o Orchestrator;
- a projeção síncrona e fail-open de observabilidade definida pelo ADR-026, sem mudar sua timeline,
  eventos, métricas, hashes ou componentes de Frontend;
- o Prisma como tecnologia oficial e o SQLite como banco local do MVP, conforme ADR-006 e ADR-007;
- a minimização de dados: histórico consultável contém metadados, nunca conteúdo funcional do
  workflow.

O modelo `Execution` da Persistence Base foi criado antes do contrato público atual do Engine e
serve aos repositories legados. Alterá-lo para acumular as novas responsabilidades acoplaria dois
agregados com ciclos e invariantes diferentes. O histórico durável exige, portanto, uma raiz
própria e aditiva.

O `executionId` canônico é criado internamente pelo Engine. O caller e o coordinator de
persistência não podem reproduzir o algoritmo privado de hashing para antecipá-lo. Antes do retorno
público do Engine, a única correlação estável disponível ao host é o `workflowId` validado.

## Decision

Criar o workspace privado `@brq/execution-repository` em `core/execution-repository/`. Ele contém:

- o port assíncrono `ExecutionRecordRepository`;
- contratos e schemas Zod estritos do aggregate durável;
- mapper explícito entre contratos públicos minimizados e registros normalizados;
- adapter Prisma;
- adapter em memória para testes;
- errors, logging sanitizado e garantias de imutabilidade;
- um coordinator/decorator que envolve o `ExecutionEngine` público e coordena persistência sem
  executar regras de workflow.

A raiz durável é `ExecutionRecord`, separada do modelo legado `Execution`. Sua chave de correlação
é o `workflowId`; o `executionId` é único e anulável até o Engine devolver um resultado público ou
um `ExecutionEngineError` com resultado terminal. O repository nunca deriva nem recalcula o
`executionId`.

O composition root do host monta a cadeia:

```text
concrete Execution Engine
  → observed Execution Engine decorator
    → persistent execution coordinator
```

O coordinator depende apenas das APIs públicas de `@brq/execution-engine`,
`@brq/observability` e do port `ExecutionRecordRepository`. Ele não conhece Orchestrator, agentes,
Knowledge Loader, Prompt Builder, Agent Runner, AI Provider, Response Validator, Artifact
Generator ou internals desses módulos. O adapter HTTP recebe leitores públicos injetados pelo
host; ele não instancia Prisma nem contém queries.

Este ADR refina o ADR-012 exclusivamente para o novo aggregate `ExecutionRecord`: por decisão
arquitetural explícita da Sprint 17, seu port, contratos e adapters coabitam no workspace
`core/execution-repository`. Os repositories legados de `shared/` e seus adapters em `prisma/`
permanecem intactos; a regra anterior continua válida para eles. Esta decisão não autoriza mover ou
reescrever outros ports de persistência.

O ADR-023 continua autoritativo sobre o Engine concreto e o ADR-026 continua autoritativo sobre a
semântica observacional. Nenhum dos dois componentes recebe imports de Prisma ou lógica de
persistência.

O ADR-027 e o fluxo visual 41 permanecem como documentação arquitetural do repositório. Eles não
são adicionados ao manifesto nem à política runtime do Knowledge Loader nesta Sprint, preservando
os contextos, bytes, hashes e prompts protegidos dos agentes.

## Repository contract

O port é assíncrono e trabalha somente com contratos validados, minimizados e profundamente
imutáveis. Ele oferece operações para:

- criar o registro correlacionado por `workflowId`;
- aplicar uma transição de lifecycle válida e avançar sua revisão monotônica;
- anexar a projeção observacional e os metadados públicos terminais;
- consultar por `executionId` canônico;
- consultar timeline por `executionId` e, enquanto necessário, pela correlação de `workflowId`;
- listar registros com paginação por cursor e filtros allowlisted.

Os adapters Prisma e in-memory devem apresentar a mesma ordenação, semântica de ausência,
paginação, filtros e erros estáveis. Valores recebidos e devolvidos são validados e clonados antes
de serem profundamente congelados. Nenhum caller recebe referências mutáveis do estado interno.

O repository valida e persiste transições solicitadas pelo coordinator, mas não decide qual etapa
do workflow executar, não calcula readiness, não cria hashes e não interpreta conteúdo funcional.

## Durable aggregate

`ExecutionRecord` armazena somente os metadados necessários para lifecycle, consulta e
observabilidade:

- `workflowId`, `executionId` anulável, `requestId`, `traceId` e `projectName`;
- status local e status público do workflow;
- readiness final anulável;
- `createdAt`, `startedAt`, `finishedAt` e `durationMs`;
- versões do Engine, contrato e observabilidade;
- attempt e revisão de persistência;
- erro estável e sanitizado, quando houver;
- hashes públicos finais;
- resumo, timeline, eventos observacionais e métricas por etapa;
- lineage e provenance minimizados e normalizados.

`projectName` é o único metadado descritivo autorizado porque integra explicitamente o contrato da
lista de histórico. Ele pode ser retornado pela API, mas nunca é registrado nos logs. Objetivo,
demanda e contexto adicional continuam proibidos.

Lineage persiste somente hashes de outputs e handoffs públicos verificados. Provenance persiste
somente identidade técnica de estágio, agente, versões, outcome, readiness e hashes públicos,
incluindo hashes individuais de artifacts. Nenhum conteúdo de specification ou artifact acompanha
esses hashes.

## Normalized Prisma model

O schema Prisma é ampliado de forma aditiva, sem modificar a tabela legada `Execution`. O novo
aggregate é normalizado nas seguintes entidades conceituais:

- `ExecutionRecord`, raiz e correlação do lifecycle;
- `ExecutionRecordLifecycleEvent`, histórico ordenado de estados;
- `ExecutionRecordHash`, hashes finais nomeados;
- `ExecutionObservation`, versão e revisão do snapshot;
- `ExecutionObservedStage`, timeline canônica ordenada;
- `ExecutionStageMetric`, métricas de Product Owner, Developer e QA;
- `ExecutionObservationEvent`, eventos internos allowlisted e ordenados;
- `ExecutionLineageOutput` e `ExecutionLineageHandoff`;
- `ExecutionProvenanceStage` e `ExecutionProvenanceArtifactHash`.

Colunas escalares são usadas para campos consultáveis; relações representam coleções e
subestruturas. Não são gravados blobs JSON gigantes quando existe estrutura relacional adequada.
Datas físicas são `DateTime`, enquanto contratos públicos continuam usando ISO 8601. Hashes são
preservados exatamente como recebidos e jamais recalculados pelo mapper ou pelo adapter.

Relações históricas usam integridade referencial restritiva. O MVP não expõe hard delete, purge ou
política de retenção. A migration é aditiva e deve poder ser aplicada sobre a base das Sprints
anteriores.

## Persistence lifecycle

O coordinator controla somente a persistência ao redor da chamada pública:

```text
CREATED → RUNNING → SUCCESS | FAILED | CANCELLED
```

1. valida e grava `CREATED`, correlacionado por `workflowId`, antes de delegar;
2. grava `RUNNING` antes de chamar o Engine;
3. chama o Engine observado exatamente uma vez;
4. recebe `ExecutionResult` ou `ExecutionEngineError` público;
5. anexa o `executionId` canônico e persiste o estado terminal, resumo, observação, hashes,
   lineage e provenance minimizados;
6. devolve o mesmo resultado funcional ou propaga o erro público original quando a persistência
   terminal conclui.

Falhar ao criar ou marcar `RUNNING` é fail-closed: o workflow não começa. Depois que a delegação ao
Engine ocorre, nenhuma falha de persistência autoriza uma segunda chamada. Uma falha terminal é
sanitizada e propagada pelo coordinator, podendo deixar o registro `RUNNING` até reconciliação
futura. Sem outbox, transação distribuída, worker ou retry, a Sprint 17 não promete exactly-once
entre execução do workflow e gravação terminal.

O coordinator não muda o estado local do Engine, sua timeline, suas decisões ou seus hashes. Ele
mantém `attempt: 1`, não retoma, não reexecuta e propaga o mesmo `AbortSignal` sem armazená-lo.

## Relationship with Sprint 16 observability

O store em memória da Sprint 16 permanece uma projeção interna, síncrona, limitada e fail-open para
coletar o progresso durante a chamada. Sua implementação e seus contratos não são reescritos. O
coordinator consome apenas snapshots públicos produzidos por essa fronteira e os projeta para o
aggregate durável.

O repository passa a ser a fonte das consultas de histórico concluído e das APIs de Sprint 17. O
store em memória não é fallback autoritativo para registros terminados. Enquanto uma execução está
ativa no mesmo processo, o `workflowId` continua sendo a correlação disponível; snapshots capturados
podem ser persistidos de forma ordenada sem bloquear nem alterar a coleta observacional.

Eventos, timestamps, durações, métricas e custo estimado continuam observacionais e fora dos hashes
determinísticos. O repository apenas transporta os hashes finais do Engine.

## HTTP queries

Os Route Handlers continuam sendo adapters e recebem o repository por injeção do host:

```text
GET /api/executions
GET /api/executions/[id]
GET /api/executions/[id]/timeline
```

A listagem aceita somente `status`, `readiness`, `createdAfter`, `createdBefore`, `limit` e
`cursor`. Ordenação e desempate são estáveis; o cursor é opaco para o Frontend. Datas e limites são
validados antes da consulta. O detail retorna a projeção pública minimizada do registro, e timeline
retorna o contrato observacional existente sem conteúdo funcional.

Ausência retorna `404`; parâmetros inválidos retornam `400`; erros do repository são traduzidos
para resposta técnica sanitizada. A API não acessa Prisma, não contém SQL, não muda hashes e não
reconstrói regras de lifecycle.

## Security and data minimization

É permitido persistir somente:

- IDs técnicos e versões;
- status, readiness, timestamps e duração;
- métricas, contagens e custo estimado já aprovado pelo contrato observacional;
- hashes públicos finais;
- lineage e provenance minimizados por hashes e identidades técnicas;
- timeline e eventos allowlisted;
- `projectName`, exclusivamente para a consulta de histórico solicitada.

É sempre proibido persistir:

- prompts, rules, templates ou output contracts;
- objetivo, demanda ou contexto adicional do usuário;
- documentos ou contexto composto de knowledge;
- specifications ou respostas completas da IA;
- artifacts, conteúdo renderizado ou output bruto;
- segredos, chaves, headers, cookies ou credenciais;
- `AbortSignal`, logger, errors crus, stack traces ou objetos internos.

Schemas estritos rejeitam campos desconhecidos. Mappers usam allowlists explícitas. Logs do módulo
contêm somente operação, IDs técnicos, status, duração, contagens e código de erro sanitizado; não
registram `projectName` nem valores persistidos em massa.

## Consistency, failure and cancellation

- escrita inicial e transição para `RUNNING` são obrigatórias antes da delegação;
- transições validam o estado atual e avançam uma revisão monotônica para auditoria;
- terminal é imutável e não aceita nova transição;
- cancelamento antes ou durante a execução termina em `CANCELLED` quando o resultado público do
  Engine estiver disponível;
- falha funcional termina em `FAILED` e preserva resultados anteriores minimizados;
- falha técnica terminal preserva o código sanitizado, sem causa crua;
- queries devolvem snapshots imutáveis e nunca objetos vivos do Prisma Client;
- nenhuma falha de escrita posterior à chamada pode causar retry do workflow.

SQLite oferece atomicidade local por transação, mas continua limitado a um único host. Múltiplas
instâncias, failover e alta disponibilidade exigem uma infraestrutura e uma decisão arquitetural
futuras. Um crash entre `RUNNING` e a gravação terminal pode deixar execução obsoleta nesse estado;
a Sprint 17 não introduz reconciler, worker ou recuperação automática.

## Dependency boundary

O workspace pode depender somente de APIs públicas estritamente necessárias:

```text
@brq/execution-engine
@brq/observability
@brq/prisma
@brq/shared
zod
Prisma Client gerado
```

O entrypoint principal expõe contratos e o adapter in-memory sem obrigar consumidores do port a
conhecer Prisma. O adapter concreto fica em subpath público explícito do próprio workspace. Boundary
tests proíbem deep imports e imports de agentes, Orchestrator, componentes inferiores e código de
`apps/`.

## Consequences

- histórico terminal sobrevive a restart e deixa de depender do store local da Sprint 16;
- APIs por ID, timeline e listagem usam uma fonte durável comum;
- Prisma permanece encapsulado atrás de um port testável;
- o Engine concreto e Observability permanecem inalterados;
- o aggregate legado `Execution` continua compatível com os repositories anteriores;
- o adapter in-memory permite testes determinísticos sem banco ou provider;
- o coordinator adiciona um modo explícito de falha antes de iniciar o workflow quando a
  persistência está indisponível;
- falha terminal pode deixar estado `RUNNING`, risco aceito até uma futura estratégia de outbox ou
  reconciliação;
- SQLite continua adequado apenas ao MVP local e a um único host.

## Out of scope

- alterar o modelo legado `Execution` ou os repositories históricos;
- modificar Product Owner, Developer, QA, Prompt Builder, Response Validator, Business Validation,
  output contracts, prompt assets ou runtime prompt budget;
- modificar a semântica de Observability, timeline ou Frontend da Sprint 16;
- persistir conteúdo funcional, artifacts ou respostas do provider;
- RabbitMQ, Kafka, Redis, filas, workers, scheduler, cron ou background jobs;
- outbox, exactly-once distribuído, retry, retomada ou reconciliação automática;
- WebSocket, SSE, streaming ou OpenTelemetry;
- autenticação, autorização, rate limit ou política de retenção;
- Playwright ou chamadas reais à OpenAI;
- qualquer item da Sprint 18.
