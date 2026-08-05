# Project Memory

## Estado atual

Sprint 10 — Developer Agent implementada e validada tecnicamente em 2026-08-05, aguardando aprovação humana. A Sprint 11 não deve começar sem essa aprovação.

## Fundação técnica

- Node.js 24.19.0 LTS e npm 11.17.0;
- npm workspaces sem Turborepo;
- Next.js 16 com App Router, TypeScript strict e Tailwind CSS;
- Prisma 7 com SQLite local, models, migration inicial e repositories;
- SDK OpenAI 7.4 com Responses API isolada no adapter concreto;
- Knowledge Loader determinístico com origem filesystem abstraída por `KnowledgeSource`;
- Prompt Builder determinístico com AST imutável e renderização final em dois canais;
- Agent Runner genérico integrando Prompt Builder e AI Provider sem regras de agente ou workflow;
- Response Validator genérico para classificação funcional determinística de `AgentRunResult`;
- Artifact Generator genérico para produzir drafts determinísticos a partir de saídas validadas e specifications declarativas;
- Product Owner Agent como fachada concreta de uma única tentativa sobre os componentes genéricos já existentes;
- Developer Agent como segunda fachada concreta, responsável somente por proposta técnica declarativa e rastreável;
- ESLint, Prettier, Husky e lint-staged;
- Vitest para testes unitários e smoke;
- CI limitada a lint, typecheck, testes, Prisma validate e build;
- Git local sem remote configurado.

## Baselines transversais

- arquivos `.env` ignorados, mantendo somente `.env.example`;
- validação server-side de `DATABASE_URL`;
- erro seguro sem exposição de detalhes internos;
- logger JSON mínimo com redação de campos sensíveis;
- nenhuma variável secreta exposta ao frontend.
- configuração OpenAI validada de forma lazy e exclusivamente server-side.

## Shared Layer

- `shared` registrado como workspace interno `@brq/shared`;
- estados canônicos de `Project`, `Execution` e `AgentExecution`;
- schemas Zod e tipos inferidos para domínio, contratos base de agentes e artefatos;
- `ArtifactDraft` separado do `Artifact` enriquecido pela plataforma;
- nomes de arquivo validados sem caminhos absolutos, `../` ou separadores;
- coerência mínima entre status e datas de início/fim;
- retries automáticos criam nova `AgentExecution` na mesma `Execution`;
- `FAILED → RUNNING` reservado à retomada explícita;
- `REQUIRES_REVIEW → RUNNING` reservado a futura resolução humana auditável;
- códigos de erro compartilhados integrados ao baseline existente;
- `TokenUsage` e contratos JSON transversais disponíveis para componentes de `core`.

## Persistence Layer

- `prisma` registrado como workspace interno `@brq/prisma`;
- modelos Project, Execution, AgentExecution, Artifact, PromptVersion e Log;
- migration `20260805013404_init_persistence`;
- ports de repositories em `shared` e implementações concretas em `prisma`;
- estados persistidos como strings e validados pelos schemas canônicos;
- snapshots JSON de input, output, provenance e contexto de logs;
- tokens e duração persistidos em colunas escalares;
- Artifact imutável, versionado por Execution e filename;
- PromptVersion imutável, exceto por status, com hash SHA-256;
- relações históricas com delete `Restrict` e correlações opcionais de Log com `SetNull`;
- logs append-only com IDs de correlação;
- nenhum seed ou hard delete no MVP;
- testes de integração aplicam migrations em bancos SQLite temporários isolados.

## AI Provider Layer

- `core/ai-provider` registrado como workspace interno `@brq/ai-provider`;
- interface e contratos abstratos independentes de SDK e endpoint;
- OpenAIProvider como adapter inicial da Responses API, com `store: false`, endpoint oficial fixo e logging interno do SDK desligado;
- FakeAIProvider determinístico para sucesso e cenários negativos;
- timeout padrão de 60 segundos, cancelamento com `AbortSignal` e limites validados;
- SDK configurado sem retries internos;
- retry técnico somente para falha de conexão sem resposta HTTP válida;
- respostas HTTP, recusas, JSON malformado e incompatibilidade de schema nunca geram retry técnico;
- logs contêm somente metadados técnicos sanitizados;
- teste real opcional separado e desabilitado por padrão.

