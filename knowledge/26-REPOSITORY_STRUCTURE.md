# Repository Structure

## Objetivo

Definir a organização física do repositório.

Toda implementação deve respeitar esta estrutura.

---

# Estrutura

```
BRQ-AI-FACTORY/

.ai/

knowledge/

apps/

core/

agents/

prompts/

shared/

prisma/

package.json

README.md
```

---

# .ai

Contém documentação utilizada exclusivamente pelas IAs.

Arquivos:

```
PROJECT_MEMORY.md

CODEX_INSTRUCTIONS.md

DEVELOPMENT_WORKFLOW.md

IMPLEMENTATION_STRATEGY.md

NEXT_STEPS.md

OPEN_QUESTIONS.md
```

Nenhum código deve existir nesta pasta.

---

# knowledge

Representa a Knowledge Layer.

Contém toda documentação do projeto.

Inclui:

- arquitetura
- domínio
- agentes
- padrões
- ADRs
- segurança
- roadmap

Esta pasta representa a principal fonte de verdade.

---

# apps

Aplicações.

Inicialmente:

```
apps/

web/
```

Na Sprint 14, `apps/web/src/app/api/` contém exclusivamente o adapter HTTP e
`apps/web/src/server/runtime.ts` contém o composition root lazy do host. A composição concreta não
é um workspace de domínio e não mantém estado funcional de execução.

Na Sprint 15, a interface permanece no mesmo host:

```text
apps/web/src/
├── app/
│   ├── page.tsx
│   └── globals.css
├── components/
│   └── componentes do Frontend MVP
├── api/
│   └── execution-client.ts
└── server/
    └── runtime.ts
```

`page.tsx` é Server Component. Componentes browser-side podem depender apenas do client HTTP e de
DTOs locais; não importam `@brq/*`, `server/` ou internals de `app/api/`. `ExecutionSummary` é o
único resultado propagado pela árvore React.

Na Sprint 16, o host também conecta o decorator observacional, o histórico limitado em memória e o
reader público usado por `GET /api/executions/[id]/timeline`. O Frontend consulta esse endpoint por
polling limitado e recebe somente timeline, métricas e resumo minimizados; nenhuma regra de
workflow ou conteúdo sensível foi movido para `apps/web`.

No futuro:

```
mobile/

desktop/

admin/
```

---

# core

Contém toda lógica central da plataforma.

Estrutura:

```
core/

agent-runner/

ai-provider/

artifact-generator/

controlled-workspace/

execution-engine/

execution-repository/

execution-worker/

job-queue/

knowledge-loader/

observability/

orchestrator/

prompt-builder/

prompt-inspector/

response-validator/

sandbox-runner/
```

---

## Execution Engine

Implementado em `core/execution-engine/` como workspace `@brq/execution-engine`. Responsável por
criar a identidade determinística, iniciar o Orchestrator público uma vez e controlar o ciclo
local sem persistência ou retry.

---

## Observability

Implementado em `core/observability/` como workspace `@brq/observability`. Observa exclusivamente a
API pública do Execution Engine por decorator e projeta eventos imutáveis, timeline ordenada,
métricas por agente e `ExecutionSummary` em um store limitado e local ao processo. O custo estimado
permanece `null` sem rate card aprovado. O módulo não inicia workflow, não contém lógica de agentes
e não persiste dados.

---

## Controlled Workspace

Implementado em `core/controlled-workspace/` como workspace `@brq/controlled-workspace`. O
entrypoint principal mantém contratos, schemas e planner provider-neutral; o adapter local existe
somente no subpath explícito `./filesystem`. O workspace valida e materializa arquivos textuais sob
uma raiz controlada, sem executar código, package manager, build ou testes.

---

## Sandbox Runner

Implementado em `core/sandbox-runner/` como workspace `@brq/sandbox-runner`. O entrypoint principal
define o port provider-neutral, contratos, schemas, policies, lifecycle, hashes e resultados
imutáveis. Docker é um adapter explícito e não integra o contrato principal.

O Runner recebe somente o resultado público do Controlled Workspace e uma policy confiável. Ele
não importa agentes, Orchestrator, Execution Engine, Worker, Queue, Repository, Prisma ou apps. A
Sprint 23 não o conecta a nenhuma dessas camadas.

