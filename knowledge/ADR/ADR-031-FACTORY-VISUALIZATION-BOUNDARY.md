# ADR-031 — Factory Visualization Boundary

## Status

Accepted

## Context

Depois da Sprint 20, a AI Factory já executa o workflow assíncrono Product Owner → Developer → QA,
persiste metadados minimizados, publica Timeline, métricas, hashes, lineage e provenance e protege
as consultas por sessão e ownership. A experiência existente, porém, apresenta esses dados em
listas e painéis técnicos. Ela não oferece uma visão operacional que permita acompanhar a fábrica
em funcionamento sem interpretar diretamente os contratos de Execution History e Observability.

A Sprint 21 precisa introduzir essa visualização sem criar uma segunda fonte de verdade. A
interface não pode simular conversas, raciocínio, atividades ou estados internos dos agentes. Os
contratos atuais também não observam fases live de validação e geração de artifacts, não persistem
filename ou media type de artifacts e não atribuem um timestamp autoritativo a handoffs.

## Decision

Criar a rota autenticada dedicada `/executions/[id]/factory` no host Next.js. A rota representa uma
projeção read-only da execução e permanece separada do detalhe técnico em
`/executions/[id]`. Links entre as duas experiências permitem alternar a forma de inspeção sem
duplicar domínio ou persistência.

`FactoryViewModel` é a única fronteira consumida pelos componentes React de apresentação da
Factory. Um mapper frontend puro, determinístico e sem I/O transforma somente DTOs HTTP públicos
em um modelo imutável e serializável. Componentes visuais não importam Execution Engine,
Repository, Observability, fila, agentes, assets ou qualquer workspace `@brq/*`.

A Factory reutiliza exclusivamente:

- `GET /api/executions/[id]` para identidade, estado, hashes, lineage, provenance e metadata do
  job;
- `GET /api/jobs/[id]` durante a fase enfileirada;
- `GET /api/executions/[id]/timeline` depois do início da execução;
- o resultado de `POST /api/executions` para navegar imediatamente à Factory após a aceitação.

Não será criado endpoint agregado. `GET /api/executions/[id]` recebe somente uma extensão aditiva
com a projeção minimizada do job já persistido: `jobId`, status e timestamps. Isso permite abrir a
Factory por deep link e escolher a fonte correta do polling sem nova query, migration ou regra de
negócio.

## Real-data projection

Os estados visuais são derivados dos estados públicos da Timeline:

| Timeline                              | Factory        |
| ------------------------------------- | -------------- |
| `PENDING`                             | `WAITING`      |
| `RUNNING`                             | `WORKING`      |
| `SUCCESS`                             | `COMPLETED`    |
| `FAILED`                              | `FAILED`       |
| `CANCELLED`                           | `CANCELLED`    |
| `SKIPPED`                             | `SKIPPED`      |
| Snapshot ausente em execução terminal | `NOT_OBSERVED` |

Knowledge é apresentado como estágio de sistema, não como agente. `VALIDATING` e
`GENERATING_ARTIFACTS` não são estados live nesta versão porque não existem eventos públicos que
os comprovem. Durações de validação e geração podem ser mostradas retrospectivamente quando
existirem em Stage Metrics.

O activity feed usa um dicionário fixo sobre metadata de job e eventos tipados de Observability.
Ele nunca converte respostas, specifications ou texto do usuário em mensagens. Ordenação usa
timestamp, prioridade estável da fonte, sequência do evento e ID determinístico.

## Handoffs and artifacts

As conexões principais são Product Owner → Developer e Developer → QA. O handoff suplementar
Product Owner → QA permanece visível no detalhe do QA porque integra o lineage público, mas não
cria uma conexão diagonal que comprometa a leitura do workspace.

Uma conexão pode ser `PENDING`, `OBSERVED`, `VERIFIED` ou `BLOCKED`. Somente uma tupla pública de
lineage com `verified: true` autoriza `VERIFIED`. Como o contrato não possui `handoffAt`, qualquer
horário exibido é rotulado como momento de observação e informa sua base: início do target ou, como
fallback, término do source. A UI não o descreve como instante autoritativo de transferência.

