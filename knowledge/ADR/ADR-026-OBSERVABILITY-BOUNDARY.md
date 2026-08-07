# ADR-026 — Execution History and Observability Boundary

## Status

Accepted

## Data

2026-08-07

## Contexto

A plataforma já executa o workflow fixo Product Owner → Developer → QA pela fronteira pública do
Execution Engine. O Orchestrator e o Engine expõem hashes determinísticos, lineage, provenance,
métricas agregadas e timelines observacionais, mas o host HTTP não mantém uma visão consultável da
execução depois que `POST /api/executions` termina. Portanto, o Frontend não consegue inspecionar o
progresso das etapas nem renderizar um histórico consolidado da execução.

A Sprint 16 precisa de um modelo de observação limitado e inspecionável sem transformar o adapter
HTTP em camada de negócio, permitir que a observabilidade inicie o Orchestrator, persistir dados de
domínio ou mudar o comportamento de Product Owner, Developer, QA, Prompt Builder, Response
Validator, Artifact Generator ou seus assets versionados.

Os resultados públicos atuais não carregam todas as durações exigidas pelas novas métricas de
etapa. As durações de validação e geração de artifacts já são emitidas por logs sanitizados. O
browser também conhece `workflowId` antes de enviar o POST síncrono, mas só conhece o
`executionId` canônico quando o Engine inicia e o POST finalmente responde. Esses fatos exigem uma
fronteira explícita de correlação.

## Decisão

Criar o workspace privado `@brq/observability` em `core/observability/`. Ele é responsável pelos
contratos tipados e imutáveis de observação da execução, pela projeção de valores públicos de
`ExecutionResult`, pela timeline, pelas métricas de cada etapa, pelo resumo público e por um
histórico limitado em memória.

O workspace pode depender somente de:

```text
@brq/execution-engine
@brq/shared
zod
```

Ele não pode importar Orchestrator, agentes, Prompt Builder, Knowledge Loader, Agent Runner, AI
Provider, Response Validator, Artifact Generator, Prisma, repositories, código da aplicação ou
deep imports de outro workspace.

O composition root da aplicação conecta dois mecanismos de integração:

1. um decorator de `ExecutionEngine` que observa chamadas e resultados públicos, delegando cada
   execução exatamente uma vez ao Engine original;
2. uma bridge de logger que encaminha o log estruturado existente sem alteração e projeta somente
   eventos e campos técnicos aprovados para o collector de observabilidade.

Nenhum dos mecanismos toma decisões de workflow. O Execution Engine subjacente permanece como
único componente autorizado a iniciar o Orchestrator.

Este ADR e o fluxo visual 40 permanecem como documentação arquitetural do repositório, sem serem
adicionados ao manifesto ou à política runtime do Knowledge Loader nesta Sprint. Assim, os
contextos, bytes, hashes e prompts de Product Owner, Developer e QA permanecem idênticos aos da
versão `1.12.0` já aprovada.

## Modelo de observação

A timeline pública possui quatro etapas canônicas, com ordem e identidades estáveis:

| Stage ID        | Nome público  | Significado                                                       |
| --------------- | ------------- | ----------------------------------------------------------------- |
| `KNOWLEDGE`     | Knowledge     | Contexto inicial de conhecimento do Product Owner disponibilizado |
| `PRODUCT_OWNER` | Product Owner | Processamento do Product Owner após o contexto inicial            |
| `DEVELOPER`     | Developer     | Tentativa do Developer                                            |
| `QA`            | QA            | Tentativa do QA                                                   |

`EXECUTION` e `WORKFLOW` são identidades de estágio permitidas nos eventos internos para marcar o
ciclo local do Engine e a consolidação do workflow. Elas não são entradas adicionais do array
público `stages`.

`KNOWLEDGE` significa deliberadamente apenas o contexto inicial do Product Owner. Developer e QA
continuam carregando seus próprios contextos autorizados dentro de suas fronteiras inalteradas;
essas operações permanecem incluídas nas durações dos respectivos agentes e não se tornam novas
etapas de topo.

Cada entrada da timeline contém somente:

- `stageId`;
- `stageName`;
- `status`;
- `startedAt`;
- `finishedAt`;
- `durationMs`;
- `requestId`;
- `executionId`.

Os status permitidos são `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED` e `SKIPPED`.
`startedAt`, `finishedAt` e `durationMs` são anuláveis enquanto a etapa ainda não alcançou o ponto
correspondente do ciclo de vida. Timestamps usam ISO 8601 e durações são inteiros seguros não
negativos.

Uma etapa malsucedida interrompe o workflow ordenado. A etapa ativa torna-se `FAILED` ou
`CANCELLED`, todas as etapas posteriores tornam-se `SKIPPED` e todas as entradas terminais
anteriores são preservadas. Não há retry, retomada ou reordenação.

As projeções da timeline são snapshots imutáveis. Uma atualização cria e congela um novo snapshot;
nenhum caller recebe uma entrada mutável do store.

## Eventos internos de observabilidade

A nova taxonomia interna é intencionalmente menor do que a taxonomia existente de logs:

