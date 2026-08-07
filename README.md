# BRQ AI Factory

Estrutura canônica do projeto:

```text
brq-ai-factory/
│
├── .ai/
│   ├── CODEX_INSTRUCTIONS.md
│   ├── DEVELOPMENT_WORKFLOW.md
│   ├── IMPLEMENTATION_STRATEGY.md
│   ├── PROJECT_MEMORY.md
│   ├── NEXT_STEPS.md
│   └── OPEN_QUESTIONS.md
│
├── apps/
│   └── web/
│
├── knowledge/
│   ├── ADR/
│   │   ├── ADR-001-Orchestrator.md
│   │   ├── ADR-002-Agent-Isolation.md
│   │   ├── ADR-003-JSON-Contract.md
│   │   ├── ADR-004-AI-First.md
│   │   ├── ADR-005-Knowledge-Layer.md
│   │   ├── ADR-006-SQLite-MVP.md
│   │   ├── ADR-007-Prisma.md
│   │   ├── ADR-008-NextJS.md
│   │   ├── ADR-009-Prompt-Versioning.md
│   │   ├── ADR-010-Human-Review.md
│   │   ├── ADR-011-Repository-Layout.md
│   │   ├── ADR-012-PERSISTENCE_BOUNDARY.md
│   │   ├── ADR-013-AI-PROVIDER-BOUNDARY.md
│   │   ├── ADR-014-KNOWLEDGE-LOADER-BOUNDARY.md
│   │   ├── ADR-015-PROMPT-BUILDER-BOUNDARY.md
│   │   ├── ADR-016-AGENT-RUNNER-BOUNDARY.md
│   │   ├── ADR-017-RESPONSE-VALIDATOR-BOUNDARY.md
│   │   ├── ADR-018-ARTIFACT-GENERATOR-BOUNDARY.md
│   │   ├── ADR-019-PRODUCT-OWNER-AGENT-BOUNDARY.md
│   │   ├── ADR-020-DEVELOPER-AGENT-BOUNDARY.md
│   │   ├── ADR-021-QA-AGENT-BOUNDARY.md
│   │   ├── ADR-022-ORCHESTRATOR-BOUNDARY.md
│   │   ├── ADR-023-EXECUTION-ENGINE-BOUNDARY.md
│   │   ├── ADR-024-HTTP-API-ADAPTER-BOUNDARY.md
│   │   ├── ADR-025-FRONTEND-MVP.md
│   │   ├── ADR-026-OBSERVABILITY-BOUNDARY.md
│   │   └── ADR-027-EXECUTION-REPOSITORY-BOUNDARY.md
│   │
│   ├── 00-VISION.md
│   ├── 01-PROJECT_CONTEXT.md
│   ├── 02-ARCHITECTURE.md
│   ├── 03-WORKFLOW.md
│   ├── 04-TECH_STACK.md
│   ├── 05-DOMAIN_MODEL.md
│   ├── 06-DATABASE.md
│   ├── 07-API.md
│   ├── 08-ORCHESTRATOR.md
│   ├── 09-ARTIFACTS.md
│   ├── 10-AGENTS.md
│   ├── 11-PO_AGENT.md
│   ├── 12-DEVELOPER_AGENT.md
│   ├── 13-QA_AGENT.md
│   ├── 14-PROMPTS.md
│   ├── 15-CODING_STANDARDS.md
│   ├── 16-TESTING.md
│   ├── 17-OBSERVABILITY.md
│   ├── 18-SECURITY.md
│   ├── 19-CONTRIBUTING.md
│   ├── 20-ROADMAP.md
│   ├── 21-DECISIONS.md
│   ├── 22-GLOSSARY.md
│   ├── 23-FAQ.md
│   ├── 24-SYSTEM_DESIGN.md
│   ├── 25-SEQUENCE_DIAGRAMS.md
│   ├── 26-REPOSITORY_STRUCTURE.md
│   ├── 27-PROMPT_BUILDER_FLOW.md
│   ├── 28-AGENT_RUNNER_FLOW.md
│   ├── 29-RESPONSE_VALIDATOR_FLOW.md
│   ├── 30-ARTIFACT_GENERATOR_FLOW.md
│   ├── 31-ARTIFACT_LIFECYCLE.md
│   ├── 32-PRODUCT_OWNER_AGENT_FLOW.md
│   ├── 33-PIPELINE_OVERVIEW.md
│   ├── 34-DEVELOPER_AGENT_FLOW.md
│   ├── 35-QA_AGENT_FLOW.md
│   ├── 36-ORCHESTRATOR_FLOW.md
│   ├── 37-EXECUTION_ENGINE_FLOW.md
│   ├── 38-HTTP_API_FLOW.md
│   ├── 39-FRONTEND_FLOW.md
│   ├── 40-OBSERVABILITY_FLOW.md
│   └── 41-EXECUTION_REPOSITORY_FLOW.md
│
├── core/
│   ├── orchestrator/
│   ├── execution-engine/
│   ├── observability/
│   └── execution-repository/
├── agents/
│   ├── product-owner/
│   ├── developer/
│   └── qa/
├── prompts/
│   ├── product-owner/
│   │   ├── 1.0.0/
│   │   └── 1.0.1/ (ativo)
│   ├── developer/
│   │   ├── 1.0.0/
│   │   ├── 1.0.1/
│   │   └── 1.0.2/ (ativo)
│   └── qa/1.0.0/
├── shared/
├── prisma/
├── package.json
│
└── README.md
```

