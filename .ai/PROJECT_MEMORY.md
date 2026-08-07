# Project Memory

## Estado atual

Sprint 18 — Asynchronous Execution Queue implementada e validada localmente com Node.js 24.19.0.
A Sprint não possui commit. O bug conhecido de Structured Outputs do Developer Agent permanece
como hotfix separado e não foi alterado. Nenhum item da Sprint 19 foi iniciado.

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
- QA Agent como terceira fachada concreta, responsável somente por especificação de qualidade declarativa e rastreável;
- Orchestrator como coordenador central do workflow fixo Product Owner → Developer → QA, sem Execution Engine, retry ou persistência;
- Execution Engine como única fronteira de produção do Orchestrator, com identidade determinística e ciclo local sem persistência ou retry;
- HTTP API como adapter Next.js sobre o Execution Dispatcher e os read models do Execution
  Repository, com composition root lazy no host;
- Frontend MVP como Presentation Adapter HTTP-only sobre a API pública;
- Observability como decorator best-effort da API pública do Execution Engine, com reducer síncrono
  em memória e projeção durável pelo Execution Repository;
- Execution Repository como agregado persistente separado, com port assíncrono, adapters em
  memória e Prisma e read models minimizados;
- Job Queue como port substituível e adapter FIFO local em memória, sem retry, requeue ou
  concorrência;
- Execution Worker como único consumidor sequencial, dependente apenas das APIs públicas da fila,
  do Engine e do Execution Repository;
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
- manifesto e política permanecem em `1.12.0`, com os documentos de runtime até o fluxo 39 e o
  ADR-025; o fluxo 40 e o ADR-026 não são injetados nos contextos dos agentes nesta Sprint para
  preservar integralmente seus bytes, hashes e prompts;
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
- o release histórico `prompts/product-owner/1.0.0` permanece imutável; o loader seleciona
  estaticamente `prompts/product-owner/1.0.1`, com manifesto, hashes canônicos e `bundleHash` fixado;
- o bundle `1.0.1` explicita que `backlogItems[].dependencyIds` referencia somente IDs existentes em
  `dependencies[].id`, alinhando as instruções à invariante já aplicada sem alterar o JSON Schema ou
  a Product Owner Business Validation;
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
- os releases históricos `prompts/developer/1.0.0` e `1.0.1` permanecem imutáveis; o loader seleciona
  estaticamente `prompts/developer/1.0.2`, que gera exatamente `architecture.md`,
  `implementation-plan.md` e `technical-decisions.json` em memória;
- o agente atua como arquiteto e não gera código ou testes, não executa comandos, não grava arquivos, não persiste, não altera estados, não retenta e não coordena Product Owner, QA ou Orchestrator.

## QA Agent Layer

- `agents/qa` é a terceira fachada concreta e representa uma única tentativa;
- o request recebe contexto de execução, uma `ProductOwnerSpecification`, uma `TechnicalSpecification`, modelo e limites opcionais;
- a validação de origem confirma deterministicamente a compatibilidade da especificação técnica com a especificação funcional antes de carregar conhecimento ou chamar o provider;
- a tentativa encadeia `Source Validation → Knowledge Loader → Agent Runner → Response Validator → QA Business Validation → Artifact Generator`;
- o prompt recebe exatamente três contextos prontos: conhecimento de QA, specification funcional e specification técnica;
- a saída funcional é uma `QASpecification` estrita com estratégia, matriz de rastreabilidade, cenários positivos e negativos, edge cases, riscos, coberturas funcional e técnica, critérios de aprovação, bloqueios, prioridades, recomendações futuras e readiness;
- a Business Validation rejeita duplicidades e referências inválidas, recalcula totais e readiness e exige cobertura integral de Acceptance Criteria, regras de negócio, decisões técnicas e Definition of Done;
- os hashes canônicos das duas specifications de origem são preservados separadamente nos metadados do resultado;
- os assets versionados ficam em `prompts/qa/1.0.0`, possuem `bundleHash` fixado e geram exatamente `test-plan.md`, `traceability-matrix.json` e `qa-specification.md` em memória;
- os logs usam allowlist de IDs, versões, hashes, contagens, duração, estágio e códigos técnicos, sem specifications, prompts, respostas ou artifacts;
- o agente não executa testes, não gera código ou testes, não grava arquivos, não persiste, não altera estados, não retenta e não conhece Orchestrator ou Execution Engine.

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
- ADR-021 registra o handoff contratual para o QA Agent, a validação determinística das duas origens, a cobertura funcional e técnica, os três drafts de qualidade e a ausência de execução, geração de código, workflow e persistência;
- ADR-022 registra a fronteira do Orchestrator, o workflow sequencial, timeline observacional, lineage e provenance separados, hashes determinísticos e ausência de retry, persistência e Execution Engine;
- ADR-023 registra a fronteira do Execution Engine, identidade determinística, ciclo efêmero, metadados versionados e integração exclusiva com o Orchestrator público;
- ADR-024 registra a API como adapter HTTP, os três endpoints, o composition root no host, os controles de transporte e a ausência de persistência e regras de negócio;
- ADR-025 registra o Frontend como Presentation Adapter HTTP-only, a projeção exclusiva para
  `ExecutionSummary`, os quatro estados locais e a limitação temporária da configuração técnica no
  browser;
