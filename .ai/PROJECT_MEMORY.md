# Project Memory

## Estado atual

Sprint 1 — Shared Layer implementada em 2026-08-04 e aguardando aprovação humana.

Não iniciar a Sprint 2 sem aprovação explícita.

## Fundação técnica

- Node.js 24.19.0 LTS e npm 11.17.0;
- npm workspaces sem Turborepo;
- Next.js 16 com App Router, TypeScript strict e Tailwind CSS;
- Prisma 7 com SQLite local, sem models, migrations, seed ou repositories;
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
- interface `AIProvider` preservada para a Sprint 3 em `core/ai-provider`.

## Decisões

- ADR-011 registra layout, npm workspaces, Agent Runner genérico, fronteiras de dependência e SQLite local;
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

## Fora do escopo confirmado

- testes E2E;
- modelos e migrations Prisma;
- repositories;
- agentes e prompts funcionais;
- Orchestrator e Execution Engine;
- autenticação e autorização;
- métricas avançadas;
- deploy e configuração de Vercel.
