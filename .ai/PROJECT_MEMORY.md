# Project Memory

## Estado atual

Sprint 25 — Preview Runner & View Build implementada localmente após aprovação arquitetural. Um
`PreviewArtifact` efêmero, separado do Controlled Workspace, somente é aprovado após
`Factory SUCCESS` persistido e pode ser servido por um container Preview isolado, autenticado e
limitado por TTL. Infraestrutura de produção, DNS/TLS operacional, deploy, runtime distribuído e
Sprint 26 permanecem fora do escopo.

## Fundação técnica

- Node.js 24.19.0 LTS e npm 11.17.0;
- npm workspaces sem Turborepo;
- Next.js 16 com App Router, TypeScript strict e Tailwind CSS;
- Prisma 7 com SQLite local, models, migration inicial e repositories;
- SDK OpenAI 7.4 com Responses API isolada no adapter concreto;
- Knowledge Loader determinístico com origem filesystem abstraída por `KnowledgeSource`;
- Prompt Builder determinístico com AST imutável e renderização final em dois canais;
- Prompt Inspector transport-neutral para preview determinístico e validação manual ephemeral,
  sem provider, execução, persistência ou observabilidade;
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
- Preview Artifact como envelope estático efêmero, imutável e correlacionado à Factory, sem reter o
  Controlled Workspace original;
- Preview Runner como port substituível de lifecycle, com adapter Docker explícito e profile
  estático `NODE_WEB_PREVIEW_24_V1` fail-closed;
- Better Auth como infraestrutura exclusiva do host Next.js para email/senha e sessões Prisma,
  sem imports em workspaces funcionais ou de domínio;
- autorização server-side com roles `ADMIN` e `USER`, ownership obrigatório de
  `ExecutionRecord` e herança de owner por `ExecutionJob`;
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
- sessões de autenticação persistidas por oito horas, sem renovação automática, usando cookie
  host-only, `httpOnly`, `sameSite=lax` e `secure` em produção;
- passwords protegidos por Argon2id e credenciais de seed recebidas somente por variáveis de
  ambiente;
- inspection data do Playground permanece em memória e em resposta `no-store`, sem Repository,
  Observability, History, cache ou browser storage;
- metadata de Preview é persistida sem código, filesystem, host paths, portas, container IDs,
  output, cookie ou ticket em claro; conteúdo do artifact e locator permanecem efêmeros no host;

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
- modelos Project, Execution, AgentExecution, Artifact, PromptVersion e Log, além dos modelos
  técnicos User, Session, Account e Verification exigidos pela autenticação;
- migration `20260805013404_init_persistence`;
- ports de repositories em `shared` e implementações concretas em `prisma`;
- estados persistidos como strings e validados pelos schemas canônicos;
- snapshots JSON de input, output, provenance e contexto de logs;
- tokens e duração persistidos em colunas escalares;
- Artifact imutável, versionado por Execution e filename;
- PromptVersion imutável, exceto por status, com hash SHA-256;
- relações históricas com delete `Restrict` e correlações opcionais de Log com `SetNull`;
- logs append-only com IDs de correlação;
- nenhum hard delete no MVP; o seed local de autenticação é explícito e nunca possui senha
  versionada;
- `ExecutionRecord.userId` é obrigatório; `ExecutionJob` deriva ownership pela relação e não
  duplica a coluna;
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
- os releases históricos `prompts/developer/1.0.0`, `1.0.1` e `1.0.2` permanecem imutáveis; o loader
  seleciona estaticamente `prompts/developer/1.0.3`, que gera exatamente `architecture.md`,
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
- ADR-029 registra Better Auth após reavaliação com Auth.js, a fronteira de identidade no host,
  sessões Prisma revogáveis, Argon2id, roles `ADMIN` e `USER`, ownership e proteção de API e
  Frontend;
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

## Hotfix de diagnóstico do Developer Structured Output

- a execução histórica confirmou dois `SCHEMA_MISMATCH`, mas os logs minimizados e os registros
  persistidos não contêm os paths nem o payload; o `responseHash` é irreversível e não permite
  reconstruir retroativamente os campos rejeitados;
- a auditoria do bundle Developer 1.0.2 encontrou paridade estrutural entre JSON Schema e Zod em
  tipos, enums, limites, arrays, nullability, required, additionalProperties, safe integers e
  paths; as únicas divergências documentadas continuam sendo NFC e contagem Unicode, ambas aceitas
  pelo Ajv e rejeitadas posteriormente pelo Zod, portanto não explicam `SCHEMA_MISMATCH`;