## Knowledge Loader Layer

- `core/knowledge-loader` registrado como workspace interno `@brq/knowledge-loader`;
- `KnowledgeSource` desacopla consumidores da origem física, com filesystem como adapter inicial;
- manifesto JSON declarativo, versionado e validado por Zod;
- IDs documentais explícitos, estáveis e independentes de filenames;
- índice imutável por instância com hashes SHA-256 e sem cache de conteúdo;
- seleção determinística e versionada para contextos canônicos;
- manifesto e política `1.7.0`, incluindo o fluxo do Developer e o ADR-020;
- contexto `DEVELOPER` com seis documentos obrigatórios que cabem no orçamento padrão de 64 KiB e documentos adicionais opcionais em ordem determinística;
- orçamento de documentos e bytes configurável por instância, sem truncamento silencioso;
- composição estruturada com delimitadores, ID, categoria e hash por documento;
- verificação de hash entre indexação e leitura dos documentos selecionados;
- proteção contra traversal, caminhos absolutos, symlinks, arquivos não regulares e UTF-8 inválido;
- logs limitados a metadados técnicos, sem conteúdo documental ou caminhos absolutos;
- nenhuma IA, embeddings, RAG, busca semântica, resumo, persistência ou montagem de prompt.

## Prompt Builder Layer

- `core/prompt-builder` registrado como workspace interno `@brq/prompt-builder`;
- transformação pura e determinística, sem I/O de domínio, filesystem, persistência ou chamadas externas; logger estruturado injetável como única saída lateral;
- hierarquia conceitual `PromptDocument → PromptSection → PromptBlock → PromptFragment`, representada por `PromptTemplate` e `ResolvedPromptDocument`;
- seções separadas pelos canais semânticos `INSTRUCTIONS` e `INPUT`;
- templates com slots tipados validados e resolução em uma única passagem;
- contexto, constraints, variáveis e output contracts recebidos como estruturas prontas;
- orçamento padrão de 128 KiB, configurável por instância em bytes UTF-8, com preflight de limite inferior e medição final exata, sem resumo, truncamento ou omissão silenciosa;
- limite estrutural separado para referências de proveniência, configurável por instância e aplicado antes do clone por schema;
- hashes SHA-256 canônicos `templateHash`, `instructionsHash`, `inputHash`, `outputContractHash` e `promptHash`;
- proveniência canônica de rule sets e contextos preservada em `ResolvedPromptDocument.sources` e nos metadados, sem alterar o `promptHash` do payload efetivo;
- hashes de seções preservados nos metadados do `PromptResult`;
- comparação estrutural determinística de seções adicionadas, removidas, alteradas ou reordenadas, com paths imutáveis e sem avaliação semântica por IA;
- logs limitados a identidade e versão do prompt, hashes finais, quantidades de seções e contextos, orçamento, duração, correlação e códigos de erro;
- na Sprint 5, Prompt Manifest, assets e consumers foram adiados; as Sprints 9 e 10 adicionaram bundles estáticos de Product Owner e Developer, enquanto loader genérico, selector, registry e seleção dinâmica continuam adiados.

## Agent Runner Layer