## Ambiente local

Pré-requisitos:

- Node.js 24 LTS;
- npm;
- Git.

```bash
nvm use
npm ci
cp .env.example .env
npm run prisma:migrate:deploy
npm run prisma:validate
npm run dev
```

`BRQ_KNOWLEDGE_ROOT` é opcional e, quando informado, deve ser um caminho absoluto. O host web
resolve `knowledge/` a partir do workspace por padrão.

O MVP utiliza SQLite local. Os comandos de migration inicializam o arquivo configurado em `DATABASE_URL` quando necessário. Nenhuma configuração de deploy faz parte do MVP atual.

## Persistência

O workspace `@brq/prisma` implementa os repositories definidos em `@brq/shared`. Para criar uma migration durante o desenvolvimento:

```bash
npm run prisma:migrate:dev -- --name nome_da_migration
```

Não existe seed obrigatório. Os repositories históricos de domínio permanecem disponíveis sem
alteração. A Sprint 17 adiciona o agregado normalizado `ExecutionRecord`, dedicado ao histórico
minimizado de execuções, sem persistir prompts, specifications, respostas, knowledge ou conteúdo
de artifacts.

## AI Provider

O workspace `@brq/ai-provider` contém a interface abstrata, o adapter OpenAI e o FakeAIProvider. A configuração real utiliza `OPENAI_API_KEY` somente no servidor, com timeout padrão de 60 segundos. A suíte padrão não chama serviços externos.

O teste real opcional exige ativação e modelo explícitos:

```bash
RUN_OPENAI_LIVE_TESTS=true OPENAI_LIVE_TEST_MODEL=nome-do-modelo npm run test:ai:live
```

## Knowledge Loader

O workspace `@brq/knowledge-loader` carrega documentos Markdown autorizados por um manifesto JSON validado por Zod. IDs são explícitos e independentes de filenames; seleção, ordem, hashes e orçamento de contexto são determinísticos e configuráveis por instância.

O contexto preserva o conteúdo original e identifica cada documento por ID, categoria e hash. O módulo não monta prompts, resume conteúdo nem utiliza IA, embeddings, RAG ou busca semântica.

## Prompt Builder

O workspace `@brq/prompt-builder` transforma estruturas prontas em um `PromptResult` determinístico. A hierarquia conceitual `PromptDocument → PromptSection → PromptBlock → PromptFragment` é representada por `PromptTemplate` antes da resolução e por `ResolvedPromptDocument` depois dela. O renderer produz separadamente os canais `instructions` e `input`.