- `PromptOutputContract → AIRequest → OpenAI Responses API` preserva o schema e `strict: true` sem
  perda ou reescrita de keywords; testes sentinela cobrem pattern, min/max, min/maxLength,
  min/maxItems, enum, required, additionalProperties, arrays, objetos e nullability;
- o entrypoint padrão de `@brq/response-validator` e o `ValidationResult` permanecem inalterados; o
  subpath explícito `@brq/response-validator/development` só ativa diagnóstico com
  `NODE_ENV=development` e `AI_FACTORY_STRUCTURED_OUTPUT_DEBUG=true`;
- o relatório de debug é imutável e allowlisted: IDs de execução, contrato/versão/hashes,
  responseHash, quantidade, truncamento, paths, keyword, mensagem canônica sanitizada e tipo do
  valor; nunca contém schema, valores ou resposta e o reporter é fail-open;
- o composition root envia esse evento somente ao logger base, separado do pipeline de
  Observability, Execution Repository e HTTP API;
- o harness `debug:developer-output` exige ainda `AI_FACTORY_STRUCTURED_OUTPUT_RAW_DEBUG=true`, lê
  apenas JSON sob `.ai/debug/structured-output/` e executa Response Validator, Zod e Developer
  Business Validation reais sem AI Provider; o acesso é revalidado também dentro do entrypoint de
  teste e o subprocesso entrega apenas o relatório sanitizado por arquivo temporário privado;
- entradas sem `productOwnerSpecification` usam fixture canônica declarada como
  `businessContextSource: DEFAULT_FIXTURE`; `candidateHash` identifica somente o JSON inspecionado
  e não é apresentado como o `responseHash` do envelope de produção;
- fixtures locais reproduzem exatamente dois mismatches plausíveis no contrato real:
  `/modules/0/path` com `pattern` e `/implementationPhases/0/order` com `maximum`; isso prova a
  capacidade diagnóstica, mas não identifica os dois campos da execução histórica sem seu payload;
- Developer 1.0.3 não foi criado: os bundles 1.0.0, 1.0.1 e 1.0.2 permanecem intactos e qualquer
  evolução versionada depende de uma causa concreta reproduzida localmente;
- nenhuma validação, schema público, Business Validation, prompt asset ou limite de runtime foi
  alterado; nenhuma chamada real à OpenAI foi executada, nenhum commit foi criado e nenhum item da
  Sprint 19 foi iniciado.
- 1.025 testes foram aprovados no total, sendo 894 em 135 arquivos da suíte raiz e 131 em 29
  arquivos da aplicação web; cobertura raiz: 93,37% statements, 85,37% branches, 98,54% functions
  e 94,05% lines; cobertura web: 95,05% statements, 87,55% branches, 91,82% functions e 96,40%
  lines.
- format, format check, lint, typecheck, testes, coverage, Prisma validate, build de produção e
  `git diff --check` foram aprovados com Node.js 24.19.0.

## Implementação da Sprint 19

- Better Auth foi escolhido novamente depois de comparação explícita com Auth.js: Credentials do
  Auth.js não persiste credenciais por padrão e exigiria código sensível adicional para combinar
  email/senha com as database sessions revogáveis adotadas;
- Better Auth e seu adapter Prisma ficam restritos a `apps/web`; nenhum workspace funcional ou de
  domínio importa identidade, cookie, sessão ou role;
- o schema adiciona User, Session, Account e Verification e torna `ExecutionRecord.userId`
  obrigatório; `ExecutionJob` herda o mesmo owner por relação, sem duplicar `userId`;
- registros históricos recebem um usuário técnico legado determinístico durante a migration, sem
  criar uma conta autenticável;
- passwords usam Argon2id com 19.456 KiB de memória, duas iterações e paralelismo 1; passwords e
  hashes nunca integram logs, sessão, resposta HTTP ou estado React;
- sessões Prisma possuem duração absoluta de oito horas, sem refresh automático; cookies são
  `httpOnly`, `sameSite=lax`, host-only e `secure` em produção, com origem exata allowlisted;
- `USER` cria e lê apenas os próprios registros; `ADMIN` cria como seu próprio owner e possui
  leitura global explícita; lookup cross-owner de USER retorna `404` para reduzir enumeração;
- o Execution Repository recebe capabilities `OWNER`, `GLOBAL_READ_ONLY` ou `INTERNAL`, mas não
  interpreta roles ou sessões; a aplicação deriva a capability do principal autenticado;
- login e logout usam envelopes HTTP próprios; endpoints de execução, histórico, timeline e job
  passam a exigir sessão, enquanto o health check permanece público;
