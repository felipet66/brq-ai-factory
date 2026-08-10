# Roadmap

## Objetivo

Este documento define a evolução planejada do BRQ AI Factory.

O roadmap é incremental.

Cada fase deve entregar valor de forma independente.

As fases podem ser reavaliadas conforme novos aprendizados.

Estado incremental: Foundation, camadas core, Product Owner, Developer, QA, Orchestrator, Execution
Engine, adapter HTTP, Frontend MVP, Observability, Execution Repository, Job Queue, Worker,
autenticação, Prompt Playground, Factory View, Code Generator e Controlled Workspace estão
implementados até a Sprint 22. A Sprint 23 adiciona o Sandbox Runner isolado para preparação,
typecheck, build e testes explícitos, sem conectá-lo ao workflow, API, persistência ou UI. Preview,
deploy, execução distribuída e integração operacional continuam em evoluções futuras.

---

# Visão Geral

```text
Foundation
      │
      ▼
Core Platform
      │
      ▼
AI Agents
      │
      ▼
Collaboration
      │
      ▼
Enterprise
```

---

# Fase 1 — Foundation (MVP)

Objetivo:

Criar a estrutura mínima funcional da plataforma.

Entregas:

- Estrutura do projeto
- Next.js
- Prisma
- SQLite
- AI Provider abstrato
- Knowledge Loader
- Prompt Builder determinístico
- Agent Runner genérico
- Response Validator
- Orchestrator
- Execution Engine
- HTTP API adapter
- Product Owner Agent
- Developer Agent
- QA Agent
- Frontend MVP com formulário e resumo da execução
- histórico bounded em memória e timeline de execução
- eventos tipados, métricas por agente e resumo observacional
- Code Generator textual e Controlled Workspace independente
- Sandbox Build/Test Runner explícito, provider-neutral e isolado por adapter Docker
- Persistência
- Logs
- Exportação de Artefatos

Critério de sucesso:

Uma demanda percorre todo o pipeline e produz artefatos completos.

As capabilities de geração, materialização e sandbox permanecem opt-in e fora do pipeline
operacional até que ownership, autorização, persistência e eventos sejam definidos em Sprints
próprias.

---

# Fase 2 — Core Platform

Objetivo:

Evoluir a arquitetura.

Entregas:

- PostgreSQL
- Redis
- Workers
- Filas
- Retry inteligente
- Configuração de modelos
- Prompt Registry
- Versionamento completo
- Dashboard de execução

Assets de prompt, Prompt Manifest, loader e selector serão avaliados junto ao Prompt Registry, quando existirem agents e consumers de produção. A Sprint 5 entrega somente o motor puro de composição e renderização.

---

# Fase 3 — AI Factory

Novos agentes:

- Software Architect
- Tech Lead
- Security Engineer
- DevOps Engineer
- UX Designer
- Reviewer

Novos pipelines.

Execução paralela.

---

# Fase 4 — Collaboration

Objetivo:

Transformar a plataforma em ambiente colaborativo.

Entregas:

- Login
- Times
- Permissões
- Compartilhamento
- Histórico
- Comentários
- Aprovação humana

---

# Fase 5 — Enterprise

Integrações:

- GitHub
- Azure DevOps
- Jira
- Confluence
- Slack
- Microsoft Teams

---

# Fase 6 — AI Native

Objetivo:

Tornar a plataforma autônoma.

Entregas:

- Auto Planning
- Auto Review
- Auto Documentation
- Auto Refactoring
- Auto Prompt Optimization
- AI Analytics

---

# Backlog Futuro

- Multi Model
- MCP
- LangGraph
- Memory Layer
- Semantic Search
- RAG
- Prompt Evaluation
- Fine Tuning
- Plugin System
- Marketplace de Agentes
- integração confiável do Sandbox Runner ao lifecycle de execução
- Preview Runner com lifecycle, autorização, portas e cleanup próprios
- orphan recovery para containers e workspaces controlados

---

# Critérios

Nenhuma fase poderá comprometer:

- arquitetura
- rastreabilidade
- segurança
- simplicidade