```text
execution.started
execution.finished
execution.failed
stage.started
stage.finished
stage.failed
```

Os eventos formam uma união discriminada estrita, são validados por Zod e profundamente congelados
antes da publicação. Eles contêm somente a allowlist da timeline, a identidade do evento, o status
terminal e um código estável e sanitizado de falha quando aplicável. Nunca carregam prompt, entrada
do usuário, conteúdo de knowledge, specifications, respostas do modelo, artifacts, issues de
validação com valores, stack traces ou causas cruas.

Esses eventos não renomeiam nem substituem logs existentes como `execution.completed`,
`execution.cancelled`, `workflow.stage.completed` ou eventos específicos dos agentes. A bridge de
logger normaliza sinais aprovados para o novo vocabulário. Cancelamento é representado por
`execution.failed` ou `stage.failed` com status observável `CANCELLED`; as semânticas originais dos
logs `execution.cancelled` e `workflow.cancelled` permanecem inalteradas.

A bridge aceita uma allowlist explícita de nomes de eventos e campos. Eventos e campos desconhecidos
são ignorados, nunca copiados. A transição inicial de conhecimento é derivada de
`product_owner.knowledge.loaded`. As transições de agentes, validação e geração usam somente seus
eventos técnicos sanitizados e IDs de correlação já existentes.

## Métricas por etapa

Product Owner, Developer e QA expõem cada um uma projeção imutável `StageMetrics` contendo:

- `durationMs`;
- `promptBytes`;
- `completionBytes`;
- `inputTokens`;
- `outputTokens`;
- `totalTokens`;
- `providerLatencyMs`;
- `validationDurationMs`;
- `artifactGenerationDurationMs`.

A projeção preserva a origem das medições, sem inventar valores:

- a duração do agente vem da duração pública da etapa no workflow;
- os bytes do prompt vêm do orçamento público usado pelo Agent Runner;
- os bytes da completion vêm dos bytes recebidos observados pelo Runner;
- tokens de entrada e saída vêm do uso reportado pelo provider;
- a latência do provider vem da duração observada pelo Runner;
- durações de validação e geração de artifacts vêm somente de eventos de log sanitizados e
  correlacionados.

Métricas que não podem existir porque uma fase não foi executada são `null`; nunca são substituídas
silenciosamente por zero. `totalTokens` é calculado somente a partir das contagens reportadas
presentes e deve permanecer um inteiro seguro.

## Execution Summary

O resumo público contém somente:

- `executionId`;
- `workflowStatus`;
- `readinessFinal`;
- `totalDurationMs`;
- `totalTokens`;
- `totalCostEstimate`;
- etapas executadas;
- etapas ignoradas;
- hashes finais.

As listas de etapas executadas e ignoradas cobrem as quatro entradas públicas da timeline:
`KNOWLEDGE`, `PRODUCT_OWNER`, `DEVELOPER` e `QA`. Métricas detalhadas continuam restritas aos três
agentes.

`readinessFinal` é a readiness da última specification funcional gerada com sucesso e pode ser
`null`. Os hashes são copiados exatamente do `ExecutionResult` público validado; o módulo de
observabilidade nunca os recalcula ou altera.

`totalCostEstimate` é anulável. A Sprint 16 não possui rate card aprovado e versionado e não pode
incorporar preços voláteis do provider nem inferir preço apenas da quantidade de tokens. Um rate
card futuro, versionado e fornecido pelo host poderá preencher o campo sem mudar a semântica da
execução.

A fronteira de minimização do Frontend permanece válida: `ExecutionResult`, resultados do workflow,
specifications e artifacts brutos ficam dentro da integração HTTP client/server e nunca são
propagados para estado ou props React. A apresentação recebe somente projeções minimizadas de resumo
e timeline.

## Hashes e determinismo

Observabilidade é estritamente observacional. Nunca participam dos hashes determinísticos do Engine
ou do Orchestrator:

- eventos e sua ordem de entrega fora da sequência canônica do workflow;
- timestamps e durações;
- métricas por etapa e totais de tokens;
- estimativas de custo;
- capacidade, eviction ou correlação de lookup do store;
- frequência de polling e request IDs usados somente para consultar a timeline.

O decorator devolve o mesmo resultado público ou propaga o mesmo erro produzido pelo Engine
subjacente. Mudar relógios, cadência de polling ou estado do store não pode alterar execution IDs,
hashes, lineage, provenance, decisões do workflow ou a sequência de chamadas aos agentes.

## Histórico em memória

A Sprint 16 usa um store em memória, limitado e local ao processo. Sua capacidade é centralizada e
configurável pelo host. Registros são indexados pelo `executionId` canônico; um workflow ativo
também possui correlação temporária `workflowId → executionId`.

Registros terminais são removidos deterministicamente pela ordem de inserção quando a capacidade é
atingida. Registros ativos nunca são expulsos para acomodar uma nova observação; se toda a
capacidade estiver ativa, a nova execução prossegue sem histórico, preservando o limite e o
comportamento fail-open. Correlações ativas são removidas quando o POST síncrono alcança um
resultado terminal. O store nunca retém prompts, conteúdo do usuário, knowledge, respostas,
specifications, artifacts ou o `ExecutionResult` completo.