- o Frontend adiciona `/login`, current user, logout, proteção server-side e `/profile`; a página de
  perfil exibe somente ID, nome, email, role e timestamps seguros;
- o seed local usa `admin@example.local` e `user@example.local`, exigindo
  `BRQ_SEED_ADMIN_PASSWORD` e `BRQ_SEED_USER_PASSWORD`; nenhuma senha padrão é versionada;
- `BETTER_AUTH_SECRET` e `BRQ_APP_ORIGIN` são configurações obrigatórias do host e falham de modo
  fechado quando inválidas;
- ADR-029 e `knowledge/43-AUTHENTICATION_FLOW.md` registram login, sessão, autorização, ownership,
  API protegida e Frontend autenticado em seis diagramas Mermaid;
- rate limiting, lockout, MFA, OAuth, SSO, password reset e administração completa de usuários
  permanecem riscos ou itens futuros, não funcionalidades implícitas desta Sprint;
- nenhuma chamada real à OpenAI foi executada, nenhum commit foi criado e nenhum item da Sprint 20
  foi iniciado.

## Implementação da Sprint 20

- `core/prompt-inspector` foi criado como workspace transport-neutral, stateless e imutável;
- o Inspector recebe três adapters fixos e oferece catálogo, preview `BUILT | REJECTED` e
  Validation Preview, sem registry, descoberta ou seleção dinâmica;
- Knowledge Loader, Prompt Builder e Response Validator reais são reutilizados; nenhum Agent
  Runner, AI Provider, Orchestrator, Engine, Queue, Worker, Repository ou Observability integra o
  runtime de inspeção;
- as funções puras `projectProductOwnerPromptContexts`, `projectDeveloperPromptContexts` e
  `projectQAPromptContexts` passaram a integrar os entrypoints públicos como seams mínimos; nenhuma
  lógica funcional dos agentes foi alterada;
- o composition root exclusivo em `apps/web/src/server/playground/` reutiliza o source ID de
  Knowledge e o budget aprovado de 512 KiB por uma configuração compartilhada do host, sem
  importar `apps/web/src/server/runtime.ts`;
- o default global do Prompt Builder permanece 128 KiB, o budget do host permanece 512 KiB e o
  Knowledge Manifest e Selection Policy permanecem intactos;
- o preview projeta pipeline, sections, trust boundaries, prompt renderizado, budget, Knowledge
  metadata allowlisted, hashes reais e resumo bounded do output contract;
- o Validation Preview reconstrói o prompt de forma determinística e aplica Response Validator,
  JSON Schema, contrato Zod público e Business Validation pública, sem corrigir conteúdo e sem
  chamar provider;
- o hash do payload manual é exposto exclusivamente como `candidateHash`; mensagens são
  sanitizadas e issues indicam code, path, keyword e truncamento;
- `GET /api/playground/agents`, `POST /api/playground/preview` e
  `POST /api/playground/validate` exigem `ADMIN`, usam envelopes `3.0.0`, `no-store`, Zod, limites,
  same-origin para mutações e propagação de `AbortSignal`;
- `/playground` apresenta uma interface control-room acessível com selector de agentes, fixtures
  sintéticas, sete nodes de build, tabs, trust boundaries, budget, Knowledge, hashes, schema
  read-only e Validation Pipeline; nenhum componente conhece workspaces funcionais;
- a experiência mantém estado somente em React, aborta requests obsoletos e não usa localStorage,
  sessionStorage, query string, unsafe HTML ou biblioteca visual adicional;
- ADR-030 e `knowledge/44-PROMPT_PLAYGROUND_FLOW.md` documentam arquitetura, inspeção, trust,
  validação, interação e segurança;
- a validação final com Node 24.19.0 aprovou 1.242 testes em 201 arquivos; cobertura do núcleo em
  93,61% statements, 85,86% branches, 98,55% functions e 94,29% lines, e do host web em 95,90%
  statements, 87,80% branches, 95,27% functions e 97,12% lines;
- `format`, `format:check`, `lint`, `typecheck`, `test`, `test:coverage`, `prisma:validate`, `build`
  e `git diff --check` foram executados com sucesso;
- prompt assets, output contracts, Business Validations, schemas públicos, budget, manifest e
  policy não foram modificados; a única integração nos agentes foi a exportação das projeções
  puras já existentes;
- nenhuma chamada real à OpenAI foi executada, nenhum commit foi criado e nenhum item da Sprint 21
  foi iniciado.

## Implementação da Sprint 21

- `/executions/[id]/factory` foi criada como rota autenticada dedicada e mantém
  `/executions/[id]` como inspeção técnica separada;