Templates usam slots tipados resolvidos em uma única passagem. O orçamento padrão centralizado é de 128 KiB, pode ser configurado por instância e apenas reduzido pela chamada; um preflight de limite inferior rejeita excesso evidente antes do clone por schema e da renderização, e a carga final é medida exatamente. Referências de proveniência não consomem esse orçamento de payload, mas possuem limite estrutural próprio, configurável por instância e aplicado antes do clone. Hashes canônicos identificam template, canais, output contract e resultado final. O documento resolvido preserva proveniência de rule sets e contextos sem incorporá-la ao `promptHash` do payload efetivo. A transformação não realiza I/O de domínio ou acesso a recursos externos; o logger estruturado injetável é sua única saída lateral. O módulo não conhece providers, agentes, Orchestrator, Knowledge Source ou persistência. Product Owner, Developer e QA possuem bundles estáticos próprios; loader genérico de prompts, registry, descoberta e seleção dinâmica de versões permanecem adiados.

[Fluxo visual do Prompt Builder](knowledge/27-PROMPT_BUILDER_FLOW.md)

## Agent Runner

O workspace `@brq/agent-runner` executa exatamente uma chamada abstrata de IA por invocação. Ele recebe um `PromptRequest` próprio, usa o `PromptBuilder` injetado, transforma o `PromptResult` validado em uma solicitação provider-neutral e chama somente a interface `AIProvider`.

O Runner não conhece OpenAI ou adapters concretos, não persiste dados, não valida regras funcionais da resposta e não executa retries. O `agentExecutionId` é a correlação obrigatória; cancelamento é encaminhado por `AbortSignal` e o timeout é aplicado exclusivamente pelo provider. A resposta bruta permanece em um `ResponseEnvelope` interno, enquanto o resultado público separa metadados, métricas observadas pelo Runner e valores reportados pelo provider.

[Fluxo visual do Agent Runner](knowledge/28-AGENT_RUNNER_FLOW.md)

## Response Validator

O workspace `@brq/response-validator` recebe um `AgentRunResult` não confiável e um `ValidationContract` declarativo e versionado. Sua pipeline classifica finish reasons, valida presença e formato do conteúdo, reinterpreta JSON, aplica JSON Schema e verifica a coerência de `structuredData` sem modificar a resposta original.

Falhas funcionais produzem um `ValidationResult` imutável com issues e hashes rastreáveis. O módulo não chama IA, não corrige respostas, não executa retry, não persiste dados e não contém regras específicas de Product Owner, Developer ou QA.

[Fluxo visual do Response Validator](knowledge/29-RESPONSE_VALIDATOR_FLOW.md)

## Artifact Generator

O workspace `@brq/artifact-generator` transforma exclusivamente um `ValidationResult` aceito e uma `ArtifactSpecification` declarativa em `ArtifactDrafts` determinísticos. A pipeline resolve bindings contra o valor validado, cria um `ResolvedArtifactModel` interno, renderiza o conteúdo sem reinterpretá-lo e devolve um `ArtifactGenerationResult` imutável.

O módulo distingue hashes estruturais — specification, template, draft e geração — do hash do conteúdo renderizado. Ele não conhece agentes concretos, não chama IA, não grava arquivos, não persiste nem versiona artifacts e não coordena o fluxo. Enriquecimento, versionamento e persistência permanecem responsabilidades posteriores.

[Fluxo visual do Artifact Generator](knowledge/30-ARTIFACT_GENERATOR_FLOW.md) · [Ciclo de vida dos Artifacts](knowledge/31-ARTIFACT_LIFECYCLE.md)

## Product Owner Agent

O workspace `agents/product-owner` implementa a primeira fachada concreta de agente. Sua factory valida dependências e assets uma vez; cada invocação posterior carrega o contexto `PRODUCT_OWNER`, projeta-o como entrada estruturada do Agent Runner e encadeia exatamente uma tentativa por `Knowledge Loader → Agent Runner → Response Validator → Business Validation → Artifact Generator`.

