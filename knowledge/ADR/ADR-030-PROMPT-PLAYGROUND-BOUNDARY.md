# ADR-030 — Prompt Playground Boundary

## Status

Accepted

## Context

Depois da Sprint 19, a plataforma já constrói prompts determinísticos para Product Owner,
Developer e QA, porém essas informações só são observáveis durante uma execução completa. A
Sprint 20 precisa disponibilizar uma ferramenta de engenharia para inspecionar Knowledge, regras,
template, canais de confiança, orçamento, hashes e contrato de saída, além de validar uma resposta
manual, sem executar agentes nem acessar um provider de IA.

O conteúdo inspecionado inclui prompt renderizado, specifications e JSON Schema. Mesmo com acesso
administrativo, esse conteúdo não pode atravessar Repository, Observability, Execution History ou
logs. Reutilizar o composition root de execução também permitiria alcançar AI Provider, Agent
Runner, Orchestrator, Queue e Worker, ampliando indevidamente a capacidade do Playground.

## Decision

Criar o workspace `core/prompt-inspector` como serviço transport-neutral, stateless e imutável. O
serviço recebe uma coleção fixa de adapters de inspeção no momento da composição e usa somente
contratos públicos de Knowledge Loader, Prompt Builder e Response Validator. O workspace não
conhece agentes concretos, HTTP, autenticação, filesystem concreto, provider, execução,
persistência ou observabilidade.

O host Next.js mantém um composition root exclusivo em
`apps/web/src/server/playground/prompt-inspection-runtime.ts`. Esse runtime:

- instancia Knowledge Loader e Prompt Builder com a mesma configuração aprovada do host de
  execução, sem alterar seus defaults ou limites;
- injeta adapters estáticos para Product Owner, Developer e QA usando somente APIs públicas;
- não importa nem resolve o runtime de execução;
- não possui referências a AI Provider, Agent Runner, Orchestrator, Execution Engine, Job Queue,
  Execution Worker, Repository ou Observability.

As projeções puras de contexto já usadas pelos agentes passam a integrar seus entrypoints públicos
para que execução e inspeção utilizem a mesma transformação. Isso é uma integração mínima e não
altera o comportamento funcional, os assets, schemas, output contracts ou Business Validations.

## Public inspection contract

O Inspector oferece três operações:

- catálogo dos agentes suportados e exemplos sintéticos;
- preview determinístico do prompt e de seus metadados;
- validação de conteúdo candidato por Response Validator, schema público do agente e Business
  Validation pública.

O pipeline visual usa os estágios `KNOWLEDGE`, `RULES`, `TEMPLATE`, `RESOLUTION`, `RENDERING`,
`BUDGET` e `CONTRACT`, com estados `IDLE`, `VALID`, `WARNING` ou `ERROR`. Hashes e bytes vêm dos
componentes que os produzem; o browser nunca os recalcula.

A validação manual recebe texto para também representar JSON inválido. Ela reconstrói o preview
deterministicamente e cria somente um envelope diagnóstico em memória. O hash desse texto é
explicitamente `candidateHash`; ele não é apresentado como `responseHash` de uma execução real.
Falhas funcionais são resultado HTTP bem-sucedido com estágios `PASS`, `FAIL` ou `NOT_RUN`.

## HTTP and authorization boundary

O adapter HTTP adiciona somente:

- `GET /api/playground/agents`;
- `POST /api/playground/preview`;
- `POST /api/playground/validate`.

Todas as rotas exigem um principal `ADMIN`. Ausência de sessão retorna `401`; um principal `USER`
recebe `403 AUTHORIZATION_DENIED`. A página `/playground` redireciona ausência de sessão para
`/login` e usa a política de not found para `USER`. Ocultar o link no header serve apenas para
descoberta e não substitui a autorização server-side.

Os POSTs exigem origem same-origin, JSON UTF-8, schema Zod estrito e limites próprios. O request
`AbortSignal` é propagado. As respostas preservam o envelope, headers de segurança, `no-store` e
`requestId` já definidos pelo adapter HTTP.

## Ephemeral and security boundary

Toda inspeção tem retenção `EPHEMERAL`:

- nenhum resultado recebe identidade persistente ou `previewId`;
- validação reenvia input e candidato e reconstrói o estado em memória;
- não há cache, local storage, session storage, Repository ou evento observacional;
- prompts, specifications, Knowledge content, candidatos e schemas completos nunca são logados;
- o Knowledge Inspector expõe somente ID, categoria, required/optional, bytes e hash, nunca
  locator, path ou conteúdo documental;
- prompt e schema completos são retornados somente ao ADMIN, em resposta `no-store`, e
  renderizados como texto React.

O conteúdo continua não confiável. A separação `TRUSTED`/`UNTRUSTED` deriva das sections do Prompt
Builder; a interface não mantém uma cópia independente dessas regras.

## Frontend boundary

Componentes React consomem exclusivamente DTOs do client HTTP interno. Eles não importam
workspaces `@brq/*`, código server-side, filesystem ou assets. Um único componente coordena estado
client-side; os demais recebem view models pequenos.

Tabs, pipeline, status e medidor de budget possuem semântica de teclado e nomes acessíveis. Cor não
é a única indicação de estado. Prompt e JSON Schema usam nós de texto React, sem
`dangerouslySetInnerHTML` e sem biblioteca visual nova.

## Consequences

### Positive

- inspeção fiel reutiliza os componentes e hashes reais;
- capability do Playground não alcança execução nem OpenAI;
- nenhum dado técnico sensível é persistido ou enviado à observabilidade;
- adapters fixos preservam fronteiras públicas dos agentes;
- UI fornece uma ferramenta administrativa de engenharia sem criar um editor de prompts.

### Trade-offs

- o preview contém material sensível e exige controles administrativos e `no-store`;
- a validação reconstrói o prompt a cada request por opção stateless;
- conteúdo integral de documentos Knowledge não é exibido nesta Sprint;
- não existe comparação, histórico ou colaboração entre previews.

## Explicit exclusions

Esta decisão não autoriza chamadas OpenAI, execução de agentes, edição ou versionamento de prompts,
salvamento de fixtures, A/B testing, evaluations, prompt registry, provider selector, streaming,
WebSocket, Monaco Editor, persistência ou qualquer item da Sprint 21.