- `FactoryViewModel` é a única fronteira consumida pela apresentação e é produzido por um mapper
  frontend puro, determinístico, imutável e allowlisted;
- a sala de controle usa somente Job, Execution Detail, Timeline, Stage Metrics, Lineage e
  Provenance públicos; componentes React não importam workspaces `@brq/*`, runtime server-side ou
  assets dos agentes;
- Knowledge é um estágio de sistema e a linha principal preserva Product Owner → Developer → QA,
  com estados `WAITING`, `WORKING`, `COMPLETED`, `FAILED`, `CANCELLED`, `SKIPPED` e
  `NOT_OBSERVED` derivados somente dos estados públicos;
- nenhuma fase live `VALIDATING` ou `GENERATING_ARTIFACTS` foi criada, pois os eventos existentes
  não comprovam essas transições; durações correspondentes permanecem métricas retrospectivas;
- o activity feed usa dicionário fixo sobre timestamps de job e eventos tipados, sem converter
  prompts, specifications, respostas, Knowledge ou conteúdo do usuário em mensagens;
- handoffs principais Product Owner → Developer e Developer → QA usam transições reais e lineage;
  o handoff suplementar Product Owner → QA aparece no detalhe do QA;
- como não existe `handoffAt`, a interface identifica somente instante observado e sua base, sem
  apresentá-lo como timestamp autoritativo;
- cards de artifacts exibem somente agente, índice, outcome e hashes reais de provenance;
  filename, tipo, media type e conteúdo não são inferidos ou hardcoded;
- o read model de detalhe recebeu somente a projeção aditiva e minimizada da metadata de job já
  persistida; nenhum endpoint agregado, migration, repository ou regra de domínio foi criado;
- depois do aceite do POST, o frontend navega imediatamente à Factory; o polling é phase-aware,
  sequencial e somente leitura: job na fila, Timeline durante a execução e refresh único do detalhe
  no estado terminal;
- a Factory respeita ownership existente: USER lê somente suas execuções, ADMIN possui leitura
  global e lookup cross-owner de USER permanece `404`;
- animações são sutis, estado nunca depende somente de cor e `prefers-reduced-motion` remove os
  movimentos; o layout preserva a ordem semântica no desktop e no mobile;
- a revisão visual final validou a linha de produção ativa, handoffs, seleção do painel de QA e
  ausência de overflow horizontal em 1200x900 e 390x844; a navegação mobile foi refinada para
  preservar as três views em uma única linha;
- ADR-031 e `knowledge/45-FACTORY_VISUALIZATION_FLOW.md` documentam arquitetura, mapping,
  handoffs, activity, polling, segurança, componentes e limitações reais;
- a validação final com Node 24.19.0 aprovou 1.296 testes em 208 arquivos; cobertura do núcleo em
  93,64% statements, 86,05% branches, 98,55% functions e 94,32% lines, e do host web em 94,13%
  statements, 86,89% branches, 95,40% functions e 95,53% lines;
- a suíte web usa execução determinística por arquivo para impedir contenção e falsos timeouts sob
  instrumentação V8, sem relaxar os timeouts ou as asserções existentes;
- nenhum agent, prompt asset, schema público, output contract, Business Validation, budget ou
  runtime de IA foi alterado; nenhuma dependência ou workspace foi adicionado;
- nenhuma chamada real à OpenAI foi executada, nenhum commit foi criado e nenhum item da Sprint 22
  foi iniciado.

## Implementação da Sprint 22

- `agents/code-generator` foi criado como agente funcional independente do Developer: recebe uma
  `TechnicalSpecification` pública aprovada e produz somente um `GeneratedCodeBundle` textual;
- a elegibilidade da fonte é verificada antes de Knowledge/provider: readiness `READY`, hash
  canônico, evidência QA `READY`, correlação de execução, snapshot exclusivamente `CREATE` e roots
  de módulos materializáveis sem colisão portátil exata;
- o pipeline reutiliza Knowledge Loader, Prompt Builder por meio do Agent Runner e Response
  Validator; Code Business Validation e Bundle Assembler permanecem específicos do agente;
- o contexto `CODE_GENERATOR` foi adicionado à Knowledge Selection Policy `1.13.0` com somente tech
  stack, coding standards, testing e security; o Knowledge Manifest permanece `1.12.0`;
- o budget explícito do agente é 48 KiB/4 documentos de Knowledge, 224 KiB de
  `TechnicalSpecification`, 384 KiB de prompt e 131.072 output tokens; defaults e runtime dos
  agentes existentes não foram modificados;
