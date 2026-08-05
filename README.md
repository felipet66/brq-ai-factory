# BRQ AI Factory

Estrutura canônica do projeto:

```text
brq-ai-factory/
│
├── .ai/
│   ├── CODEX_INSTRUCTIONS.md
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
│   │   └── ADR-011-Repository-Layout.md
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
│   └── 26-REPOSITORY_STRUCTURE.md
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
npm run prisma:validate
npm run dev
```

O MVP utiliza SQLite local. Nenhuma configuração de deploy faz parte da Sprint 0.

## Validações

```bash
npm run lint
npm run typecheck
npm run test
npm run prisma:validate
npm run build
```