```text
sandbox-runner/
├── index.ts
├── contracts.ts
├── schemas.ts
├── configuration.ts
├── policies.ts
├── lifecycle.ts
├── hashing.ts
├── output-sanitizer.ts
├── docker/
├── integration/
│   ├── docker-sandbox-runner.integration.ts
│   └── image/
│       ├── Dockerfile
│       ├── idle
│       └── runner/
└── testing/
```

O adapter Docker nunca executa código gerado diretamente no host, não monta o workspace e não
aceita comandos do request. Uma cópia verificada é enviada por stdin a um container digest-pinned,
non-root, read-only, sem rede, mounts, Docker socket, package scripts ou retry.

---

## Orchestrator

Coordena o pipeline.

Nunca conversa diretamente com a OpenAI.

---

## Knowledge Loader

Autoriza, indexa, seleciona e carrega apenas o conhecimento necessário.

Estrutura inicial:

```text
knowledge-loader/

knowledge-manifest.json

contracts.ts

schemas.ts

knowledge-source.ts

knowledge-loader.ts

filesystem/

testing/
```

O manifesto é declarativo e validado por Zod. IDs documentais são explícitos e independentes dos nomes físicos. `KnowledgeSource` mantém consumidores desacoplados do filesystem.

O módulo produz contexto íntegro e rastreável, com orçamento configurável. Não monta prompts, executa agentes, coordena o pipeline, persiste dados, resume conteúdo ou utiliza IA, embeddings, RAG e busca semântica.

---

## Prompt Builder

Transforma estruturas prontas em um `PromptResult` determinístico.

Estrutura inicial:

```text
prompt-builder/

package.json

canonical-json.ts

contracts.ts

context-injector.ts

errors.ts

hashing.ts

immutability.ts

index.ts

prompt-assembler.ts

prompt-budget.ts

prompt-builder.ts

prompt-comparator.ts

prompt-renderer.ts

prompt-template.ts

schemas.ts

variable-resolver.ts

testing/prompt-fixtures.ts

*.spec.ts
```

O prompt segue a hierarquia conceitual imutável `PromptDocument → PromptSection → PromptBlock → PromptFragment`, representada concretamente por `PromptTemplate` antes da resolução e por `ResolvedPromptDocument` depois dela. Seções declaram os canais semânticos `INSTRUCTIONS` ou `INPUT`; o renderer produz os textos separados `instructions` e `input`.

A transformação é pura e sem I/O de domínio ou acesso a recursos externos; o logger estruturado injetável é sua única saída lateral. O módulo não lê `agents/`, `prompts/` ou `knowledge/`, não carrega assets, não seleciona versões e não conhece AI Provider, Agent Runner, Orchestrator, Knowledge Source, Prisma ou frontend.

---

## Agent Runner

Executa a fronteira genérica entre um prompt estruturado e o AI Provider.

Estrutura inicial:

```text
agent-runner/

package.json

agent-runner.ts

contracts.ts

errors.ts

index.ts

response-envelope.ts

schemas.ts

*.spec.ts
```

Único componente de produção autorizado a chamar a interface abstrata de IA.

Seus contratos públicos incluem `PromptRequest`, `AgentRunRequest`, `AgentRunOptions` e `AgentRunResult`. `PromptRequest` pertence ao Runner e não expõe `PromptBuildInput`. O `ResponseEnvelope` que mantém o `AIResponse` validado, sua representação canônica, hash e tamanho é exclusivamente interno.

O módulo é genérico, executa uma única chamada ao provider e não contém regras específicas de agente, retry, timer, persistência ou validação funcional. O timeout é aplicado pelo AI Provider, e o `AbortSignal` recebido é somente encaminhado.

---

## Response Validator

Valida funcionalmente um `AgentRunResult` por meio de um contrato declarativo e versionado.

Estrutura inicial:

