# Project Memory

## Estado atual

Sprint 3 — AI Provider implementada em 2026-08-05 e aguardando aprovação humana.

Não iniciar a Sprint 4 sem aprovação explícita.

## Fundação técnica

- Node.js 24.19.0 LTS e npm 11.17.0;
- npm workspaces sem Turborepo;
- Next.js 16 com App Router, TypeScript strict e Tailwind CSS;
- Prisma 7 com SQLite local, models, migration inicial e repositories;
- SDK OpenAI 7.4 com Responses API isolada no adapter concreto;
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

## Decisões

- ADR-011 registra layout, npm workspaces, Agent Runner genérico, fronteiras de dependência e SQLite local;
- ADR-012 registra ports compartilhados, adapter Prisma, mapeamento físico, versionamento e política de delete;
- ADR-013 registra a fronteira do AI Provider, a separação entre retries técnicos e funcionais e a política de segurança;
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

## Fora do escopo confirmado

- testes E2E;
- agentes e prompts funcionais;
- Knowledge Loader, Prompt Builder e Agent Runner;
- Orchestrator e Execution Engine;
- autenticação e autorização;
- métricas avançadas;
- deploy e configuração de Vercel.