- `core/agent-runner` registrado como workspace interno `@brq/agent-runner`;
- executor genérico de um único agente, sem conhecer agentes concretos, workflow, Orchestrator ou persistência;
- `PromptRequest` próprio e mínimo, mapeado internamente para o Prompt Builder sem expor `PromptBuildInput` no contrato público;
- integração por interfaces abstratas `PromptBuilder` e `AIProvider`, sem dependência de OpenAI ou Responses API;
- `ResponseEnvelope` interno entre a resposta do provider e o resultado público, preparado para futura validação funcional sem expor detalhes internos;
- métricas observadas pelo Runner separadas das métricas reportadas pelo Provider;
- hashes SHA-256 determinísticos do prompt e da resposta normalizada, além de contagem de bytes UTF-8 nas fronteiras abstratas;
- cancelamento propagado por `AbortSignal` e timeout apenas encaminhado ao Provider, sem temporizador próprio;
- exatamente uma chamada ao Provider por execução, sem retry, persistência, mutação de estados ou geração de artefatos;
- logs técnicos com allowlist estrita de IDs, hashes, durações, métricas, provider, modelo, estágio e código de erro, sem conteúdo sensível;
- contratos validados nas fronteiras e resultados profundamente imutáveis.

## Response Validator Layer

- `core/response-validator` registrado como workspace interno `@brq/response-validator`;
- `ValidationRequest` combina um `AgentRunResult` não confiável com um `ValidationContract` declarativo e versionado;
- `ValidationPipeline` linear para coerência de contrato, finish reason, conteúdo, formato, JSON Schema e structured output;
- `ValidationReport` permanece interno e é projetado como `ValidationResult` público profundamente imutável;
- `COMPLETED` é o único finish reason que permite validar conteúdo; truncamento, content filter e refusal são classificados sem retry;
- `output.content` é reinterpretado para `JSON_SCHEMA` Draft 2020-12 com Ajv 8 estrito, e `structuredData` nunca é aceito isoladamente;
- issues possuem códigos, categorias e severidades estáveis; `INFO` permanece reservado e a produção emite somente `ERROR` e `WARNING` nesta Sprint;
- limites configuráveis e centralizados protegem bytes de conteúdo e schema, nesting e quantidade de issues;
- hashes SHA-256 distinguem resposta, conteúdo, contrato, schema, valor validado e decisão final;
- logs registram apenas metadados, hashes, duração, quantidade e códigos de issues e indicador de truncamento, sem conteúdo, structured data ou schemas completos;
- nenhuma chamada de IA, correção automática, retry, artifact, persistência, estado, regra específica de agente ou workflow.

## Artifact Generator Layer

- `core/artifact-generator` registrado como workspace interno `@brq/artifact-generator`;
- `ArtifactGenerationRequest` combina exclusivamente um `ValidationResult` aceito com uma `ArtifactSpecification` declarativa e pronta;
- pipeline determinística `Binding Resolution → ResolvedArtifactModel interno → Rendering → ArtifactDraft`;
- templates e bindings locais por ID são genéricos, sem seleção ou regras específicas de Product Owner, Developer e QA;
- o valor validado é preservado como dado não confiável e nunca é executado, corrigido ou reinterpretado como template;
- `metadata.source` preserva correlação, metadados técnicos, vínculo contratual, `validationHash` e `validatedValueHash`, recalculado antes da geração;
- hashes estruturais de specification, template, draft e geração permanecem distintos de `contentHash` e do `validatedValueHash` de origem;
- configuração por instância usa defaults de 16 artifacts, 256 fragments, 64 bindings, path depth 32, specification 256 KiB, artifact 1 MiB, total 4 MiB e nesting 100;
- templates `TEXT` suportam literal e bindings com serialização explícita, contagem incremental de bytes e cache de serializações repetidas antes do `join`; templates `JSON` usam valor raiz e rendering canônico indentado com newline final;
- resultados e drafts são profundamente imutáveis e preservam ordem, metadados técnicos e rastreabilidade;
- `ResolvedArtifactModel`, Resolver, Renderer e hashing interno não são expostos por entrypoint nem por alias TypeScript wildcard;
- erros canônicos preservam IDs de execução/correlação depois da validação de fronteira e medem duração até o catch;
- logs contêm somente IDs, hashes, contagens, bytes, duração, estágio e código de erro, sem conteúdo ou specification completa;
- nenhuma IA, filesystem, persistência, versionamento, retry, estado, agente concreto ou workflow.