```text
response-validator/

package.json

canonical-json.ts

configuration.ts

contracts.ts

errors.ts

hashing.ts

immutability.ts

index.ts

issues.ts

json-schema-validator.ts

logging.ts

response-validator.ts

schemas.ts

pipeline/content-stage.ts

pipeline/contract-stage.ts

pipeline/request-stage.ts

pipeline/result-stage.ts

pipeline/schema-stage.ts

pipeline/structured-output-stage.ts

pipeline/validation-pipeline.ts

pipeline/validation-report.ts

testing/

*.spec.ts
```

A `ValidationPipeline`, executada internamente por `executeValidationPipeline`, separa validação de request, contrato, conteúdo, JSON Schema e structured output. Findings são reunidos em um `ValidationReport` interno e projetados em um `ValidationResult` público imutável. Nenhum desses dois detalhes internos integra os exports do workspace. O dialect JSON inicial é `DRAFT_2020_12`, e `expectedOutputContractHash` vincula o contrato funcional ao output contract usado na execução.

O módulo depende somente da API pública do Agent Runner, de componentes transversais de `shared` e do engine local de JSON Schema. Não chama IA, corrige respostas, executa retry, conhece agentes concretos, cria artifacts, persiste dados ou altera estados.

---

## Artifact Generator

Transforma um resultado funcionalmente validado em drafts de artifacts, sem criar arquivos físicos.

Estrutura inicial:

```text
artifact-generator/

package.json

artifact-generator.ts

binding-resolution.ts

canonical-json.ts

configuration.ts

content-hashing.ts

contracts.ts

errors.ts

immutability.ts

index.ts

logging.ts

rendering.ts

resolved-artifact-model.ts

schemas.ts

structural-hashing.ts

validation.ts

testing/

*.spec.ts
```

Os contratos públicos incluem `ArtifactGenerationRequest`, `ArtifactSpecification`, templates e bindings declarativos, `GeneratedArtifact` e `ArtifactGenerationResult`. `ResolvedArtifactModel` permanece interno e separa binding resolution de rendering.

O módulo depende somente da API pública de `core/response-validator` e de componentes transversais de `shared`. Não contém specifications de agentes concretos, não escreve no filesystem, não usa repositories, não persiste nem versiona artifacts e não coordena workflow.

---

## AI Provider

Abstração provider-neutral com OpenAI como adapter inicial.

Permite múltiplos modelos.

---

# agents

Implementação dos agentes.

Estrutura:

```text
product-owner/
    package.json
    product-owner-agent.ts
    contracts.ts
    schemas.ts
    errors.ts
    business-validation.ts
    knowledge-projection.ts
    prompt-request.ts
    prompt-assets.ts
    result.ts
    logging.ts
    testing/
    *.spec.ts

developer/
    package.json
    developer-agent.ts
    contracts.ts
    schemas.ts
    errors.ts
    business-validation.ts
    knowledge-projection.ts
    prompt-request.ts
    prompt-assets.ts
    result.ts
    logging.ts
    testing/
    *.spec.ts

qa/
    package.json
    qa-agent.ts
    contracts.ts
    schemas.ts
    errors.ts
    business-validation.ts
    knowledge-projection.ts
    prompt-request.ts
    prompt-assets.ts
    result.ts
    logging.ts
    testing/
    *.spec.ts
```

O Product Owner é uma fachada de uma única tentativa. Sua factory valida dependências e assets antes de aceitar requests. A tentativa usa somente as APIs públicas de Knowledge Loader, Agent Runner, Response Validator e Artifact Generator; após o gate da Business Validation, o Generator recebe o `ValidationResult` aceito e a `ArtifactSpecification`. O Runner continua sendo o único ponto que integra Prompt Builder e AI Provider para executar o modelo.

O workspace também reutiliza tipos e schemas declarativos de prompt e os utilitários públicos de canonical JSON e hashing do Prompt Builder para validar assets e proveniência, sem instanciar ou chamar o Builder. A Business Validation limita o relatório a 100 issues e informa `issuesTruncated`; a saída aceita contém exatamente três artifacts. Business Validation, schemas e assets específicos permanecem locais ao agente; não são movidos para `shared`.