O contrato funcional produz uma `ProductOwnerSpecification` com readiness `READY`, `PARTIALLY_READY` ou `REQUIRES_CLARIFICATION`. A Business Validation recalcula essa decisão, verifica completude, IDs e referências cruzadas sem alterar a resposta e sinaliza truncamento quando excede o limite de issues. Somente uma saída aceita gera exatamente os drafts canônicos `story.md`, `acceptance.md` e `backlog.json`. O JSON Schema inicial evita `$schema` e `uniqueItems` para a compatibilidade alvo com Structured Outputs de modelos-base; modelos fine-tuned exigem verificação explícita. Persistência, retry e avanço de workflow continuam fora do agente.

O release `prompts/product-owner/1.0.0` permanece preservado. O bundle ativo `1.0.1` explicita nas
instruções que `backlogItems[].dependencyIds` deve referenciar somente IDs existentes em
`dependencies[].id`, sem alterar o JSON Schema ou a Business Validation que já aplica essa
invariante.

[Fluxo visual do Product Owner Agent](knowledge/32-PRODUCT_OWNER_AGENT_FLOW.md) · [Visão geral do pipeline](knowledge/33-PIPELINE_OVERVIEW.md) · [ADR-019](knowledge/ADR/ADR-019-PRODUCT-OWNER-AGENT-BOUNDARY.md)

## Developer Agent

O workspace `agents/developer` implementa a segunda fachada concreta, com uma única tentativa por `Knowledge Loader → Agent Runner → Response Validator → Developer Business Validation → Artifact Generator`. O request recebe uma `ProductOwnerSpecification` válida pelo contrato público do Product Owner; não executa nem chama o agente anterior.

A saída é uma `TechnicalSpecification` declarativa com arquitetura, complexidade, story points, fases, plano, dependências, decisões e rastreabilidade integral dos Acceptance Criteria. Readiness considera tanto a specification funcional de origem quanto perguntas e premissas técnicas. Somente uma saída aceita gera, nessa ordem, `architecture.md`, `implementation-plan.md` e `technical-decisions.json`, preservando o hash e a readiness da origem nos metadados.

O Developer atua como arquiteto: não gera código ou testes, não executa comandos, não persiste drafts, não altera estados, não retenta e não coordena Product Owner, QA ou Orchestrator. O contexto `DEVELOPER` mantém seis documentos obrigatórios dentro do orçamento padrão de 64 KiB; documentos adicionais continuam opcionais e determinísticos.

Os releases `prompts/developer/1.0.0` e `1.0.1` permanecem preservados. O bundle ativo `1.0.2` alinha o JSON Schema versionado ao schema Zod público: paths de módulos inseguros e valores `order` acima de `Number.MAX_SAFE_INTEGER` são rejeitados já no Response Validator. Normalização Unicode NFC e a diferença entre `maxLength` por code points e comprimento UTF-16 permanecem explicitadas no prompt e autoritativamente verificadas pelo Zod.

[Fluxo visual do Developer Agent](knowledge/34-DEVELOPER_AGENT_FLOW.md) · [Visão geral do pipeline](knowledge/33-PIPELINE_OVERVIEW.md) · [ADR-020](knowledge/ADR/ADR-020-DEVELOPER-AGENT-BOUNDARY.md)

## QA Agent

O workspace `agents/qa` implementa a terceira fachada concreta. O request recebe `ProductOwnerSpecification` e `TechnicalSpecification` pelos contratos públicos e valida a compatibilidade do par antes de carregar knowledge ou consumir IA. A fachada não executa nem chama os agentes anteriores.

Cada tentativa projeta exatamente três contextos `INPUT/UNTRUSTED` e segue `Knowledge Loader → Agent Runner → Response Validator → QA Business Validation → Artifact Generator`. A Business Validation exige cobertura verificável de todos os IDs `AC`, `BR`, `DEC` e `DOD`, recalcula totais e readiness e rejeita referências inválidas sem corrigir a saída.