## Product Owner Agent Layer

- `agents/product-owner` registrado como workspace interno e primeira fachada concreta de agente;
- a factory valida dependências e o bundle de assets uma vez antes de aceitar requests; `ASSET_LOADING` não integra os estágios da tentativa;
- cada invocação encadeia `Knowledge Loader → Agent Runner → Response Validator → Business Validation → Artifact Generator` sem coordenar outros agentes;
- demanda, specification, readiness e resultado possuem contratos e schemas versionados e imutáveis;
- assets declarativos versionados em `prompts/product-owner/1.0.0`, com manifesto referenciando filenames, IDs e versões, loader calculando os hashes do template, rule sets, output contract, Validation Contract derivado, artifact specification e bundle, e `bundleHash` esperado fixado para impedir alteração silenciosa do release;
- o JSON Schema inicial evita `$schema` e `uniqueItems` para a compatibilidade alvo com Structured Outputs de modelos-base; modelos fine-tuned exigem verificação explícita e permanecem um risco conhecido;
- IDs dos assets e itens de domínio são explícitos e estáveis, independentemente dos filenames;
- Business Validation específica do domínio recalcula readiness e verifica completude, unicidade e referências cruzadas sem corrigir a resposta; o relatório expõe no máximo 100 issues e informa `issuesTruncated`;
- `READY`, `PARTIALLY_READY` e `REQUIRES_CLARIFICATION` distinguem specification pronta, pendências não bloqueantes e dúvidas bloqueantes;
- somente as validações estrutural e de negócio aceitas permitem ao Artifact Generator receber o `ValidationResult` e a `ArtifactSpecification` e gerar exatamente `story.md`, `acceptance.md` e `backlog.json`;
- canonicalização e hashing reutilizam APIs públicas existentes; não existe implementação paralela no agente;
- logs preservam apenas IDs, versões, hashes, contagens, tempos e códigos técnicos, sem demanda, contexto, prompt, resposta ou artifacts;
- nenhuma persistência, retry, transição de estado, Orchestrator, Developer Agent ou QA Agent integra esta Sprint.

## Developer Agent Layer

- `agents/developer` é a segunda fachada concreta e representa uma única tentativa;
- o request recebe contexto de execução, uma `ProductOwnerSpecification` válida pelo entrypoint público do Product Owner, modelo e limites opcionais;
- a tentativa encadeia `Knowledge Loader → Agent Runner → Response Validator → Developer Business Validation → Artifact Generator`;
- a saída funcional é uma `TechnicalSpecification` estrita com arquitetura, complexidade, story points, fases, plano, dependências internas e externas, riscos, decisões e rastreabilidade;
- a Business Validation preserva IDs funcionais, rejeita referências inválidas, duplicidades e ciclos, deriva readiness e exige cobertura integral dos Acceptance Criteria da origem;
- metadados preservam o hash canônico e a readiness da `ProductOwnerSpecification` recebida;
- os assets versionados ficam em `prompts/developer/1.0.0` e geram exatamente `architecture.md`, `implementation-plan.md` e `technical-decisions.json` em memória;
- o agente atua como arquiteto e não gera código ou testes, não executa comandos, não grava arquivos, não persiste, não altera estados, não retenta e não coordena Product Owner, QA ou Orchestrator.

## Decisões