O host mantém um singleton em `globalThis` para compartilhar o mesmo store entre bundles de Route
Handlers carregados no mesmo processo Node.js. Isso não é persistência: restart, HMR e substituição
do processo não oferecem continuidade garantida, e instâncias distintas não compartilham dados. Se
o store ou o collector falhar, a observação pode ficar incompleta, mas a invocação do Engine e o
resultado do workflow permanecem inalterados. Observabilidade é best-effort e não pode criar um
novo modo de falha para a execução funcional.

## Fronteira HTTP

Adicionar somente:

```text
GET /api/executions/[id]/timeline
```

O path aceita:

- um identificador canônico `execution-<32 lowercase hex>` para uma execução retida; ou
- um `workflowId` validado somente enquanto esse workflow estiver ativamente correlacionado ao POST
  síncrono no mesmo processo do host.

A correlação por workflow existe exclusivamente para permitir que o Frontend faça polling enquanto
ainda não conhece o execution ID criado pelo Engine. Ela não é uma chave durável de lookup, não
muda o contrato do Engine e fica indisponível quando o POST se torna terminal. Histórico concluído
é consultado somente pelo `executionId` canônico.

O endpoint valida o path, retorna o envelope HTTP versionado padrão, usa os headers de segurança
existentes e `Cache-Control: no-store`, e expõe somente timeline, métricas de etapas e resumo
minimizado. Identificadores desconhecidos, removidos ou inativos não revelam se outra instância
possui a execução.

A regra de dependência da Sprint 14 é refinada somente para esse endpoint: ele pode depender do
contrato público de leitura da observabilidade fornecido pelo host. Ainda são proibidos imports de
agentes, internals do workflow, componentes inferiores, Prisma ou repositories. O
`POST /api/executions` continua chamando um objeto que implementa o contrato público
`ExecutionEngine`.

## Polling no Frontend

O Frontend preserva o POST síncrono e usa somente React e seu client HTTP interno. Como ele já cria
`workflowId` para compatibilidade com a API `1.0.0`, pode consultar a timeline por essa correlação
ativa enquanto o POST estiver pendente. Quando o POST responde, o client usa o `executionId`
canônico para obter o snapshot final e interrompe o polling.

O polling usa intervalo centralizado e limitado, permite somente uma consulta em andamento,
propaga `AbortSignal`, aplica deadline observacional de cinco segundos por leitura, para no unmount
e nunca retenta o workflow. Timeout ou falha da timeline degrada para ausência de metadados e não
bloqueia o resultado do POST. É observação de transporte, não fila, worker, scheduler, background
job, WebSocket ou retry de execução.

A interface renderiza a ordem fixa sem interpretar HTML. Uma etapa bem-sucedida fica verde, a etapa
ativa recebe distinção visual, falha ou cancelamento fica vermelho e etapas posteriores ignoradas
permanecem neutras. Acessibilidade não depende somente de cor.

## Segurança e logging

O histórico e o endpoint aplicam minimização de dados e allowlists estritas. Eles podem expor apenas
IDs, nomes e status de etapas, timestamps, durações, métricas, códigos sanitizados e hashes já
públicos no resultado do Engine.

Eles nunca registram nem retornam:

- prompts ou fragments de prompt;
- demanda ou contexto adicional do usuário;
- documentos ou contexto composto de knowledge;
- specifications, respostas do modelo ou structured output;
- artifacts ou conteúdo renderizado;
- payloads de validação ou mensagens cruas de issues;
- credenciais, dados de autorização, cookies, stacks ou causas cruas.

A ausência de autenticação e autorização limita o endpoint a ambientes locais ou explicitamente
permitidos e ao uso de dados sintéticos.

## Consequências

- uma execução passa a possuir uma visão consultável, imutável e minimizada;
- o Engine permanece como único caller de produção do Orchestrator;
- contratos existentes dos agentes e componentes inferiores permanecem inalterados;
- durações de validação e geração de artifacts podem ser observadas sem entrar nos outputs dos
  agentes;
- polling apresenta progresso real enquanto o POST síncrono estiver ativo no mesmo processo;
- hashes e decisões do workflow permanecem independentes da observabilidade;
- o histórico é intencionalmente incompleto após restart, HMR, eviction ou entre múltiplas
  instâncias;
- um rate card aprovado é necessário antes de estimar custo;
- um adapter futuro de persistência só poderá substituir o store em memória mediante decisão
  arquitetural futura.

## Fora do escopo

- Prisma, repositories, banco ou persistência durável;
- Redis, RabbitMQ, Kafka, filas, workers, scheduler, cron ou background jobs;
- WebSocket, SSE ou tracing distribuído;
- OpenTelemetry ou plataformas externas de monitoramento;
- autenticação, autorização e rate limit;
- retry, retomada, revisão humana ou execução concorrente dos agentes;
- execução de testes, Playwright ou automação de browser;
- mudanças nos agentes, prompts, output contracts, Business Validation, Response Validator, Prompt
  Builder ou runtime prompt budget;
- chamadas reais à OpenAI;
- qualquer item da Sprint 17.