- ADR-026 registra a fronteira de Execution History & Observability, o decorator do Engine, a bridge
  allowlisted de logs, o store bounded em memória, o endpoint de timeline e a exclusão integral de
  conteúdo sensível;
- ADR-027 registra o agregado `ExecutionRecord` separado, o refinamento limitado do ADR-012, a
  composição persistente externa ao Engine, o modelo Prisma normalizado e as consultas duráveis;
- ADR-028 registra a fila FIFO local e substituível, o Worker sequencial, a reserva de identidade
  pelo Engine, a metadata normalizada do job, o contrato HTTP assíncrono e a ausência de retry;
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

## Validações da Sprint 11

- format e format check: aprovados;
- lint: aprovado;
- typecheck: aprovado;
- assets do QA Agent validados com `bundleHash` `c674db967cd7af9c8e2471fc1b546edbc5ea3133e0c846171e943bc48fdff693`;
- 56 testes específicos de `agents/qa` e 1 nova integração de orçamento do Knowledge Loader aprovados;
- 638 testes aprovados, sendo 637 da suíte raiz e 1 smoke da aplicação;
- cobertura de `agents/qa`: 91,52% statements, 81,50% branches, 97,24% functions e 91,80% lines;
- cobertura global da suíte raiz: 93,36% statements, 84,67% branches, 98,43% functions e 93,61% lines;
- Prisma validate: aprovado;
- build: aprovado;
- `git diff --check`: aprovado;
- nenhum ADR histórico entre ADR-001 e ADR-020 foi alterado; somente o ADR-021 foi criado;
- nenhuma chamada externa, teste live, persistência, retry funcional, transição de estado, execução de testes ou geração de código foi executada;
- nenhum item da Sprint 12 foi iniciado e nenhum commit foi criado.

## Implementação da Sprint 12

- workspace `@brq/orchestrator` criado em `core/orchestrator`, preservando o layout do ADR-011;
- workflow fixo Human Request → Product Owner → Developer → QA → `WorkflowResult`;
- fachadas injetadas e acessadas somente pelos entrypoints públicos;
- `WorkflowRequest`, `WorkflowResult`, estados, timeline, lineage, provenance, métricas, hashes e erros sanitizados validados por Zod;
- timeline monotônica e observacional, explicitamente excluída dos hashes;
- lineage de specifications separado da provenance técnica das execuções;
- mesmo `AbortSignal` propagado e checkpoints entre todas as etapas;
- rejeição funcional retorna `FAILED`; falhas técnicas e cancelamento propagam `OrchestratorError` com resultado parcial;
- sem geração de IDs, `Math.random`, `Date.now`, retry, persistência, revisão humana ou concorrência;
- manifesto e política de Knowledge atualizados para `1.9.0`, com fluxo 36 e ADR-022;
- nenhum arquivo de Product Owner, Developer ou QA foi alterado.

## Validações da Sprint 12

- format e format check: aprovados;
- lint: aprovado;
- typecheck raiz e aplicação: aprovado;
- 35 testes específicos de `core/orchestrator` aprovados;
- 673 testes aprovados, sendo 672 da suíte raiz e 1 smoke da aplicação;
- cobertura de `core/orchestrator`: 93,31% statements, 86,83% branches, 98,24% functions e 95,25% lines;
- cobertura global da suíte raiz: 93,33% statements, 84,68% branches, 98,42% functions e 93,70% lines;
- Prisma validate: aprovado;
- build de produção Next.js: aprovado com backend Webpack; o Turbopack não pôde abrir sua porta interna no sandbox de validação;
- `git diff --check`: aprovado;
- nenhum ADR histórico entre ADR-001 e ADR-021 foi alterado; somente o ADR-022 foi criado;
- nenhuma chamada externa, teste live, persistência funcional, retry, revisão humana, execução de testes de QA ou geração de código foi executada;
- nenhum item da Sprint 13 foi iniciado e nenhum commit foi criado.