- o bundle `1.0.0` suporta somente UTF-8, até 96 arquivos, 64 KiB por arquivo, 384 KiB totais, 16
  entrypoints, paths de 512 bytes/20 segmentos/255 bytes por segmento e media types textuais
  allowlisted;
- JSON Schema valida a estrutura; Code Business Validation continua autoritativa para paths,
  conteúdo, limites, referências, cobertura, entrypoints, secrets e consistência com a fonte;
- manifest, byte lengths, content/file/bundle/generation hashes, lineage e provenance são
  calculados server-side; schemas públicos recalculam a cadeia e rejeitam drift ou tampering;
- `core/controlled-workspace` foi criado como fronteira provider/agent-neutral e recebe somente um
  `WorkspacePlanRequest` projetado explicitamente por um caller confiável;
- o planner revalida conteúdo, hashes, allowlists, limits, paths relativos POSIX/NFC, traversal,
  nomes sensíveis, colisões case/Unicode e conflitos arquivo/diretório antes de produzir um plano
  profundamente imutável;
- o adapter filesystem exige uma raiz absoluta preexistente do host, grava com permissões privadas
  em staging no mesmo filesystem, verifica antes e depois do rename atômico e limpa estado próprio
  em falhas capturadas; nenhum destino existente é sobrescrito;
- Code Generator e Controlled Workspace não importam um ao outro; um teste de integração cobre a
  projeção pública e preserva `bundleContentHash` entre as fronteiras;
- Artifact Generator não foi reutilizado porque sua quantidade de templates e filenames planos são
  configuração confiável, enquanto arquivos de código possuem paths dinâmicos propostos por saída
  não confiável;
- código gerado/materializado permanece dado não confiável: não há shell, subprocesso, package
  manager, instalação, build, testes, rede executada, preview, deploy, Git ou correção autônoma;
- Orchestrator, Execution Engine, Worker, Queue, Repository, Prisma, API, Frontend, Factory View,
  agents anteriores e seus prompt assets continuam sem integração funcional com a nova capability;
- ADR-032, `knowledge/46-CODE_GENERATION_FLOW.md` e
  `knowledge/47-CONTROLLED_WORKSPACE_FLOW.md` documentam as fronteiras, validações, hashes,
  atomicidade, falhas e o limite futuro de Build/Test Runner;
- a validação final com Node 24.19.0 aprovou 1.514 testes em 223 arquivos: 1.144 testes do núcleo
  em 156 arquivos e 370 testes do host web em 67 arquivos; a cobertura do núcleo ficou em 93,39%
  statements, 85,53% branches, 98,25% functions e 94,04% lines, e a do host web em 94,13%
  statements, 86,89% branches, 95,40% functions e 95,53% lines;
- format, format check, lint, typecheck, testes, cobertura, Prisma validate, build e diff check
  foram aprovados integralmente;
- nenhuma chamada real à OpenAI foi executada, nenhum commit foi criado e nenhum item da Sprint 23
  foi iniciado.

## Implementação da Sprint 23

- `core/sandbox-runner` foi criado como port provider-neutral para avaliar explicitamente o
  resultado público do Controlled Workspace, sem importar Code Generator, agentes, Orchestrator,
  Execution Engine, Worker, Queue, Repository, Prisma ou aplicações;
- Docker permanece restrito ao adapter explícito; o contrato principal contém requests, results,
  schemas, policies, lifecycle, errors, hashing e imutabilidade sem tipos do runtime concreto;
- gerar código, materializar código e executar código são três autoridades independentes; a Sprint
  23 não conecta o Runner ao workflow, API, Repository, Observability, Factory View ou Preview;
- o pipeline é fixo em `PREPARE → TYPECHECK → BUILD → TEST`, executa uma vez, interrompe na primeira
  falha, marca etapas posteriores como `SKIPPED` e não possui retry, resume, fallback ou correção
  autônoma;
- imagem, helper, toolchain, dependency snapshot, executáveis, argumentos, environment, ordem e
  limites são policies confiáveis do host; requests podem somente reduzir ceilings e nunca fornecem
  command, shell, image, mount, network ou package manager;
- nenhuma execução usa scripts do `package.json`, dependency lifecycle scripts, shell arbitrário,
  instalação online ou fallback para registry; dependencies precisam estar disponíveis no snapshot
  offline pinado;
- a imagem é local e pinada por digest, com `--pull=never`; identidade, plataforma, labels, helper
  ABI e dependency snapshot são verificados antes do start;
- o container executa como UID/GID `65532:65532`, com root filesystem read-only, network none,
  capabilities zeradas, no-new-privileges, seccomp e limites de CPU, memory sem swap adicional,
  PIDs, open files, tmpfs, output e tempo;