O Developer segue a mesma composição de tentativa, mas recebe uma `ProductOwnerSpecification` válida pelo entrypoint público `@brq/product-owner-agent` e produz uma `TechnicalSpecification`. Essa dependência é somente contratual: o pacote não cria nem executa a fachada anterior. Sua Business Validation acrescenta grafos, ciclos, readiness herdada e cobertura integral dos Acceptance Criteria; a Artifact Specification gera `architecture.md`, `implementation-plan.md` e `technical-decisions.json`. Não há geração de código ou testes, filesystem, comandos, retry, estado, persistência, QA ou Orchestrator dentro do workspace.

O QA recebe `ProductOwnerSpecification` e `TechnicalSpecification` pelos dois entrypoints públicos e usa somente a validação pura do Developer para verificar a compatibilidade do par. Produz uma `QASpecification`, exige cobertura de `AC`, `BR`, `DEC` e `DOD` e gera `test-plan.md`, `traceability-matrix.json` e `qa-specification.md`. Não chama as fachadas anteriores, não executa testes e não conhece workflow ou persistência.

---

# prompts

Prompts versionados.

```text
product-owner/
    1.0.0/
        manifest.json
        template.json
        global-rules.json
        security-rules.json
        product-owner-rules.json
        output-contract.json
        artifact-specification.json

developer/
    1.0.0/
        manifest.json
        template.json
        global-rules.json
        security-rules.json
        developer-rules.json
        output-contract.json
        artifact-specification.json

qa/
    1.0.0/
        manifest.json
        template.json
        global-rules.json
        security-rules.json
        qa-rules.json
        output-contract.json
        artifact-specification.json
```

O Prompt Builder monta o Prompt Final.

Os bundles 1.0.0 de Product Owner, Developer e QA são declarativos, importados estaticamente e validados antes do uso. Cada manifest referencia filenames, IDs e versões, enquanto o loader calcula os hashes. Os JSON Schemas iniciais evitam `$schema` e `uniqueItems` para a compatibilidade alvo com Structured Outputs de modelos-base; modelos fine-tuned exigem verificação explícita. O Builder recebe estruturas prontas e continua sem acessar esta pasta. Registry, descoberta dinâmica e seleção automática de versão permanecem futuros.

---

# prisma

Contém a configuração local de persistência do MVP.

Desde a Sprint 2 contém:

```text
client.ts
mappers.ts
migrations/
repositories/
tests/
schema.prisma
```

O workspace `@brq/prisma` depende de `@brq/shared`. Nenhum detalhe do Prisma pertence à Shared Layer ou ao `core`.

---

# shared

Código reutilizável.

Estrutura:

```
types/

schemas/

constants/

logger/

utils/

config/

errors/
```

Nenhuma regra específica de agente deve existir aqui.

---

# npm workspaces

O `package.json` da raiz coordena os npm workspaces.

Workspaces implementados:

- `apps/web`;
- `shared`;
- `prisma`;
- `agents/code-generator`;
- `agents/developer`;
- `agents/product-owner`;
- `agents/qa`;
- `core/agent-runner`;
- `core/ai-provider`;
- `core/artifact-generator`;
- `core/controlled-workspace`;
- `core/sandbox-runner`;
- `core/execution-engine`;
- `core/execution-repository`;
- `core/execution-worker`;
- `core/job-queue`;
- `core/knowledge-loader`;
- `core/observability`;
- `core/orchestrator`;
- `core/prompt-builder`;
- `core/prompt-inspector`;
- `core/response-validator`;

Cada módulo é registrado como workspace somente quando for implementado pela Sprint correspondente.

---

# Fluxo de Dependências

```text
apps
  ↓
core/observability (decorator observacional e reader público)
  ↓
core/execution-engine
  ↓
core/orchestrator
  ↓
agents
  ↓
APIs públicas dos componentes core + shared

core/sandbox-runner
  ↓
core/controlled-workspace (somente contratos públicos)
  ↓
shared
```

Componentes genéricos de `core` não conhecem agentes concretos. Como coordenador central, o Orchestrator é a exceção prevista pelo ADR-011 e chama somente as fachadas públicas em `agents`; cada fachada, por sua vez, compõe somente APIs públicas explicitamente permitidas pelo ADR correspondente.

