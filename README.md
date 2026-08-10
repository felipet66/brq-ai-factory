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
│   │   ├── ADR-027-EXECUTION-REPOSITORY-BOUNDARY.md
│   │   ├── ADR-028-JOB-QUEUE-BOUNDARY.md
│   │   ├── ADR-029-AUTHENTICATION-AUTHORIZATION-BOUNDARY.md
│   │   ├── ADR-030-PROMPT-PLAYGROUND-BOUNDARY.md
│   │   ├── ADR-031-FACTORY-VISUALIZATION-BOUNDARY.md
│   │   ├── ADR-032-CODE-GENERATION-BOUNDARY.md
│   │   ├── ADR-033-SANDBOX-BUILD-TEST-RUNNER-BOUNDARY.md
│   │   └── ADR-034-FACTORY-PIPELINE-INTEGRATION-BOUNDARY.md
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
│   ├── 41-EXECUTION_REPOSITORY_FLOW.md
│   ├── 42-JOB_QUEUE_FLOW.md
│   ├── 43-AUTHENTICATION_FLOW.md
│   ├── 44-PROMPT_PLAYGROUND_FLOW.md
│   ├── 45-FACTORY_VISUALIZATION_FLOW.md
│   ├── 46-CODE_GENERATION_FLOW.md
│   ├── 47-CONTROLLED_WORKSPACE_FLOW.md
│   ├── 48-SANDBOX_RUNNER_FLOW.md
│   ├── 49-SANDBOX_SECURITY_MODEL.md
│   └── 50-FACTORY_PIPELINE_FLOW.md
│
├── core/
│   ├── orchestrator/
│   ├── execution-engine/
│   ├── observability/
│   ├── execution-repository/
│   ├── job-queue/
│   ├── execution-worker/
│   ├── prompt-inspector/
│   ├── controlled-workspace/
│   ├── factory-pipeline/
│   └── sandbox-runner/
├── agents/
│   ├── product-owner/
│   ├── developer/
│   ├── qa/
│   └── code-generator/
├── prompts/
│   ├── product-owner/
│   │   ├── 1.0.0/
│   │   └── 1.0.1/ (ativo)
│   ├── developer/
│   │   ├── 1.0.0/
│   │   ├── 1.0.1/
│   │   └── 1.0.2/ (ativo)
│   ├── qa/1.0.0/
│   └── code-generator/1.0.0/
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
npm run auth:seed
npm run dev
```

`BRQ_KNOWLEDGE_ROOT` é opcional e, quando informado, deve ser um caminho absoluto. O host web
resolve `knowledge/` a partir do workspace por padrão.

O MVP utiliza SQLite local. Os comandos de migration inicializam o arquivo configurado em
`DATABASE_URL` quando necessário. Nenhuma configuração de deploy faz parte do MVP atual.

O host autenticado exige `BETTER_AUTH_SECRET` com ao menos 32 caracteres e uma origem HTTP(S)
exata em `BRQ_APP_ORIGIN`. O seed local é explícito e exige `BRQ_SEED_ADMIN_PASSWORD` e
`BRQ_SEED_USER_PASSWORD`; nenhuma senha padrão integra o repositório. Ele provisiona as contas de
desenvolvimento `admin@example.local` e `user@example.local`. Não execute o seed com credenciais
reais ou reutilizadas. O comando carrega o arquivo `.env` da raiz do repositório quando ele existe,
preservando variáveis já definidas no processo.

Execuções completas da Factory exigem o adapter Docker explicitamente configurado. O host não
substitui uma configuração ausente ou inválida por `FakeSandboxRunner`. A imagem operacional da
Factory é separada da fixture de integração da Sprint 23 e deve ser construída e carregada pelo
operador:

```bash
SOURCE_DATE_EPOCH=0 BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker buildx build \
  --platform linux/arm64 \
  --tag brq-ai-factory/factory-sandbox:sprint24-local \
  --load --network=none --provenance=false --sbom=false \
  apps/web/docker/factory-sandbox