- privileged, ports, devices, host namespaces, bind mounts, host volumes e Docker socket são
  proibidos; o workspace original nunca entra no container;
- o adapter relê exatamente os arquivos declarados sob a raiz controlada, rejeita symlinks e drift,
  recalcula hashes e envia um envelope canônico limitado por stdin; o helper pinado reconstrói a
  cópia descartável e repete a verificação de integridade;
- após o start, um helper fixo de readiness cria e verifica somente os diretórios no tmpfs antes do
  `PREPARE`; o handshake remove corrida de scheduling e não adiciona etapa pública, delay ou retry;
- timeout total e por etapa e cancelamento interrompem a execução e removem o container inteiro;
  sucesso, falha, timeout e cancelamento convergem para um cleanup idempotente, com ownership único,
  invocação exatamente uma vez e confirmação de remoção;
- stdout e stderr são drenados continuamente com limites de bytes, linhas e hard output, decoding
  UTF-8 entre chunks, remoção de ANSI/controles, redaction de secrets e host paths e truncamento
  determinístico; logs estruturados não contêm código nem output;
- `SandboxRequestHash` e `SandboxResultHash` estendem a cadeia de Technical Specification, bundle,
  plan e workspace; timestamps, durations, container IDs e paths permanecem observacionais;
  lineage e provenance continuam separados;
- a suíte normal usa executor Docker fake e não depende de daemon; testes reais ficam somente no
  comando opt-in `test:sandbox:integration`, exigem imagem digest-pinned previamente carregada e não
  fazem pull ou build automático;
- uma imagem mínima e auditável de integração foi versionada em
  `core/sandbox-runner/integration/image`; o build explícito usa Node 24.19.0, TypeScript 6.0.3 e
  Dockerfile frontend pinados, não inclui shell ou package manager na imagem final e produz helpers
  fixos que validam o envelope, executam typecheck real, compilam e verificam o harness `ready`;
- o teste opt-in real foi aprovado em Docker Desktop 4.42.0 / Engine 28.2.2, com repository digest
  e image ID obtidos do image store local e cleanup confirmado; a compatibilidade com Docker 28
  preserva PID/UTS privados pelos defaults inspecionados e aceita `MemorySwappiness: null` somente
  junto do bloqueio de swap já exigido por `MemorySwap === Memory`;
- ADR-033, `knowledge/48-SANDBOX_RUNNER_FLOW.md` e
  `knowledge/49-SANDBOX_SECURITY_MODEL.md` documentam lifecycle, commands, filesystem, limits,
  timeout, cancelamento, cleanup, output, threat model, hashes e integrações futuras;
- nenhuma chamada real à OpenAI foi executada, nenhum commit foi criado e nenhum item da Sprint 24
  foi iniciado.

## Implementação da Sprint 24

- `core/factory-pipeline` adiciona o `FactoryPipelineCoordinator` como composition layer externo ao
  Orchestrator e ao Execution Engine; ambos preservam comportamento e contratos existentes;
- o pipeline chama somente APIs públicas e mantém as projeções explícitas
  `TechnicalSpecification → CodeGenerationRequest`, `GeneratedCodeBundle → WorkspacePlanRequest` e
  `WorkspaceMaterializationResult → SandboxRunRequest`;
- `FactoryExecutionResult` é um contrato aditivo e metadata-only; `ExecutionResult` e
  `WorkflowResult` não foram ampliados nem substituídos;
- Factory `SUCCESS` exige PO, Developer, QA `READY`, Code Generator, Workspace Plan,
  materialização, PREPARE, TYPECHECK, BUILD, TEST e release do workspace com sucesso;
- falhas e cancelamentos preservam resultados anteriores, interrompem o pipeline e projetam
  downstream `SKIPPED` sem artifacts ou estados fictícios;
- o mesmo `AbortSignal` atravessa Engine, Code Generator, materialização e Sandbox; Sandbox mantém
  ownership do container e o coordinator mantém ownership do release do workspace;
- Controlled Workspace expõe `release()` idempotente, valida ownership, root, inode e hashes,
  executa rollback/cleanup sob deadline e nunca recebe path pelo contrato de release;
- o profile Docker `NODE_TYPESCRIPT_24_V1` é separado da fixture da Sprint 23, usa Node 24.19.0 e
  TypeScript 6.0.3 pinados e executa somente helpers fixos sem dependencies ou package scripts;
- o host exige configuração Docker explícita e não possui fallback automático para fake; injeção
  de runner/workspace existe somente como composition capability para testes;