## Implementação da Sprint 13

- workspace `@brq/execution-engine` criado em `core/execution-engine`, preservando o ADR-011;
- dependência funcional exclusiva do entrypoint público `@brq/orchestrator`;
- `ExecutionRequest` não aceita `executionId` do caller;
- `executionId` criado deterministicamente a partir do request hash e `contractVersion`;
- máquina local `CREATED → RUNNING → SUCCESS | FAILED | CANCELLED`, sem retomada;
- uma tentativa e no máximo uma chamada ao Orchestrator;
- mesmo `AbortSignal` propagado e cancelamento prévio sem invocação do workflow;
- `ExecutionResult` com `startedAt`, `finishedAt`, timeline, metadata, métricas, hashes, lineage e provenance separados;
- `engineVersion` e `contractVersion` explícitos;
- timestamps, timeline, durações e métricas excluídos dos hashes;
- erros e logs sanitizados por allowlist;
- manifesto e política de Knowledge atualizados para `1.10.0`, com fluxo 37 e ADR-023;
- nenhum código funcional de componentes anteriores foi alterado.

## Validações da Sprint 13

- format e format check: aprovados;
- lint: aprovado sem warnings;
- typecheck raiz e aplicação: aprovado;
- 30 testes específicos de `core/execution-engine` aprovados;
- 703 testes aprovados, sendo 702 da suíte raiz e 1 smoke da aplicação;
- cobertura de `core/execution-engine`: 98,42% statements, 94,94% branches, 96,55% functions e 100% lines;
- cobertura global da suíte raiz: 93,54% statements, 85,39% branches, 98,37% functions e 93,95% lines;
- Prisma validate: aprovado;
- build de produção Next.js com Webpack: aprovado;
- `git diff --check`: aprovado;
- nenhum ADR histórico entre ADR-001 e ADR-022 foi alterado; somente ADR-023 foi criado;
- nenhum item da Sprint 14 foi iniciado e nenhum commit foi criado.

## Implementação da Sprint 14

- Next.js 16 Route Handlers em `apps/web/src/app/api/` para health, criação e lookup contratual;
- `GET /api/health` independente do runtime, de IA e de banco;
- `POST /api/executions` síncrono e dependente somente da API pública do Execution Engine;
- `GET /api/executions/[id]` com validação de ID e resposta 501 sem store oculto;
- contratos HTTP Zod estritos, `requestId` server-side e respostas padronizadas;
- limite de 512 KiB aplicado ao header e ao stream, JSON UTF-8 e encoding identity;
- propagação do mesmo `AbortSignal` e transporte integral de hashes, métricas, lineage e provenance;
- headers mínimos de segurança, métodos inválidos uniformes e logs allowlisted;
- composition root lazy exclusivamente em `apps/web/src/server/runtime.ts`;
- nenhum workspace `core/ai-factory-runtime` criado;
- manifesto e política de Knowledge atualizados para `1.11.0`, com fluxo 38 e ADR-024;
- nenhuma regra funcional ou componente anterior reescrito.

## Validações da Sprint 14

- format e format check: aprovados;
- lint: aprovado sem warnings;
- typecheck raiz e aplicação: aprovado;
- 27 testes específicos da API/runtime e 2 testes anteriores da aplicação aprovados;
- 731 testes aprovados no total, sendo 702 da suíte raiz e 29 da aplicação;
- cobertura global da suíte raiz: 93,56% statements, 85,52% branches, 98,37% functions e 93,98% lines;
- cobertura HTTP/runtime da aplicação: 97,63% statements, 90,65% branches, 90,90% functions e 98,76% lines;
- Prisma validate: aprovado;
- build de produção Next.js com Webpack: aprovado, com exatamente as rotas `/api/health`,
  `/api/executions` e `/api/executions/[id]`;
- `git diff --check`: aprovado;
- nenhum ADR histórico entre ADR-001 e ADR-023 foi alterado; somente ADR-024 foi criado;
- nenhuma dependência externa nova foi adicionada;
- nenhuma chamada externa, persistência, autenticação, autorização, execução assíncrona, retry,
  frontend funcional ou Playwright foi implementado;
- nenhum item da Sprint 15 foi iniciado e nenhum commit foi criado.