```

Depois do build, configure `BRQ_FACTORY_WORKSPACE_ROOT`,
`BRQ_FACTORY_SANDBOX_DOCKER_EXECUTABLE`, `BRQ_FACTORY_SANDBOX_DOCKER_HOST`, a referência por
repository digest, o image ID imutável e a plataforma. Os nomes completos estão em `.env.example`.
O root do Controlled Workspace e o root lido pelo Sandbox devem ser exatamente o mesmo caminho
absoluto. Nenhuma dessas variáveis autoriza bind mount, rede, shell ou execução no host.

Com a imagem já carregada e todas as variáveis `BRQ_FACTORY_*` exportadas, a integração real do
profile pode ser executada explicitamente. Ela permanece fora de `test` e `test:coverage`, não faz
pull/build automático e falha fechada quando o opt-in ou a configuração não estão presentes:

```bash
BRQ_FACTORY_SANDBOX_INTEGRATION=1 npm run test:factory:integration
```

## Persistência

O workspace `@brq/prisma` implementa os repositories definidos em `@brq/shared`. Para criar uma migration durante o desenvolvimento:

```bash
npm run prisma:migrate:dev -- --name nome_da_migration
```

Os repositories históricos de domínio permanecem disponíveis sem alteração. A Sprint 17 adiciona
o agregado normalizado `ExecutionRecord`, dedicado ao histórico minimizado de execuções, sem
persistir prompts, specifications, respostas, knowledge ou conteúdo de artifacts. A Sprint 18
adiciona a relação normalizada `ExecutionJob`, que persiste somente `jobId`, status e timestamps da
fila; o `ExecutionRequest` permanece exclusivamente em memória enquanto o job estiver ativo.

A Sprint 19 adiciona `User`, `Session`, `Account` e `Verification` para o adapter de autenticação e
torna `ExecutionRecord.userId` obrigatório. `ExecutionJob` herda o owner pela relação com o
registro, sem duplicar `userId`. O seed de autenticação é opcional para o bootstrap do ambiente
local e nunca possui senha versionada.

## AI Provider

O workspace `@brq/ai-provider` contém a interface abstrata, o adapter OpenAI e o FakeAIProvider. A configuração real utiliza `OPENAI_API_KEY` somente no servidor, com timeout padrão de 60 segundos. A suíte padrão não chama serviços externos.

O teste real opcional exige ativação e modelo explícitos:

```bash
RUN_OPENAI_LIVE_TESTS=true OPENAI_LIVE_TEST_MODEL=nome-do-modelo npm run test:ai:live
```

## Knowledge Loader

O workspace `@brq/knowledge-loader` carrega documentos Markdown autorizados por um manifesto JSON validado por Zod. IDs são explícitos e independentes de filenames; seleção, ordem, hashes e orçamento de contexto são determinísticos e configuráveis por instância.

O contexto preserva o conteúdo original e identifica cada documento por ID, categoria e hash. O módulo não monta prompts, resume conteúdo nem utiliza IA, embeddings, RAG ou busca semântica.

A Selection Policy `1.13.0` adiciona o contexto isolado `CODE_GENERATOR`, limitado a tech stack,
coding standards, testing e segurança. O Knowledge Manifest permanece em `1.12.0` e as matrizes
dos contextos existentes não foram alteradas.

## Prompt Builder

O workspace `@brq/prompt-builder` transforma estruturas prontas em um `PromptResult` determinístico. A hierarquia conceitual `PromptDocument → PromptSection → PromptBlock → PromptFragment` é representada por `PromptTemplate` antes da resolução e por `ResolvedPromptDocument` depois dela. O renderer produz separadamente os canais `instructions` e `input`.

Templates usam slots tipados resolvidos em uma única passagem. O orçamento padrão centralizado é de 128 KiB, pode ser configurado por instância e apenas reduzido pela chamada; um preflight de limite inferior rejeita excesso evidente antes do clone por schema e da renderização, e a carga final é medida exatamente. Referências de proveniência não consomem esse orçamento de payload, mas possuem limite estrutural próprio, configurável por instância e aplicado antes do clone. Hashes canônicos identificam template, canais, output contract e resultado final. O documento resolvido preserva proveniência de rule sets e contextos sem incorporá-la ao `promptHash` do payload efetivo. A transformação não realiza I/O de domínio ou acesso a recursos externos; o logger estruturado injetável é sua única saída lateral. O módulo não conhece providers, agentes, Orchestrator, Knowledge Source ou persistência. Product Owner, Developer e QA possuem bundles estáticos próprios; loader genérico de prompts, registry, descoberta e seleção dinâmica de versões permanecem adiados.

[Fluxo visual do Prompt Builder](knowledge/27-PROMPT_BUILDER_FLOW.md)

## Prompt Inspector

A Sprint 20 adiciona `@brq/prompt-inspector`, uma façade transport-neutral e stateless para montar
previews reais de Product Owner, Developer e QA e validar respostas manuais. O serviço projeta
sections, trust boundaries, budget, Knowledge metadata, hashes e output contracts produzidos pelos
componentes existentes; ele não modifica prompts nem mantém um registry dinâmico.

O composition root do Inspector fica separado do runtime de execução em `apps/web/src/server/`
e não possui acesso a AI Provider, Agent Runner, Orchestrator, Execution Engine, Queue, Worker,
Repository ou Observability. Todo resultado é `EPHEMERAL`, protegido para `ADMIN`, servido com
`no-store` e proibido em logs ou persistência.

[Fluxo visual do Prompt Playground](knowledge/44-PROMPT_PLAYGROUND_FLOW.md) ·
[ADR-030](knowledge/ADR/ADR-030-PROMPT-PLAYGROUND-BOUNDARY.md)

## Agent Runner

O workspace `@brq/agent-runner` executa exatamente uma chamada abstrata de IA por invocação. Ele recebe um `PromptRequest` próprio, usa o `PromptBuilder` injetado, transforma o `PromptResult` validado em uma solicitação provider-neutral e chama somente a interface `AIProvider`.

O Runner não conhece OpenAI ou adapters concretos, não persiste dados, não valida regras funcionais da resposta e não executa retries. O `agentExecutionId` é a correlação obrigatória; cancelamento é encaminhado por `AbortSignal` e o timeout é aplicado exclusivamente pelo provider. A resposta bruta permanece em um `ResponseEnvelope` interno, enquanto o resultado público separa metadados, métricas observadas pelo Runner e valores reportados pelo provider.

[Fluxo visual do Agent Runner](knowledge/28-AGENT_RUNNER_FLOW.md)

## Response Validator

O workspace `@brq/response-validator` recebe um `AgentRunResult` não confiável e um `ValidationContract` declarativo e versionado. Sua pipeline classifica finish reasons, valida presença e formato do conteúdo, reinterpreta JSON, aplica JSON Schema e verifica a coerência de `structuredData` sem modificar a resposta original.

Falhas funcionais produzem um `ValidationResult` imutável com issues e hashes rastreáveis. O módulo não chama IA, não corrige respostas, não executa retry, não persiste dados e não contém regras específicas de Product Owner, Developer ou QA.

O entrypoint padrão e seus logs continuam sem detalhes diagnósticos adicionais. Exclusivamente em
desenvolvimento, o host pode habilitar o subpath `@brq/response-validator/development` com
`AI_FACTORY_STRUCTURED_OUTPUT_DEBUG=true`; nesse modo, rejeições de JSON Schema geram um evento
local separado com paths, keywords, tipos encontrados, mensagens canônicas sanitizadas e hashes,
sem incluir schema, valores ou resposta. A combinação é fail-open, fica desabilitada em produção
mesmo quando a flag está presente e não altera o `ValidationResult` nem seus hashes.

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

O diagnóstico local do Structured Output não chama provider. Coloque uma resposta JSON capturada
em `.ai/debug/structured-output/` — diretório ignorado pelo Git — e execute:

```bash
AI_FACTORY_STRUCTURED_OUTPUT_RAW_DEBUG=true npm run --silent debug:developer-output -- .ai/debug/structured-output/developer-output.json
```

O comando aceita a `TechnicalSpecification` diretamente ou um wrapper local com `candidate` e
`productOwnerSpecification`, e imprime somente o relatório sanitizado das etapas Response
Validator, Zod e Business Validation. Sem a specification de origem, a etapa de negócio usa uma
fixture canônica e marca `businessContextSource` como `DEFAULT_FIXTURE`; use o wrapper para
reproduzir o handoff histórico. `candidateHash` identifica somente o JSON local e não equivale ao
`responseHash` do envelope de produção. O arquivo pode conter dados funcionais: deve permanecer
local, não deve conter segredos e nunca é capturado automaticamente, persistido ou enviado ao
frontend. A auditoria do 1.0.2 não encontrou drift entre o output contract, o schema usado pelo
Validator e o schema transportado por Agent Runner e OpenAI adapter; por isso, nenhum bundle
1.0.3 é criado sem reproduzir a resposta histórica.

[Fluxo visual do Developer Agent](knowledge/34-DEVELOPER_AGENT_FLOW.md) · [Visão geral do pipeline](knowledge/33-PIPELINE_OVERVIEW.md) · [ADR-020](knowledge/ADR/ADR-020-DEVELOPER-AGENT-BOUNDARY.md)

## QA Agent

O workspace `agents/qa` implementa a terceira fachada concreta. O request recebe `ProductOwnerSpecification` e `TechnicalSpecification` pelos contratos públicos e valida a compatibilidade do par antes de carregar knowledge ou consumir IA. A fachada não executa nem chama os agentes anteriores.

Cada tentativa projeta exatamente três contextos `INPUT/UNTRUSTED` e segue `Knowledge Loader → Agent Runner → Response Validator → QA Business Validation → Artifact Generator`. A Business Validation exige cobertura verificável de todos os IDs `AC`, `BR`, `DEC` e `DOD`, recalcula totais e readiness e rejeita referências inválidas sem corrigir a saída.

Uma saída aceita gera, nessa ordem, `test-plan.md`, `traceability-matrix.json` e `qa-specification.md`. O QA Agent não recebe código, não executa testes, não gera Playwright, não persiste drafts, não retenta e não afirma aprovação operacional.

[Fluxo visual do QA Agent](knowledge/35-QA_AGENT_FLOW.md) · [Visão geral do pipeline](knowledge/33-PIPELINE_OVERVIEW.md) · [ADR-021](knowledge/ADR/ADR-021-QA-AGENT-BOUNDARY.md)

## Code Generator

O workspace `@brq/code-generator-agent` é uma nova fachada independente que recebe somente uma
`TechnicalSpecification` pública acompanhada de evidência técnica de workflow e QA `READY`. A
fachada recalcula a correlação da origem e executa uma única tentativa por
`Knowledge Loader → Agent Runner → Response Validator → Code Business Validation → Bundle
Assembler`.

A resposta aceita produz um `GeneratedCodeBundle` textual, ordenado, profundamente imutável e com
manifest, lineage, provenance e hashes calculados server-side. O modelo não fornece hashes ou
autoridade de filesystem. O Agent não importa AI Provider concreto, Artifact Generator,
filesystem, Orchestrator, Engine, Worker, Repository ou aplicações.

A Sprint 24 conecta essa capability somente pelo `FactoryPipelineCoordinator`, depois de uma
execução PO → Developer → QA bem-sucedida e QA `READY`. A projeção recebe a
`TechnicalSpecification` enquanto ela ainda existe em memória; o resultado público e o Execution
Repository preservam somente metadata e hashes, nunca a specification ou o código gerado.

[Fluxo visual do Code Generator](knowledge/46-CODE_GENERATION_FLOW.md) ·
[ADR-032](knowledge/ADR/ADR-032-CODE-GENERATION-BOUNDARY.md)

## Controlled Workspace

O workspace `@brq/controlled-workspace` é uma fronteira separada e sem dependência de agentes. O
planner puro revalida arquivos, paths, limites e hashes e produz um `WorkspacePlan` imutável. O
adapter explícito `@brq/controlled-workspace/filesystem` aceita somente uma raiz absoluta
configurada pelo host, grava em staging privado, relê os arquivos e publica o diretório com rename
atômico.

Paths absolutos, traversal, backslashes, drives/UNC, null bytes, normalização ambígua, symlinks,
arquivos sensíveis e colisões exatas, case-insensitive, Unicode ou arquivo/diretório são rejeitados.
Nenhum destino existente é sobrescrito e nenhum arquivo recebe permissão executável.

Código materializado continua sendo dado não confiável. O lifecycle aditivo aceita o mesmo
`AbortSignal`, executa rollback em falha/cancelamento e expõe `release()` com ownership verificado,
remoção limitada por deadline e resultado metadata-only. O coordinator é o owner do release e o
executa após qualquer resultado de Sandbox; workspaces não são retidos em SUCCESS ou FAILED.

[Fluxo visual do Controlled Workspace](knowledge/47-CONTROLLED_WORKSPACE_FLOW.md) ·
[ADR-032](knowledge/ADR/ADR-032-CODE-GENERATION-BOUNDARY.md)

## Sandbox Build & Test Runner

O workspace `@brq/sandbox-runner` define um port provider-neutral que recebe somente o resultado
público do Controlled Workspace e uma policy confiável selecionada pelo host. O adapter Docker é
exposto separadamente e executa a sequência fixa `PREPARE → TYPECHECK → BUILD → TEST` em um único
container descartável. Gerar, materializar e executar código permanecem três autoridades distintas.

O workspace original não é montado. O adapter relê e verifica paths, bytes e hashes e transfere uma
cópia limitada por stdin para um helper pinado. O container usa imagem por digest, usuário non-root,
root filesystem read-only, rede desabilitada, capabilities removidas e limites de CPU, memória,
PIDs, open files, bytes/inodes de tmpfs, output e tempo. Não há `--privileged`, Docker socket, host
path, package script, lifecycle script, shell arbitrário, instalação online, retry ou exportação de
build.

Após iniciar o processo idle, um helper fixo de readiness cria e verifica os diretórios no tmpfs
antes do `PREPARE`, eliminando corrida de inicialização sem adicionar etapa pública, espera
artificial ou retry.

Cancelamento, timeout, sucesso e falha convergem para um único cleanup idempotente, executado
exatamente uma vez e confirmado antes do retorno. stdout e stderr são drenados com hard limit,
sanitizados e resumidos; logs estruturados nunca carregam código ou conteúdo de output.

A suíte padrão usa executor Docker fake. A integração real é exclusivamente opt-in por
`npm run test:sandbox:integration`, exige daemon e imagem digest-pinned preparados explicitamente e
nunca realiza pull ou build automático. A Sprint 24 o conecta somente pela API pública ao
`FactoryPipelineCoordinator`; o Runner continua sem conhecer workflow, agentes, API, Repository,
Observability, Factory View ou Preview.

O contexto mínimo versionado, o build explícito da imagem local e as variáveis exigidas pelo teste
estão documentados no [README do Sandbox Runner](core/sandbox-runner/README.md).

[Fluxo visual do Sandbox Runner](knowledge/48-SANDBOX_RUNNER_FLOW.md) ·
[Modelo de segurança](knowledge/49-SANDBOX_SECURITY_MODEL.md) ·
[ADR-033](knowledge/ADR/ADR-033-SANDBOX-BUILD-TEST-RUNNER-BOUNDARY.md)

## Factory Pipeline

O workspace `@brq/factory-pipeline` implementa a composição externa e aditiva
`Execution Engine → Code Generator → Controlled Workspace → Sandbox Runner`. O
`FactoryPipelineCoordinator` depende somente das APIs públicas dessas quatro fronteiras; o
Orchestrator e o Execution Engine mantêm seus contratos e comportamentos funcionais intactos.

`FactoryExecutionResult` preserva `ExecutionResult` e `WorkflowResult` existentes e publica apenas
status, durações, hashes, lineage, provenance e metadata segura. O resultado é `SUCCESS` somente
quando PO, Developer, QA, Code Generator, planejamento/materialização do workspace, `PREPARE`,
`TYPECHECK`, `BUILD`, `TEST` e release confirmado terminam com sucesso. Falhas funcionais são
resultados terminais normais, preservam as etapas anteriores e marcam downstream como `SKIPPED`;
não são convertidas em erro HTTP genérico.

O Worker de produção consome o pipeline completo, enquanto seu port legado de Execution Engine é
mantido para compatibilidade. Cancelamento propaga o mesmo `AbortSignal`; a Sandbox continua dona
de stop/remoção do container e o coordinator continua dono do release do workspace. Não existe
retry, fallback automático, retenção de código, preview, servidor, porta ou deploy.

[Fluxo visual do Factory Pipeline](knowledge/50-FACTORY_PIPELINE_FLOW.md) ·
[ADR-034](knowledge/ADR/ADR-034-FACTORY-PIPELINE-INTEGRATION-BOUNDARY.md)

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

Para o dispatch assíncrono, o Engine também expõe `deriveExecutionIdentity(request)`: uma operação
pura que reserva o `executionId` e o `executionRequestHash` usando o mesmo algoritmo versionado de
`execute()`, sem iniciar o Orchestrator ou alterar estado. API, fila e Frontend nunca calculam a
identidade da execução.

[Fluxo visual do Execution Engine](knowledge/37-EXECUTION_ENGINE_FLOW.md) · [ADR-023](knowledge/ADR/ADR-023-EXECUTION-ENGINE-BOUNDARY.md)

## HTTP API

A API permanece um adapter em Next.js 16 Route Handlers. A versão aditiva `3.1.0` preserva a
fronteira autenticada `3.0.0` e os contratos assíncronos introduzidos na versão `2.0.0`:
`POST /api/executions` valida a entrada, delega ao `ExecutionDispatcher` e devolve imediatamente
`202 Accepted` com `executionId`, `jobId` e status `QUEUED`; o workflow não mantém a conexão HTTP
aberta. `GET /api/jobs/[id]` consulta o repository e devolve `QUEUED`, `RUNNING`, `SUCCESS`,
`FAILED` ou `CANCELLED` com timestamps minimizados.

`GET /api/health` continua sem consultar banco, IA ou workflow. `GET /api/executions`,
`GET /api/executions/[id]` e `GET /api/executions/[id]/timeline` continuam consultando o
Execution Repository, com paginação, filtros e read models públicos já aprovados. O detalhe pode
incluir `factoryResult` minimizado, e a timeline aceita snapshots históricos `1.0.0` e snapshots
Factory `2.0.0`; registros históricos sem esses campos permanecem válidos.

`POST /api/auth/login` e `POST /api/auth/logout` usam envelopes públicos próprios e nunca expõem o
token interno do adapter. Todas as rotas de execução, histórico, timeline e job exigem sessão; o
health check e o login permanecem públicos. A API deriva o owner exclusivamente da sessão, rejeita
campos desconhecidos e devolve `404` para lookup cross-owner de um USER, evitando enumeração.

O adapter valida origem, media type, encoding, limite de 512 KiB, JSON e schema Zod; gera
`requestId` e não altera hashes, métricas, lineage ou provenance. Após a aceitação, o sinal da
requisição HTTP não controla o job: cancelamento e shutdown pertencem ao Worker. Logs e erros usam
allowlists sanitizadas e todas as respostas recebem headers mínimos de segurança.

O composition root fica no host em `apps/web/src/server/runtime.ts`. Ele monta factories públicas
de forma lazy e fornece o Factory Pipeline persistente/observado, repository, fila local,
dispatcher e Worker; o Engine continua sendo composto internamente sem receber responsabilidades
de geração, filesystem ou Sandbox;
nenhum workspace de runtime foi criado no domínio. A API não conhece agentes, Prisma ou
componentes internos do workflow.

[Fluxo visual da HTTP API](knowledge/38-HTTP_API_FLOW.md) · [ADR-024](knowledge/ADR/ADR-024-HTTP-API-ADAPTER-BOUNDARY.md)

## Frontend MVP

O formulário recebe Project Name e Objective e envia uma única vez `POST /api/executions`. O
client HTTP recebe o contrato de aceitação do job e mantém no máximo uma leitura em andamento.
Polling consulta estado; nunca repete o POST nem representa retry do workflow.

A Sprint 21 navega para `/executions/[executionId]/factory` assim que o backend aceita o job. A
Factory consulta o job enquanto ele permanece enfileirado, troca para a Timeline durante a
execução e atualiza o detalhe uma vez ao observar um estado terminal. Falhas e cancelamentos não
disparam nova execução. O histórico, o detalhe técnico e a Factory continuam consumindo somente
read models HTTP minimizados.

Clients HTTP internos continuam sendo os únicos pontos que chamam `fetch`. O Frontend não importa
Engine, Worker, fila, repository, Orchestrator, agentes, runtime ou internals da API e não renderiza
prompts, specifications, artifacts, knowledge, respostas da IA ou logs.

O request HTTP ainda preserva IDs e configurações técnicas dos agentes herdados do contrato
anterior. O client fornece um perfil técnico versionado e gera esses IDs por submissão como
limitação temporária; `executionId` e `jobId` são sempre produzidos no backend.

A Sprint 19 adiciona `/login`, header autenticado, logout e proteção server-side da homepage,
histórico e detalhe. A página protegida `/profile` recebe somente a projeção segura do usuário:
ID, nome, email, role e timestamps. Tokens, cookies, password hashes, Session e Account nunca
integram props ou estado React.

A Sprint 20 adiciona `/playground` exclusivamente para `ADMIN`. A experiência usa somente o client
HTTP interno para inspecionar a construção do prompt, budget, hashes, Knowledge metadata, contrato
e validação manual. Nenhum componente React importa agentes ou workspaces do núcleo, e nenhum dado
de inspeção é persistido no browser.

[Fluxo visual do Frontend MVP](knowledge/39-FRONTEND_FLOW.md) · [ADR-025](knowledge/ADR/ADR-025-FRONTEND-MVP.md)

## Factory Visualization

A Sprint 21 adiciona `/executions/[id]/factory`, uma sala de controle autenticada e read-only para
acompanhar Knowledge e a linha Product Owner → Developer → QA. `FactoryViewModel` é a única
fronteira consumida pelos componentes React e deriva deterministicamente de Job, Execution Detail,
Timeline, Stage Metrics, Lineage e Provenance públicos.

A visualização apresenta somente estados comprovados: `WAITING`, `WORKING`, `COMPLETED`, `FAILED`,
`CANCELLED`, `SKIPPED` ou `NOT_OBSERVED`. Ela não simula conversa, raciocínio ou fases live de
validação e geração de artifacts. Handoffs identificam quando foram observados, sem afirmar um
timestamp autoritativo; artifact cards usam somente hashes reais, porque filename e tipo não
integram o read model atual.

O polling é phase-aware, sequencial e somente leitura. A Factory não cria endpoint agregado,
workspace, dependência, evento, persistência ou acesso ao runtime de IA. Ownership continua sendo
aplicado pela API e pelo Execution Repository.

A Sprint 24 acrescenta uma linha técnica, sem novos personagens, para Code Generator, Workspace,
Prepare, Typecheck, Build e Test. Todos os estados continuam derivados exclusivamente de Timeline
`2.0.0` e `factoryResult` persistido; execuções históricas `1.0.0` mantêm a visualização anterior.
Release do workspace aparece somente como metadata de lifecycle, não como atividade simulada.

[Fluxo visual da Factory](knowledge/45-FACTORY_VISUALIZATION_FLOW.md) ·
[ADR-031](knowledge/ADR/ADR-031-FACTORY-VISUALIZATION-BOUNDARY.md)

## Execution History & Observability

A Sprint 16 implementa o workspace `@brq/observability` em `core/observability`. A versão `1.0.0`
continua disponível: ela decora somente a API pública do Execution Engine, normaliza logs técnicos
sanitizados em eventos tipados e
imutáveis e mantém snapshots minimizados em um store bounded, local ao processo e sem
persistência.

A timeline acompanha Knowledge, Product Owner, Developer e QA, além dos eventos de delimitação de
execution e workflow. Métricas por agente preservam duração, bytes, tokens, latência do provider,
validação e geração de artifacts. O `Execution Summary` consolida status, readiness, duração,
tokens, etapas executadas ou ignoradas e os hashes finais sem recalculá-los. Como não existe rate
card aprovado e versionado, `totalCostEstimate` permanece `null`.

O Frontend consulta `GET /api/executions/[id]/timeline` com React puro nas telas de histórico e
detalhe. A timeline e as métricas continuam sendo produzidas pelo decorator existente durante o
processamento do Worker. O polling de job e de timeline apenas consulta projeções, não retenta o
workflow e para em resultado terminal ou unmount.

O reducer em memória da Sprint 16 continua sendo a projeção síncrona e fail-open dos eventos. A
Sprint 17 projeta esses snapshots no repository durável; falhas observacionais intermediárias
continuam best-effort, enquanto a gravação terminal faz parte da fronteira persistente do host.

A versão aditiva `2.0.0` observa também Code Generator, Workspace e as quatro etapas reais da
Sandbox. Ela inicia e termina na fronteira externa da Factory para que o sucesso intermediário do
Execution Engine não terminalize a timeline. Não há eventos inventados, conteúdo funcional ou
alteração de hashes; snapshots `1.0.0` permanecem válidos pela união discriminada versionada.

[Fluxo visual da Observabilidade](knowledge/40-OBSERVABILITY_FLOW.md) · [ADR-026](knowledge/ADR/ADR-026-OBSERVABILITY-BOUNDARY.md)

## Execution Repository & Persistence

A Sprint 17 implementa `@brq/execution-repository` em `core/execution-repository`. O workspace
possui o port `ExecutionRecordRepository`, schemas Zod, projeções imutáveis, adapter em memória e
adapter Prisma. O agregado `ExecutionRecord` é separado do model `Execution` histórico e usa
tabelas normalizadas para lifecycle, hashes, observação, timeline, métricas, lineage e provenance.

Um coordinator externo, composto pelo host depois do decorator observacional, registra `CREATED`,
`RUNNING` e o estado terminal sem alterar o Execution Engine concreto. Como a API pública do Engine
reserva a identidade determinística antes do dispatch, o fluxo assíncrono cria o registro já com
`executionId` e a relação `ExecutionJob`. O mesmo algoritmo interno é reutilizado por `execute()`,
sem duplicação de hashing.

O Frontend adiciona `/executions` e `/executions/[id]`, consumindo apenas read models HTTP
minimizados. A listagem aceita `status`, `readiness`, `createdAfter`, `createdBefore`, `limit` e
`cursor`. Nenhum componente React importa o repository, Prisma ou o núcleo da AI Factory.

A Sprint 24 adiciona tabelas normalizadas opcionais para resultado, etapas, lineage, provenance e
toolchains da Factory. Somente metadata allowlisted é persistida: status, durações, hashes,
resource outcomes, versões, policy e identidade imutável da imagem. Código, prompts,
specifications, output bruto, filesystem, secrets e `AbortSignal` não entram no banco.

[Fluxo visual do Execution Repository](knowledge/41-EXECUTION_REPOSITORY_FLOW.md) ·
[ADR-027](knowledge/ADR/ADR-027-EXECUTION-REPOSITORY-BOUNDARY.md)

## Asynchronous Execution Queue

A Sprint 18 implementa `@brq/job-queue` e `@brq/execution-worker`. O primeiro define o port
substituível, contratos, schemas, eventos, métricas e o adapter local `InMemoryJobQueue`; o segundo
contém o dispatcher e o único consumidor sequencial, que chama exclusivamente a API pública do
Execution Engine.

O fluxo de produção é `HTTP → Dispatcher → JobQueue → Execution Worker → Factory Pipeline →
Repository`; o port legado do Worker para `ExecutionEngine` permanece compatível. A fila usa FIFO,
um consumidor, `attempt: 1` e a máquina
`QUEUED → RUNNING → SUCCESS | FAILED | CANCELLED`, além de `QUEUED → CANCELLED`. Não existem
retry, requeue, backoff, scheduler, concorrência ou worker externo. Os eventos imutáveis
`job.created`, `job.started`, `job.finished`, `job.failed` e `job.cancelled` contêm somente
metadados técnicos sanitizados.

O dispatcher registra a metadata durável antes de enfileirar. O payload permanece privado no
adapter em memória e é removido em qualquer estado terminal. Reinício do processo perde jobs
ativos, embora a metadata persista; registros podem ficar stale porque recovery está fora do
escopo. Múltiplas instâncias mantêm filas independentes e ambientes serverless não garantem que o
processo continue ativo depois do `202`.

[Fluxo visual da Job Queue](knowledge/42-JOB_QUEUE_FLOW.md) ·
[ADR-028](knowledge/ADR/ADR-028-JOB-QUEUE-BOUNDARY.md)

## Authentication & Authorization

A Sprint 19 concentra identidade no host Next.js. Better Auth foi escolhido depois de uma
reavaliação explícita com Auth.js: o fluxo Credentials do Auth.js não persiste credenciais por
padrão e exigiria código próprio relevante para combinar email/senha com as database sessions
revogáveis adotadas. Better Auth fornece o fluxo de credential account, sessões Prisma e logout
server-side sem entrar em qualquer workspace de domínio.

Passwords usam Argon2id; sessões duram oito horas, não são renovadas automaticamente e chegam ao
browser somente em cookie `httpOnly`, `sameSite=lax`, host-only e `secure` em produção. Mutações
validam a origem exata do host. Logs podem conter apenas `userId`, role, outcome, correlações e
códigos sanitizados; password, hash, cookie, token e authorization header são sempre proibidos.

`USER` cria e consulta somente suas execuções, jobs e timelines. `ADMIN` cria como o próprio owner
e possui leitura global explícita. A aplicação converte o principal autenticado em uma capability
do Execution Repository; o repository conhece owner IDs opacos, mas não conhece sessão ou papéis.
Workers continuam usando somente acesso interno de lifecycle. Nenhum `userId` fornecido pelo
frontend é aceito.

O Frontend possui `/login`, usuário atual, logout, páginas protegidas e `/profile`. O perfil expõe
somente a projeção pública mínima da conta. OAuth, SSO, MFA, permission engine, rate limit e
administração completa de usuários permanecem fora do escopo.

[Fluxo visual de Authentication & Authorization](knowledge/43-AUTHENTICATION_FLOW.md) ·
[ADR-029](knowledge/ADR/ADR-029-AUTHENTICATION-AUTHORIZATION-BOUNDARY.md)

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