`core/orchestrator` não expõe deep imports e depende apenas de `@brq/product-owner-agent`,
`@brq/developer-agent`, `@brq/qa-agent`, `@brq/shared` e Zod. O workspace não conhece componentes
internos dos agentes nem camadas inferiores do pipeline.

---

# Regras

## apps

Pode acessar:

- core

- shared

Não acessa diretamente agentes.

---

## core

Pode acessar:

- agents

- prompts

- shared

O Prompt Builder é uma exceção mais restrita dentro de `core`: recebe estruturas prontas e não acessa `agents/`, `prompts/` ou `knowledge/`.

O Agent Runner pode acessar somente as APIs públicas de `core/prompt-builder`, `core/ai-provider` e componentes transversais de `shared`. Não pode importar adapters concretos de provider, OpenAI, Responses API, `agents/`, Orchestrator, Knowledge Loader, `knowledge/`, Prisma ou `apps/`.

O Response Validator pode acessar somente a API pública de `core/agent-runner`, componentes transversais de `shared` e seu engine local de JSON Schema. Não pode importar internals do Runner, Prompt Builder, AI Provider, adapters, `agents/`, Orchestrator, Artifact Generator, Knowledge Loader, Prisma ou `apps/`.

O Artifact Generator pode acessar somente a API pública de `core/response-validator` e componentes transversais de `shared`. Não pode importar internals do Validator, Agent Runner, Prompt Builder, AI Provider, Knowledge Loader, `agents/`, Orchestrator, repositories, Prisma, `apps/` ou adapters de filesystem.

O workspace de Observability pode acessar somente as APIs públicas de `core/execution-engine`,
componentes transversais de `shared` e Zod. Não pode importar Orchestrator, agentes, componentes
inferiores do pipeline, Prisma, repositories ou código de `apps/`. O store em memória é limitado,
observacional e não constitui persistência.

O Sandbox Runner pode acessar somente os contratos públicos de `core/controlled-workspace`,
componentes transversais de `shared` e Zod. O entrypoint principal permanece provider-neutral; o
adapter Docker explícito é o único código que controla o runtime. O workspace não pode importar
Code Generator, demais agentes, Orchestrator, Execution Engine, Worker, Queue, Repository, Prisma
ou apps. Docker adapter não autoriza execução no host, bind mount, network, privileged, Docker
socket, package scripts, lifecycle scripts ou retry.

---

## agents

Pode acessar:

- `shared`;
- APIs públicas de `core/knowledge-loader`, `core/agent-runner`, `core/response-validator` e `core/artifact-generator` quando exigidas pela fachada;
- tipos e schemas declarativos e utilitários públicos de canonicalização e hashing do `core/prompt-builder`, sem chamar o Builder diretamente.
- no Developer, somente tipos e schemas públicos da `ProductOwnerSpecification` pelo entrypoint `@brq/product-owner-agent`.
- no QA, os contratos públicos de Product Owner e Developer e a validação pura de compatibilidade da `TechnicalSpecification`, sem executar qualquer fachada.

Nunca chama outra fachada, usa deep imports de outro agente, acessa adapters concretos de provider, Prisma, repositories, apps ou internals de `core`. Workflow, retry, persistência e transições de estado permanecem fora das fachadas.

---

## prompts

Não contém código.

Contém assets declarativos versionados, incluindo instruções, templates, manifests, schemas e artifact specifications.

---

## knowledge

Nunca depende do código.

O código depende dela.

---

# Convenções

Arquivos:

```
kebab-case
```

Classes:

```
PascalCase
```

Variáveis:

```
camelCase
```

Constantes:

```
UPPER_SNAKE_CASE
```

---

# Crescimento Futuro

A estrutura permite adicionar:

```
workers/

queue/

plugins/

memory/

evaluation/

analytics/

sdk/

cli/

monitoring/
```

Sem alterar os módulos existentes.

---

# Objetivo Final

A estrutura do repositório deve permitir:

- baixo acoplamento;
- alta coesão;
- modularidade;
- escalabilidade;
- reutilização;
- facilidade de navegação;
- implementação por agentes de IA;
- evolução incremental sem refatorações estruturais frequentes.