## Implementação da Sprint 15

- página inicial única com Project Name, Objective e execução explícita do workflow;
- consumo exclusivo de `POST /api/executions` por um client HTTP interno;
- Project Name projetado em `demand.title` e Objective em `demand.description`;
- `ExecutionResult` bruto restrito ao client e redução imediata para `ExecutionSummary`;
- React recebe somente executionId, status, duração, readiness, hashes e resumos de lineage e
  provenance;
- `idle`, `loading`, `success` e `error` controlados por estado local, sem store global;
- resultado funcional `FAILED` por HTTP 200 tratado como resultado resolvido;
- IDs e metadados dos agentes no browser são limitação temporária da API `1.0.0`; uma evolução
  futura do contrato deve mover essa responsabilidade para configuração confiável no backend;
- CSS existente, sem novas bibliotecas de UI, estado ou data fetching;
- nenhum HTML remoto, `dangerouslySetInnerHTML`, log ou storage de payloads;
- manifesto e política do Knowledge Loader `1.12.0`, fluxo 39 e ADR-025;
- nenhuma alteração em ADRs 001–024 e nenhum item da Sprint 16 iniciado.

## Validações da Sprint 15

- format e format check: aprovados;
- lint: aprovado sem warnings;
- typecheck raiz e aplicação: aprovado;
- 32 novos testes da aplicação adicionados;
- 763 testes aprovados no total, sendo 702 da suíte raiz e 61 da aplicação;
- cobertura global da suíte raiz: 93,54% statements, 85,35% branches, 98,37% functions e 93,95%
  lines;
- cobertura da aplicação: 96,94% statements, 88,94% branches, 93,33% functions e 98,57% lines;
- Prisma generate e Prisma validate: aprovados;
- build de produção Next.js com Webpack: aprovado, preservando a página estática e exatamente as
  rotas `/api/health`, `/api/executions` e `/api/executions/[id]`;
- `git diff --check`: aprovado;
- nenhum ADR histórico entre ADR-001 e ADR-024 foi alterado; somente ADR-025 foi criado;
- nenhuma dependência externa nova foi adicionada;
- nenhuma chamada externa, persistência, autenticação, autorização, polling, websocket, retry,
  Playwright ou item da Sprint 16 foi implementado;
- nenhum commit foi criado.

## Correção de integração do runtime da Sprint 15

- causa raiz confirmada: o composition root criava o Prompt Builder sem configuração e herdava o
  default de 128 KiB, insuficiente para o contexto real do Developer antes da chamada ao provider;
- `AI_FACTORY_PROMPT_BUILDER_MAX_BYTES` centraliza 512 KiB exclusivamente no host
  `apps/web/src/server/runtime.ts`;
- o default do Prompt Builder permanece em 128 KiB. O host da AI Factory configura explicitamente
  um orçamento maior para suportar o pipeline multiagente e os contratos funcionais reais;
- o valor de 512 KiB é metade do teto de 1 MiB já permitido pelos contratos de Product Owner,
  Developer e QA, sem alterar contratos, algoritmos, truncamento, hashing ou Knowledge Loader;
- medição com knowledge, assets e projeções reais: Product Owner com o bundle `1.0.1` em 100.523 B,
  Developer denso com o bundle `1.0.2` em 258.803 B e QA denso em 405.631 B;
- no Product Owner, a entrada válida no máximo contratual mede cerca de 166.613 B em ASCII,
  234.664 B com caracteres UTF-8 de 2 bytes e 302.714 B no extremo de 3 bytes;
- o cenário denso de QA inclui 64.933 B de knowledge, ProductOwnerSpecification de 114.931 B e
  TechnicalSpecification de 178.346 B, além de rules, template, output contract, delimitadores e
  overhead estrutural;
- 384 KiB falharia nesse cenário por 12.415 B; 512 KiB preserva 118.657 B de margem, ou 22,63%;
- a regressão usa Prompt Builder, assets e contexts reais e um `FakeAIProvider`; nenhuma chamada
  real à OpenAI faz parte dos testes;
- payload abaixo do limite é renderizado integralmente e payload artificial acima do limite ainda
  falha com `PROMPT_BUILDER_BUDGET_EXCEEDED`, sem truncamento silencioso;
- 4 testes de regressão adicionados; 767 testes aprovados no total, sendo 702 da suíte raiz e 65
  da aplicação;