- Observability `2.0.0` adiciona Code Generator, Workspace, Prepare, Typecheck, Build e Test e
  preserva snapshots `1.0.0` por contrato discriminado;
- a migration aditiva normaliza resultado, etapas, lineage, provenance e toolchains da Factory;
  nenhuma tabela armazena código, prompts, specifications, output bruto, filesystem ou secrets;
- API `3.1.0` expõe `factoryResult` opcional e timeline v1/v2 sem novo endpoint; falhas funcionais
  continuam respostas de consulta normais;
- a Factory View mantém PO, Developer e QA como personagens e adiciona somente estações técnicas
  derivadas de evidência real; execuções históricas permanecem compatíveis;
- ADR-034 e `knowledge/50-FACTORY_PIPELINE_FLOW.md` documentam composição, lifecycle, hashes,
  observabilidade, trust boundaries, falhas e cancelamento;
- Preview Runner, servidor, iframe, portas, deploy, retry, self-healing e Sprint 25 permanecem fora
  do escopo.

## Implementação da Sprint 25

- `core/preview-artifact` cria uma fronteira imutável e determinística para a cópia estática
  efêmera exportada pelo profile da Factory; o artifact possui lifecycle explícito
  `CANDIDATE → APPROVED | EXPIRED | DELETED`, `APPROVED → CONSUMED | EXPIRED | DELETED` e
  `CONSUMED | EXPIRED → DELETED`, além de hashes próprios, lineage e provenance;
- a captura do candidato ocorre somente após `TEST` bem-sucedido, mas a aprovação exige
  `FactoryExecutionResult SUCCESS` já persistido, Sandbox `SUCCESS`, release
  `RELEASED` e correlação exata de factory, sandbox request/result e workspace hashes;
- o Controlled Workspace continua sendo descartado normalmente; Preview lê exclusivamente a cópia
  efêmera sob uma raiz privada configurada pelo host e nunca reabre ou retém o workspace original;
- `core/preview-runner` define port, contracts, schemas Zod, state machine, policies, limites,
  erros, hashing, logging sanitizado, fake e coordinator sem depender de Docker, Next.js, Prisma,
  autenticação, Factory Pipeline ou agentes;
- `NODE_WEB_PREVIEW_24_V1` é o único profile inicial e permanece estrito e fail-closed: aceita
  apenas o envelope estático, paths, media types, quantidade e bytes allowlisted; projetos
  incompatíveis não recebem fallback, comando alternativo ou flexibilização da policy;
- o adapter Docker usa uma imagem de Preview distinta do container de build/test, pinada por
  digest e image ID, non-root, read-only, sem privileged, mounts, Docker socket, capabilities ou
  egress e com CPU, memória, PIDs, open files, tmpfs, output, response e tempo limitados;
- a network Docker é criada com `--internal` e sem publicação de portas. Como esse isolamento não
  oferece conexão host→container por port publishing, um relay host-only em `127.0.0.1` usa
  exclusivamente um helper fixo e allowlisted por `docker exec`; cada chamada exige token efêmero
  privado, request, response, timeout e envelope são limitados e o locator nunca deixa o
  composition root;
- o Preview recebe origin exclusiva por `previewId`; a origin da Factory autentica e aplica
  ownership antes de emitir um ticket curto, single-use e persistido somente como hash, cuja troca
  cria um cookie Preview host-only, `HttpOnly` e assinado;
- Factory cookies, DOM, storage e credentials não atravessam a origin; o gateway revalida cookie,
  sessão `RUNNING`, TTL e locator privado em toda requisição e aceita somente `GET`/`HEAD` e
  headers/respostas allowlisted;
- start, health, stop manual, expiração e reconciliação convergem para remoção idempotente e
  confirmada do relay, container, network e artifact; TTL default é 10 minutos, com ceiling de 15
  minutos e requests autorizados apenas a reduzir o limite;
- a migration `20260810140000_preview_metadata` adiciona `PreviewArtifact`, `PreviewSession`,
  eventos, provenance e ticket. Prisma persiste somente metadata segura, hashes, lifecycle,
  policy, limites e identidade do runtime; código, filesystem, paths, portas, container IDs,
  stdout/stderr, cookies e tickets em claro são proibidos;
- a API aditiva `3.2.0` expõe controle por execução e sessão; o Frontend adiciona `Build Preview`,
  `View Build`, stop e a rota autenticada `/executions/[id]/preview`, consumindo somente read models
  minimizados;
