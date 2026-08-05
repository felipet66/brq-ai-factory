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
│   │   └── ADR-018-ARTIFACT-GENERATOR-BOUNDARY.md
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
│   └── 31-ARTIFACT_LIFECYCLE.md
│
├── core/
├── agents/
├── prompts/
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

O MVP utiliza SQLite local. Os comandos de migration inicializam o arquivo configurado em `DATABASE_URL` quando necessário. Nenhuma configuração de deploy faz parte do MVP atual.

## Persistência

O workspace `@brq/prisma` implementa os repositories definidos em `@brq/shared`. Para criar uma migration durante o desenvolvimento:

```bash
npm run prisma:migrate:dev -- --name nome_da_migration
```

Não existe seed obrigatório. Input e output de agentes, provenance de artifacts e contexto de logs são persistidos como JSON.

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

Templates usam slots tipados resolvidos em uma única passagem. O orçamento padrão centralizado é de 128 KiB, pode ser configurado por instância e apenas reduzido pela chamada; um preflight de limite inferior rejeita excesso evidente antes do clone por schema e da renderização, e a carga final é medida exatamente. Referências de proveniência não consomem esse orçamento de payload, mas possuem limite estrutural próprio, configurável por instância e aplicado antes do clone. Hashes canônicos identificam template, canais, output contract e resultado final. O documento resolvido preserva proveniência de rule sets e contextos sem incorporá-la ao `promptHash` do payload efetivo. A transformação não realiza I/O de domínio ou acesso a recursos externos; o logger estruturado injetável é sua única saída lateral. O módulo não conhece providers, agentes, Orchestrator, Knowledge Source ou persistência. Assets, Prompt Manifest, loader, selector e consumers de produção permanecem adiados.

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

## Validações

```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run prisma:validate
npm run build
npm run format:check
```