- cobertura da suíte raiz: 93,52% statements, 85,22% branches, 98,37% functions e 93,93% lines;
- cobertura da aplicação: 97,29% statements, 89,42% branches, 95% functions e 98,93% lines, com
  `runtime.ts` em 100% de statements, functions e lines;
- format, format check, lint, typecheck, Prisma validate e build de produção aprovados com Node.js
  24.19.0; a suíte live do provider permaneceu excluída;
- nenhum comportamento funcional dos agentes foi alterado e nenhum item da Sprint 16 foi iniciado.

## Alinhamento dos assets do Developer Agent

- causa raiz confirmada: o bundle `1.0.0` descrevia a estrutura da `TechnicalSpecification`, mas não
  explicitava todas as invariantes relacionais já aplicadas pela Developer Business Validation;
- o conteúdo canônico dos sete assets do release histórico `prompts/developer/1.0.0` permanece
  intacto, conforme ADR-009 e ADR-020;
- o bundle patch histórico `1.0.1` permanece preservado com o `bundleHash`
  `850dcbbd24154c4f0a4d921a05abae4de2a7a167203a5540d08abf689ed1284f`;
- regras confiáveis e instruções do Output Contract usam `IF`, `THEN`, `MUST` e `MUST NOT` para
  ownership bidirecional Component/Module, ownership de flow steps e coerência de `dataModel`;
- `changesRequired=false` exige `entities=[]`, `relations=[]` e `migrationRequired=false`;
  `changesRequired=true` exige ao menos uma Entity e permite relations vazias;
- Entity e Relation não podem ser inventadas quando a especificação funcional não exige mudança de
  dados;
- o JSON Schema do Output Contract permanece igual ao `1.0.0`; invariantes cruzadas continuam sob
  autoridade exclusiva da Business Validation;
- o loader, os hashes fixos e os testes de drift foram atualizados sem criar registry, descoberta ou
  seleção dinâmica de versão;
- 15 testes de regressão foram adicionados: assets normativos e histórico, ownership bidirecional,
  flow ownership, referências de Relations e combinações válidas e inválidas de `dataModel`;
- 782 testes foram aprovados no total, sendo 717 da suíte raiz e 65 da aplicação;
- cobertura da suíte raiz: 93,63% statements, 85,45% branches, 98,56% functions e 94,04% lines;
- cobertura da aplicação: 97,29% statements, 89,42% branches, 95% functions e 98,93% lines;
- format, format check, lint, typecheck, Prisma validate e build de produção foram aprovados com
  Node.js 24.19.0; a suíte live do provider permaneceu excluída;
- Developer Business Validation, Response Validator, schemas públicos e Orchestrator não foram
  alterados;
- nenhuma chamada real à OpenAI integra a correção e nenhum item da Sprint 16 foi iniciado.

## Paridade estrutural dos assets do Developer Agent

- causa raiz confirmada: o Response Validator aceitava o JSON Schema `1.0.1`, mas o parse posterior
  pelo schema Zod público podia rejeitar a mesma `TechnicalSpecification` com
  `DEVELOPER_INVALID_SPECIFICATION_STRUCTURE`;
- a auditoria recursiva de 235 nós confirmou equivalência de tipos, required, nullability, enums,
  arrays, IDs, referências e objetos estritos; as únicas divergências eram `modules[].path`, três
  campos `order` sem teto de safe integer e a semântica Unicode de `maxLength`;
- os releases `prompts/developer/1.0.0` e `1.0.1` permanecem imutáveis; o loader seleciona
  estaticamente `prompts/developer/1.0.2`;
- o JSON Schema ativo rejeita paths absolutos, prefixos de drive, backslashes, caracteres de
  controle, segmentos vazios, `.` e `..`, e fixa `9007199254740991` como maximum dos três `order`;
- normalização NFC não é representável pelo JSON Schema e `maxLength` Draft 2020-12 conta code
  points, enquanto Zod conta unidades UTF-16; ambas as limitações estão explícitas nas regras e
  permanecem sob validação autoritativa do Zod;
- o `bundleHash` ativo é
  `1ba2ab3886133cd4f7cac0bf5e3e01dbd3517083e9aa22f30ed57a2963195532`;
- o cenário Developer denso passou de 255.434 B para 258.803 B (`55.146 B` de instruções,
  `182.548 B` de input e `21.109 B` de Output Contract) e permanece dentro dos 512 KiB do host, sem
  truncamento e sem alteração do default global do Prompt Builder;