- ADR-011 registra layout, npm workspaces, Agent Runner genérico, fronteiras de dependência e SQLite local;
- ADR-012 registra ports compartilhados, adapter Prisma, mapeamento físico, versionamento e política de delete;
- ADR-013 registra a fronteira do AI Provider, a separação entre retries técnicos e funcionais e a política de segurança;
- ADR-014 registra a fronteira do Knowledge Loader, manifesto declarativo, índice imutável, seleção determinística, orçamento e segurança do filesystem;
- ADR-015 registra a fronteira do Prompt Builder, AST imutável, canais semânticos, renderização determinística, orçamento, hashes e comparação estrutural;
- ADR-016 registra a fronteira do Agent Runner, suas integrações, a separação de métricas e a ausência de retry, persistência e regras de workflow;
- ADR-017 registra a fronteira do Response Validator, a pipeline determinística, o report interno, a classificação funcional e a ausência de retry ou semântica específica de agente;
- ADR-018 registra a fronteira do Artifact Generator, a specification declarativa, o modelo resolvido interno, a separação dos hashes e a ausência de filesystem, persistência e versionamento;
- ADR-019 registra a fronteira do Product Owner Agent, a composição dos componentes genéricos, a Business Validation específica e a ausência de workflow, retry e persistência;
- ADR-020 registra o handoff contratual para o Developer Agent, sua Business Validation, os três drafts técnicos e a ausência de geração de código, testes e workflow;
- build de produção utiliza Webpack porque o Turbopack tentou abrir uma porta interna não permitida no ambiente de execução;
- desenvolvimento local permanece com o padrão Turbopack do Next.js.

## Validações da Sprint 0

- lint: aprovado;
- typecheck: aprovado;
- testes: 6 aprovados, sendo 5 unitários e 1 smoke;
- Prisma validate: aprovado;
- build: aprovado;
- smoke local: `GET /` respondeu HTTP 200;
- npm audit: zero vulnerabilidades.

## Validações da Sprint 1

- lint: aprovado;
- typecheck: aprovado;
- testes: 40 aprovados, sendo 39 da Shared Layer e 1 smoke da aplicação;
- Prisma validate: aprovado;
- build: aprovado;
- format check: aprovado.

## Validações da Sprint 2

- lint: aprovado;
- typecheck: aprovado;
- testes: 67 aprovados, sendo 45 unitários/contrato, 21 de integração e 1 smoke da aplicação;
- cobertura Shared/Persistence: 90,67% statements, 78,61% branches, 93,75% functions e 91,26% lines;
- Prisma validate: aprovado;
- migration deploy: aprovado;
- build: aprovado;
- format check dos arquivos da Sprint: aprovado;
- format check global: aprovado após validação da newline final de `.ai/DEVELOPMENT_WORKFLOW.md`.

## Validações da Sprint 3

- lint: aprovado;
- typecheck: aprovado;
- testes: 124 aprovados, sendo 57 da Sprint 3, 66 anteriores de Shared/Persistence e 1 smoke da aplicação;
- cobertura de `core/ai-provider`: 90,30% statements, 86,25% branches, 89,47% functions e 90,30% lines;
- Prisma validate: aprovado;
- build: aprovado;
- format check: aprovado;
- teste live: separado, desabilitado por padrão e sem chamada externa durante a validação;
- npm audit: zero vulnerabilidades.

## Validações da Sprint 4

- format check: aprovado;
- lint: aprovado;
- typecheck: aprovado;
- testes: 220 aprovados, sendo 96 do Knowledge Loader, 123 anteriores de Shared/Persistence/AI Provider e 1 smoke da aplicação;
- cobertura de `core/knowledge-loader`: 92,33% statements, 82,68% branches, 97,87% functions e 92,22% lines;
- cobertura global da suíte raiz: 91,81% statements, 82,79% branches, 96,05% functions e 91,84% lines;
- Prisma validate: aprovado;
- build: aprovado;
- smoke local do adapter filesystem: 41 documentos indexados, nenhum ausente e os 6 contextos canônicos carregados;
- nenhuma chamada externa ou teste live executado.

## Validações da Sprint 5

- format check: aprovado;
- lint: aprovado;
- typecheck: aprovado;
- testes: 297 aprovados, sendo 77 do Prompt Builder, 219 anteriores da suíte raiz e 1 smoke da aplicação;
- cobertura de `core/prompt-builder`: 92,15% statements, 84,84% branches, 97,95% functions e 91,96% lines;
- cobertura global da suíte raiz: 91,95% statements, 83,59% branches, 96,80% functions e 91,90% lines;
- Prisma validate: aprovado;
- build: aprovado;
- nenhuma chamada externa ou teste live executado.