Uma saída aceita gera, nessa ordem, `test-plan.md`, `traceability-matrix.json` e `qa-specification.md`. O QA Agent não recebe código, não executa testes, não gera Playwright, não persiste drafts, não retenta e não afirma aprovação operacional.

[Fluxo visual do QA Agent](knowledge/35-QA_AGENT_FLOW.md) · [Visão geral do pipeline](knowledge/33-PIPELINE_OVERVIEW.md) · [ADR-021](knowledge/ADR/ADR-021-QA-AGENT-BOUNDARY.md)

## Orchestrator

O workspace `@brq/orchestrator`, localizado em `core/orchestrator` conforme o ADR-011, coordena o
único workflow da Sprint 12: Human Request → Product Owner → Developer → QA → `WorkflowResult`.
As três fachadas são injetadas e chamadas uma vez, em ordem fixa, somente por seus entrypoints
públicos.

`WorkflowResult` consolida resultados, timeline, lineage, provenance, métricas e hashes. Timeline
e durações são observacionais e não participam dos hashes determinísticos. Rejeições funcionais
retornam `FAILED`; falhas técnicas e cancelamentos propagam `OrchestratorError` com resultado
parcial imutável.

O módulo não chama OpenAI, não monta prompts, não valida respostas do modelo, não gera artifacts,
não persiste, não executa retry e não conhece Execution Engine, API ou frontend.

[Fluxo visual do Orchestrator](knowledge/36-ORCHESTRATOR_FLOW.md) · [ADR-022](knowledge/ADR/ADR-022-ORCHESTRATOR-BOUNDARY.md)

## Execution Engine

O workspace `@brq/execution-engine`, em `core/execution-engine`, é a única fronteira de produção
autorizada a iniciar o Orchestrator. Ele recebe `ExecutionRequest` sem ID, cria um `executionId`
determinístico e versionado, controla o ciclo local `CREATED → RUNNING → SUCCESS | FAILED |
CANCELLED` e consolida o `WorkflowResult` público em um `ExecutionResult` imutável.

Cada execução possui `attempt: 1` e no máximo uma chamada ao Orchestrator. `startedAt`,
`finishedAt`, timeline, durações e métricas são observacionais e ficam fora dos hashes. Lineage e
provenance permanecem separados; `engineVersion` e `contractVersion` identificam explicitamente
a versão da fronteira.

O Engine não conhece agentes ou componentes inferiores, não persiste, não retenta, não mantém
registro global e propaga cancelamento somente pelo mesmo `AbortSignal`.

[Fluxo visual do Execution Engine](knowledge/37-EXECUTION_ENGINE_FLOW.md) · [ADR-023](knowledge/ADR/ADR-023-EXECUTION-ENGINE-BOUNDARY.md)

## HTTP API

A Sprint 14 expõe o Execution Engine exclusivamente por Next.js 16 Route Handlers. A criação
continua síncrona por `POST /api/executions`; `GET /api/health` não consulta banco, IA ou workflow.
A Sprint 17 torna operacionais `GET /api/executions`, com paginação e filtros, e
`GET /api/executions/[id]`, além de trocar a fonte de
`GET /api/executions/[id]/timeline` pelo repository durável.

O adapter valida media type, encoding, limite de 512 KiB, JSON e schema Zod; gera `requestId`,
propaga o mesmo `AbortSignal` e transporta `ExecutionResult` sem alterar hashes, métricas, lineage
ou provenance. Logs e erros usam allowlists sanitizadas e todas as respostas recebem headers
mínimos de segurança.

O composition root fica no host em `apps/web/src/server/runtime.ts`. Ele monta factories públicas
de forma lazy e fornece `ExecutionEngine` e `ExecutionRecordRepository`; nenhum workspace de
runtime foi criado no domínio. A API não conhece agentes, Prisma ou componentes internos do
workflow.

[Fluxo visual da HTTP API](knowledge/38-HTTP_API_FLOW.md) · [ADR-024](knowledge/ADR/ADR-024-HTTP-API-ADAPTER-BOUNDARY.md)

## Frontend MVP