- a suíte dedicada adiciona 38 casos e usa Response Validator, assets, fixture e Zod reais, sem
  provider real; o incremento líquido da suíte raiz é de 39 testes, incluindo o drift da versão;
- 828 testes foram aprovados no total, sendo 763 da suíte raiz e 65 da aplicação;
- cobertura da suíte raiz: 93,61% statements, 85,26% branches, 98,56% functions e 94,02% lines;
- cobertura da aplicação: 97,29% statements, 89,42% branches, 95% functions e 98,93% lines;
- format, format check, lint, typecheck, Prisma validate e build de produção foram aprovados com
  Node.js 24.19.0;
- schemas públicos, Developer Business Validation, Response Validator e agentes posteriores não
  foram alterados;
- nenhuma chamada real à OpenAI integra a correção e nenhum item da Sprint 16 foi iniciado.

## Alinhamento dos assets do Product Owner Agent

- o conteúdo canônico do release histórico `prompts/product-owner/1.0.0` permanece preservado,
  conforme ADR-009 e ADR-019;
- o bundle patch `prompts/product-owner/1.0.1` passa a ser selecionado estaticamente;
- o bundle ativo fixa o `bundleHash`
  `32d7454be1bb61eb6dbe28bd582d943bed76c9fbd501d631e13e0bd69d4a8275`;
- as instruções confiáveis explicitam a invariante relacional
  `backlogItems[].dependencyIds → dependencies[].id`;
- a evolução não cria uma regra de negócio nova: o JSON Schema e a Product Owner Business
  Validation permanecem inalterados;
- não foram introduzidos registry, descoberta dinâmica ou seleção de versão por input externo.
- sete casos de regressão foram adicionados para referências válidas, vazias, múltiplas, inexistentes
  e duplicadas, preservação do release histórico, regra normativa, schema e hashes determinísticos;
- o workflow de integração do host confirma `prompt:product-owner@1.0.1`, orçamento de 100.523 B
  dentro dos 512 KiB configurados e uso exclusivo de `FakeAIProvider`;
- 789 testes foram aprovados no total, sendo 724 da suíte raiz e 65 da aplicação;
- cobertura da suíte raiz: 93,63% statements, 85,39% branches, 98,56% functions e 94,04% lines;
- cobertura da aplicação: 97,29% statements, 89,42% branches, 95% functions e 98,93% lines;
- format, format check, lint, typecheck, Prisma validate e build de produção foram aprovados com
  Node.js 24.19.0; nenhuma chamada real à OpenAI foi executada e nenhum item da Sprint 16 foi
  iniciado.

## Implementação da Sprint 16

- workspace `@brq/observability` criado em `core/observability`, dependente somente de
  `@brq/execution-engine`, `@brq/shared` e Zod;
- decorator do `ExecutionEngine` delega exatamente uma vez e preserva resultado, erro,
  cancelamento, hashes, lineage e provenance do Engine original;
- bridge de logger encaminha os logs existentes e captura apenas eventos e campos técnicos
  allowlisted; falhas da observabilidade são contidas e nunca alteram o workflow;
- eventos internos imutáveis cobrem `execution.started`, `execution.finished`, `execution.failed`,
  `stage.started`, `stage.finished` e `stage.failed`;
- timeline minimizada cobre o contexto inicial de Knowledge do Product Owner e as etapas Product
  Owner, Developer e QA, preservando sucesso, falha, cancelamento e etapas ignoradas;
- métricas por agente consolidam duração, prompt bytes, completion bytes, tokens, latência do
  provider, duração de validação e duração de geração de artifacts;
- `Execution Summary` preserva status, readiness final, duração, tokens, etapas executadas e
  ignoradas e os hashes públicos finais sem recalculá-los;
- `totalCostEstimate` permanece `null`, pois a Sprint não possui rate card aprovado e versionado;
- store em memória possui capacidade bounded centralizada, eviction determinística e snapshots
  profundamente imutáveis; não retém `ExecutionResult`, prompts, entrada, knowledge,
  specifications, respostas ou artifacts;
- registros ativos nunca são expulsos por capacidade; o host compartilha o singleton apenas dentro
  do mesmo processo Node.js;
- `GET /api/executions/[id]/timeline` consulta histórico terminal por `executionId` canônico e aceita
  `workflowId` somente como correlação ativa durante o POST síncrono;
- Frontend usa polling React puro pelo client HTTP interno, com uma consulta em andamento,
  `AbortSignal`, deadline degradável de cinco segundos e encerramento no resultado terminal ou
  unmount;
