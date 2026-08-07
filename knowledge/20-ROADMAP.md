# Roadmap

## Objetivo

Este documento define a evolução planejada do BRQ AI Factory.

O roadmap é incremental.

Cada fase deve entregar valor de forma independente.

As fases podem ser reavaliadas conforme novos aprendizados.

Estado incremental: Foundation, camadas core, fachadas Product Owner, Developer e QA,
Orchestrator sequencial, Execution Engine efêmero, adapter HTTP, Frontend MVP e Execution History &
Observability em memória estão implementados até a Sprint 16. A Sprint 16 foi validada localmente
e aguarda aprovação humana. Persistência funcional, dashboard completo e demais páginas
permanecem em evoluções futuras, sem atribuição a uma Sprint específica neste documento.

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
- Persistência
- Logs
- Exportação de Artefatos

Critério de sucesso:

Uma demanda percorre todo o pipeline e produz artefatos completos.

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

---

# Critérios

Nenhuma fase poderá comprometer:

- arquitetura
- rastreabilidade
- segurança
- simplicidade