## Validações da Sprint 6

- format check: aprovado;
- lint: aprovado;
- typecheck: aprovado;
- testes: 328 aprovados, sendo 31 do Agent Runner, 296 anteriores da suíte raiz e 1 smoke da aplicação;
- cobertura de `core/agent-runner`: 95,83% statements, 86,25% branches, 97,14% functions e 96,20% lines;
- cobertura global da suíte raiz: 92,38% statements, 84,03% branches, 96,88% functions e 92,35% lines;
- Prisma validate: aprovado;
- build: aprovado;
- nenhuma chamada externa ou teste live executado.

## Validações da Sprint 7

- format e format check: aprovados;
- lint: aprovado;
- typecheck: aprovado;
- testes: 371 aprovados, sendo 43 do Response Validator, 327 anteriores da suíte raiz e 1 smoke da aplicação;
- cobertura de `core/response-validator`: 97,38% statements, 91,72% branches, 100% functions e 97,24% lines;
- cobertura global da suíte raiz: 93,04% statements, 85,09% branches, 97,33% functions e 92,99% lines;
- Prisma validate: aprovado;
- build: aprovado;
- nenhuma chamada externa, retry ou teste live executado.

## Validações da Sprint 8

- format e format check: aprovados;
- lint: aprovado;
- typecheck: aprovado;
- testes: 443 aprovados, sendo 72 do Artifact Generator, 370 anteriores da suíte raiz e 1 smoke da aplicação;
- cobertura de `core/artifact-generator`: 95,15% statements, 82,55% branches, 100% functions e 96,72% lines;
- cobertura global da suíte raiz: 93,52% statements, 84,96% branches, 98,01% functions e 93,66% lines;
- Prisma validate: aprovado;
- build: aprovado;
- teste de contrato Validator → Generator aprovado usando exclusivamente APIs públicas;
- nenhuma chamada externa, persistência, filesystem, retry ou item da Sprint 9 executado.

## Validações da Sprint 9

- format e format check: aprovados;
- lint: aprovado;
- typecheck: aprovado;
- testes: 507 aprovados, sendo 64 do Product Owner Agent, 442 anteriores da suíte raiz e 1 smoke da aplicação;
- cobertura de `agents/product-owner`: 93,82% statements, 82,15% branches, 100% functions e 94,60% lines;
- cobertura global da suíte raiz: 93,75% statements, 85,10% branches, 98,63% functions e 93,93% lines;
- Prisma validate: aprovado;
- build: aprovado;
- `git diff --check`: aprovado;
- nenhuma chamada externa, teste live, persistência, retry ou transição de estado executada;
- naquele baseline, nenhum item da Sprint 10 havia sido iniciado.

## Validações da Sprint 10

- format e format check: aprovados;
- lint: aprovado;
- typecheck: aprovado;
- testes: 581 aprovados, sendo 73 do Developer Agent, 1 nova integração de orçamento do Knowledge Loader, 506 previamente existentes na suíte raiz e 1 smoke da aplicação;
- cobertura de `agents/developer`: 92,98% statements, 80,21% branches, 98,70% functions e 93,46% lines;
- cobertura global da suíte raiz: 93,60% statements, 84,40% branches, 98,65% functions e 93,84% lines;
- Prisma validate: aprovado;
- build: aprovado;
- `git diff --check`: aprovado;
- nenhuma chamada externa, teste live, persistência, retry funcional ou transição de estado executada;
- nenhum item da Sprint 11 foi iniciado e nenhum commit foi criado.

## Fora do escopo confirmado

- testes E2E;
- QA Agent;
- geração ou execução de código e testes pelo Developer Agent;
- registry dinâmico, seleção de versão ativa e descoberta de assets de prompt;
- retry funcional e workflow entre agentes;
- Orchestrator e Execution Engine;
- autenticação e autorização;
- métricas avançadas;
- deploy e configuração de Vercel.