- restart, HMR e troca de instância não oferecem continuidade garantida; o histórico não representa
  persistência;
- ADR-026 e `knowledge/40-OBSERVABILITY_FLOW.md` documentam a fronteira e os cinco fluxos Mermaid;
- 878 testes foram aprovados no total, sendo 793 da suíte raiz e 85 da aplicação;
- cobertura da suíte raiz: 93,70% statements, 85,28% branches, 98,65% functions e 94,21% lines;
- cobertura da aplicação: 95,00% statements, 87,08% branches, 95,65% functions e 97,63% lines;
- cobertura de `core/observability`: 94,88% statements, 86,23% branches, 98,55% functions e
  96,83% lines;
- format, format check, lint, typecheck, testes, coverage, Prisma validate e build foram aprovados
  com Node.js 24.19.0; `git diff --check` deve permanecer limpo no handoff;
- implementação validada localmente e aguardando apenas aprovação humana;
- nenhuma chamada real à OpenAI foi executada, nenhum commit foi criado e nenhum item da Sprint 17
  foi iniciado.

## Implementação da Sprint 17

- workspace `@brq/execution-repository` criado em `core/execution-repository`, com port público,
  schemas Zod estritos, mappers, erros sanitizados, imutabilidade e logging allowlisted;
- adapters em memória e Prisma implementam o mesmo contrato assíncrono de lifecycle, observação,
  lookup e paginação;
- o aggregate `ExecutionRecord` é aditivo e separado do model `Execution` legado, que permanece
  intacto com seus repositories e contratos históricos;
- migration `20260807170000_execution_repository` cria tabelas normalizadas para registro, hashes,
  lifecycle, observação, timeline, métricas, lineage e provenance;
- o host compõe `concrete Engine → observed Engine → persistent coordinator`; o Engine concreto e
  o workspace de Observability da Sprint 16 não importam repository ou Prisma;
- o coordinator registra `CREATED`, `RUNNING` e o resultado terminal, delega exatamente uma vez e
  anexa o `executionId` somente quando a API pública do Engine o revela;
- observações intermediárias continuam fail-open; a consolidação terminal persiste resultado e
  snapshot normalizado sem reexecutar o workflow;
- `GET /api/executions` aceita paginação e filtros por status, readiness e intervalo de criação;
  `GET /api/executions/[id]` e o endpoint de timeline passam a consultar o repository;
- a API expõe somente read models minimizados e não importa Prisma, agentes ou internals do
  workflow;
- o Frontend adiciona as páginas `/executions` e `/executions/[id]`, cliente HTTP próprio e
  componentes isolados da experiência da Sprint 16;
- prompts, demanda detalhada, contexto adicional, knowledge, specifications, respostas, conteúdo
  de artifacts, segredos e objetos internos não integram o modelo persistido;
- ADR-027 e `knowledge/41-EXECUTION_REPOSITORY_FLOW.md` documentam Repository, Persistence Flow,
  Execution Lifecycle, API Query Flow e Prisma Model;
- SQLite permanece local e single-host; crash depois de `RUNNING` pode deixar registro stale e não
  há garantia exactly-once sem retry, outbox ou recovery, todos fora da Sprint;
- 936 testes foram aprovados no total, sendo 814 da suíte raiz e 122 da aplicação web;
- cobertura da suíte raiz: 93,56% statements, 85,11% branches, 98,67% functions e 94,13% lines;
- cobertura de `core/execution-repository`: 91,80% statements, 80,31% branches, 96,42% functions e
  93,16% lines;
- cobertura da aplicação web: 95,62% statements, 86,06% branches, 96,17% functions e 97,33% lines;
- format, format check, lint, typecheck, testes, coverage, Prisma validate, build e
  `git diff --check` foram aprovados com Node.js 24.19.0;
- a migration foi comparada com o schema sem drift e aplicada com sucesso ao SQLite local de
  desenvolvimento;
- nenhuma chamada real à OpenAI foi executada, nenhum commit foi criado e nenhum item da Sprint 18
  foi iniciado.

## Implementação da Sprint 18

- workspaces `@brq/job-queue` e `@brq/execution-worker` criados em `core/job-queue` e
  `core/execution-worker`, com contratos, schemas Zod, erros sanitizados, logging allowlisted e
  resultados profundamente imutáveis;
- `JobQueue` permanece um port substituível; o adapter `InMemoryJobQueue` implementa FIFO,
  cancelamento, shutdown, eventos, métricas e retenção privada do payload somente enquanto o job
  está ativo;