- a suíte padrão usa Fake Preview Runner/executor e não depende de daemon. O caminho real
  `Artifact → Start → Health → conteúdo servido → Stop → Cleanup` fica exclusivamente no comando
  opt-in `test:preview:integration`, sem pull ou build automático;
- ADR-035, `knowledge/51-PREVIEW_RUNNER_FLOW.md` e
  `knowledge/52-PREVIEW_SECURITY_MODEL.md` documentam boundary, lifecycle, origin isolation,
  autenticação, persistência, threat model e cleanup;
- infraestrutura de produção, DNS/TLS operacional, deploy, Preview distribuído, retry,
  self-healing e qualquer item da Sprint 26 permanecem fora do escopo.

## Hotfix Developer Readiness 1.0.3

- a execução real `execution-fc89dc550d362b2bfebe938e5ccf5dae` reproduziu
  `DEVELOPER_READINESS_MISMATCH`: JSON Schema e Response Validator aceitaram a resposta, enquanto a
  Business Validation derivou `PARTIALLY_READY` a partir de pergunta não bloqueante e/ou assumption
  com `requiresValidation: true`;
- `prompts/developer/1.0.3` preserva o JSON Schema do `1.0.2` e explicita a mesma tabela autoritativa,
  na mesma ordem, no rule set do agente, nas instruções do output contract e na instrução final;
- o modelo deve recalcular readiness sobre `openQuestions` e `assumptions` finais e confirmar
  igualdade exata antes do JSON; `requiresValidation: false` isolado não reduz readiness e
  completude técnica continua uma validação separada;
- a Developer Business Validation, schemas públicos, contratos, hashing, runtime prompt budget e
  demais agentes não foram alterados; o host permanece em 512 KiB e o prompt Developer denso usa
  262.035 B com o novo bundle;
- os bundles `1.0.0`, `1.0.1` e `1.0.2` permanecem intactos, o bundle ativo `1.0.3` possui hash
  `0bd8155f3d81a382ea1ee673c1ff31e64adb3d93be5c753ad873412a139daea7`, e toda validação usa
  providers fake ou construção local de prompt, sem chamada real à OpenAI.

## Hotfix QA Traceability e Readiness 1.0.1

- a execução real `execution-252c0e244d8bdbb2f013cc944d716e5f` chegou ao QA depois de Product
  Owner e Developer concluídos, e a resposta do provider passou pelo JSON Schema e pelo Response
  Validator antes de ser rejeitada com `QA_CATEGORY_MISMATCH` e `QA_READINESS_MISMATCH`;
- `prompts/qa/1.0.1` preserva integralmente o JSON Schema do `1.0.0` e torna explícita, no rule set,
  output contract e instrução final, a correspondência entre coverage/matrix e as referências
  funcionais ou técnicas declaradas por cada cenário;
- o mesmo bundle explicita a tabela ordenada de readiness: qualquer source que requeira
  esclarecimento, blocker ou dúvida bloqueante produz `REQUIRES_CLARIFICATION`; caso contrário,
  source parcial, qualquer dúvida ou assumption pendente produz `PARTIALLY_READY`; sem pendências,
  o resultado é `READY`;
- QA Business Validation, schemas públicos, contratos, runtime e prompt budget não foram alterados;
  o host permanece em 512 KiB e o prompt QA denso usa 412.211 B;
- o bundle histórico `1.0.0` permanece intacto e o bundle ativo `1.0.1` possui hash
  `618302c7dc8ddcec7c7087789e966a74259631d4a716d125c9adefa8a5c665b9`; os testes usam somente
  `FakeAIProvider` ou construção local de prompt, sem chamada real à OpenAI.

## Fora do escopo confirmado

- testes E2E e Playwright;
- execução direta do código gerado no host; build/test permanecem no Sandbox e Preview somente no
  container separado do profile `NODE_WEB_PREVIEW_24_V1`;
- network, privileged, Docker socket, bind mount, package scripts, lifecycle scripts, dependency
  install online, retry e egress a partir dos containers;
- execução dos cenários definidos pelo QA Agent;
- registry dinâmico, seleção de versão ativa e descoberta de assets de prompt;
- retry funcional, requeue, recovery, workflows dinâmicos e concorrência;
- dashboard completo, artifacts completos e logs no frontend;
- persistência de conteúdo funcional dos agentes;
- revisão humana integrada ao fluxo;
- OAuth, SSO, LDAP, MFA, Organizations, Teams, permission engine, API keys, rate limit, billing e
  audit log completo;
- filas externas, workers distribuídos, persistência distribuída e observabilidade distribuída;
- DNS/TLS de produção, expose de container, deploy e runtime Preview distribuído;
- deploy e configuração de Vercel.