A Sprint 15 adiciona uma única página para iniciar o workflow por `POST /api/executions`. O
formulário recebe Project Name e Objective e apresenta somente executionId, status, duração,
readiness, hashes e resumos de lineage e provenance.

Um client HTTP interno é o único ponto que chama `fetch`. O `ExecutionResult` bruto fica restrito a
ele e é reduzido para `ExecutionSummary`, único contrato aceito pela árvore React. O Frontend não
importa Engine, Orchestrator, agentes, runtime ou internals da API e não renderiza prompts,
specifications, artifacts, knowledge, respostas da IA ou logs.

A API `1.0.0` ainda exige IDs e configurações técnicas dos agentes no request. O client fornece um
perfil técnico versionado e gera IDs por submissão como limitação temporária; essa responsabilidade
deverá migrar para configuração confiável no backend em uma futura evolução versionada do contrato.

[Fluxo visual do Frontend MVP](knowledge/39-FRONTEND_FLOW.md) · [ADR-025](knowledge/ADR/ADR-025-FRONTEND-MVP.md)

## Execution History & Observability

A Sprint 16 implementa o workspace `@brq/observability` em `core/observability`. Ele decora somente
a API pública do Execution Engine, normaliza logs técnicos sanitizados em eventos tipados e
imutáveis e mantém snapshots minimizados em um store bounded, local ao processo e sem
persistência.

A timeline acompanha Knowledge, Product Owner, Developer e QA, além dos eventos de delimitação de
execution e workflow. Métricas por agente preservam duração, bytes, tokens, latência do provider,
validação e geração de artifacts. O `Execution Summary` consolida status, readiness, duração,
tokens, etapas executadas ou ignoradas e os hashes finais sem recalculá-los. Como não existe rate
card aprovado e versionado, `totalCostEstimate` permanece `null`.

O Frontend consulta `GET /api/executions/[id]/timeline` com React puro. Durante o POST síncrono, o
`workflowId` funciona como correlação da execução ainda ativa; após o término, o `executionId`
canônico consulta o histórico persistido. Polling não retenta o workflow, aplica deadline
degradável de cinco segundos por leitura e para em resultado terminal ou unmount.

O reducer em memória da Sprint 16 continua sendo a projeção síncrona e fail-open dos eventos. A
Sprint 17 projeta esses snapshots no repository durável; falhas observacionais intermediárias
continuam best-effort, enquanto a gravação terminal faz parte da fronteira persistente do host.

[Fluxo visual da Observabilidade](knowledge/40-OBSERVABILITY_FLOW.md) · [ADR-026](knowledge/ADR/ADR-026-OBSERVABILITY-BOUNDARY.md)

## Execution Repository & Persistence

A Sprint 17 implementa `@brq/execution-repository` em `core/execution-repository`. O workspace
possui o port `ExecutionRecordRepository`, schemas Zod, projeções imutáveis, adapter em memória e
adapter Prisma. O agregado `ExecutionRecord` é separado do model `Execution` histórico e usa
tabelas normalizadas para lifecycle, hashes, observação, timeline, métricas, lineage e provenance.

Um coordinator externo, composto pelo host depois do decorator observacional, registra `CREATED`,
`RUNNING` e o estado terminal sem alterar o Execution Engine concreto. Como a API pública do Engine
só revela a identidade determinística durante a execução, registros ativos começam correlacionados
por `workflowId` e recebem `executionId` assim que ele se torna público. O algoritmo de hashing não
é duplicado.

O Frontend adiciona `/executions` e `/executions/[id]`, consumindo apenas read models HTTP
minimizados. A listagem aceita `status`, `readiness`, `createdAfter`, `createdBefore`, `limit` e
`cursor`. Nenhum componente React importa o repository, Prisma ou o núcleo da AI Factory.

[Fluxo visual do Execution Repository](knowledge/41-EXECUTION_REPOSITORY_FLOW.md) ·
[ADR-027](knowledge/ADR/ADR-027-EXECUTION-REPOSITORY-BOUNDARY.md)

## Validações

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run prisma:validate
npm run build
git diff --check
```