- máquina de estados fixa `QUEUED → RUNNING → SUCCESS | FAILED | CANCELLED`, além de
  `QUEUED → CANCELLED`, com `attempt: 1` e sem transição de retorno, retry, requeue, backoff ou
  scheduler;
- eventos imutáveis `job.created`, `job.started`, `job.finished`, `job.failed` e `job.cancelled`
  carregam apenas IDs, status, timestamps, duração e código sanitizado;
- o Execution Engine expõe `deriveExecutionIdentity(request)` como operação pública, pura e sem
  efeitos; `execute()` reutiliza o mesmo algoritmo e API, fila, Worker e Frontend não calculam
  `executionId`;
- o dispatcher deriva um `jobId` determinístico um-para-um, cria o registro durável `QUEUED` antes
  do enqueue e compensa uma recusa da fila persistindo `CANCELLED`;
- um único Execution Worker consome os jobs sequencialmente, chama apenas
  `ExecutionEngine.execute()` e nunca acessa agentes ou Orchestrator diretamente;
- cancelamento e shutdown usam `AbortController` próprio do Worker; o signal HTTP termina na
  aceitação e jobs terminais nunca são reenfileirados;
- `ExecutionRecordRepository` recebe operações de lifecycle e lookup de job; a migration
  `20260807180000_job_queue` adiciona a relação normalizada um-para-um `ExecutionJob`, contendo
  somente `jobId`, status e timestamps;
- `POST /api/executions` evolui para `202 Accepted` com `executionId`, `jobId` e `QUEUED`, enquanto
  `GET /api/jobs/[id]` consulta a metadata persistida e devolve apenas o lifecycle minimizado;
- o Frontend envia o POST uma única vez, mostra `Fila → Executando → Finalizado`, consulta o job
  sequencialmente e abre `/executions/[executionId]` somente em `SUCCESS`;
- o composition root do host mantém singletons locais da fila, do dispatcher e do Worker e entrega
  ao Worker o Engine já observado e persistente;
- o payload `ExecutionRequest` nunca é persistido pelo repository ou pelo Worker e é apagado da
  fila em qualquer estado terminal; prompts, respostas, knowledge, specifications, artifacts e
  segredos permanecem proibidos;
- ADR-028 e `knowledge/42-JOB_QUEUE_FLOW.md` documentam Queue Lifecycle, Worker, HTTP Async Flow,
  Job State Machine e Execution Dispatch;
- testes de queue, FIFO, cancelamento, duplicidade, shutdown, Worker, repository, API, polling,
  Frontend e runtime foram adicionados; 1.001 testes foram aprovados no total, sendo 871 em 132
  arquivos da suíte raiz e 130 em 28 arquivos da aplicação web;
- cobertura da suíte raiz: 93,46% statements, 85,65% branches, 98,68% functions e 94,09% lines;
- cobertura da aplicação web: 95,04% statements, 87,50% branches, 91,77% functions e 96,39% lines;
- cobertura de `core/job-queue`: 95,30% statements, 93,51% branches, 100% functions e 96,90%
  lines; cobertura de `core/execution-worker`: 95,48% statements, 90,51% branches, 96,87%
  functions e 96,47% lines;
- format, format check, lint, typecheck, testes, coverage, Prisma validate, aplicação da migration,
  build de produção e `git diff --check` foram aprovados com Node.js 24.19.0;
- a fila é single-process e não durável: restart perde payloads ativos, múltiplas instâncias possuem
  filas independentes e records podem ficar stale porque recovery permanece proibido; records e
  eventos terminais permanecem em memória pela vida do adapter porque retenção também está fora do
  escopo;
- o hotfix de Structured Outputs do Developer Agent permanece separado; nenhuma chamada real à
  OpenAI foi executada, nenhum commit foi criado e nenhum item da Sprint 19 foi iniciado.

## Fora do escopo confirmado

- testes E2E e Playwright;
- geração ou execução de código e testes por agentes;
- execução dos cenários definidos pelo QA Agent;
- registry dinâmico, seleção de versão ativa e descoberta de assets de prompt;
- retry funcional, requeue, recovery, workflows dinâmicos e concorrência;
- dashboard completo, artifacts completos e logs no frontend;
- persistência de conteúdo funcional dos agentes;
- revisão humana integrada ao fluxo;
- autenticação e autorização;
- filas externas, workers distribuídos, persistência distribuída e observabilidade distribuída;
- deploy e configuração de Vercel.