Artifacts são projetados apenas dos hashes reais de provenance. Cards informam agente, índice,
hash e outcome registrado. Filenames, tipos, media types e conteúdo não são inferidos, hardcoded
ou exibidos porque não integram a API pública atual.

## Phase-aware polling

O polling é estritamente de leitura e mantém no máximo uma consulta em andamento:

1. a aceitação do POST fornece `executionId` e `jobId` e navega imediatamente para a Factory;
2. enquanto o job estiver `QUEUED`, somente `GET /api/jobs/[id]` é consultado;
3. durante `RUNNING`, somente `GET /api/executions/[id]/timeline` é consultado;
4. revisões não monotônicas são ignoradas;
5. ao observar `SUCCESS`, `FAILED` ou `CANCELLED`, o detalhe é atualizado uma vez e o polling para;
6. unmount, troca de execução, aba oculta ou erro de transporte abortam ou suspendem novas leituras.

Uma Timeline ainda inexistente durante a transição inicial é estado observacional esperado, não
execução fictícia. Polling não repete POST, não retenta workflow e não altera Job Queue, Worker ou
Execution Engine.

## Authorization and security boundary

A página exige sessão, mas não é exclusiva de ADMIN. A API e o Execution Repository continuam
sendo a autoridade:

- `USER` consulta somente registros próprios;
- `ADMIN` usa a capability global read-only já existente;
- lookup cross-owner para `USER` permanece `404`;
- ausência de sessão recebe redirect no frontend ou `401` na API.

O view model aplica uma allowlist de IDs, status, timestamps, duração, readiness, métricas, hashes,
lineage, provenance e artifact hashes. Prompts, Knowledge content, specifications, respostas de IA,
artifact content, erros internos, credenciais e dados de outro owner permanecem proibidos.

O link para o Playground é genérico, sem transferir conteúdo da execução, e só é descoberto por
ADMIN. A interface não usa `dangerouslySetInnerHTML`, imagens remotas ou browser storage.

## Frontend and accessibility boundary

A experiência usa React, Next.js e CSS Modules já existentes. Não há biblioteca visual ou nova
dependência. Estados possuem texto e ícones além de cor; estações são controles de teclado; o
activity feed usa lista ordenada e timestamps semânticos; atualizações live são anunciadas de modo
limitado. Animações são sutis e exclusivamente explicativas, e são removidas por
`prefers-reduced-motion`.

O layout mantém a ordem semântica Product Owner → Developer → QA. No desktop, as estações formam
uma linha de produção conectada; no mobile, tornam-se uma fábrica vertical sem alterar a ordem do
DOM. O painel de detalhes é não modal para preservar navegação e foco previsíveis.

## Consequences

### Positive

- a visualização operacional deriva de fontes públicas e autoritativas já existentes;
- a apresentação não conhece o domínio nem ganha capacidade de executar agentes;
- deep links acompanham jobs desde a fila até o resultado terminal;
- o modelo visual é determinístico, testável e independente do layout;
- a experiência expõe progresso sem fabricar percentuais ou atividade interna.

### Trade-offs

- não existe granularidade live entre início e término de cada agente;
- cards de artifacts permanecem hash-only;
- handoffs possuem instante observado, não timestamp de domínio;
- a Factory realiza polling local e não oferece entrega push;
- reinício do host conserva metadata persistida, mas jobs locais ativos continuam sujeitos às
  limitações já documentadas da fila em memória.

## Explicit exclusions

Esta decisão não autoriza conversa entre agentes, Chain-of-Thought, texto gerado para atividade,
novos eventos de domínio, novo endpoint agregado, workspace, dependency, WebSocket, SSE, broker,
retry, alteração de agentes, prompts, schemas, output contracts, Business Validation, runtime de
IA, persistência de conteúdo funcional, chamada OpenAI ou qualquer item da Sprint 22.
