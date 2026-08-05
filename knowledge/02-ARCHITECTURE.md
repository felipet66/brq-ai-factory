# Architecture

## Objetivo

Definir a arquitetura oficial do BRQ AI Factory.

Toda implementação deve seguir esta especificação.

---

# Arquitetura Geral

Frontend

↓

API

↓

Execution Engine

↓

Orchestrator

↓

Knowledge Loader

↓

Prompt Builder

↓

Agent Runner

↓

AI Provider

↓

Response Validator

↓

Artifact Generator

↓

Persistence

---

## Camadas

### Presentation Layer

Responsável pela interface.

Tecnologias:

- Next.js
- React
- Tailwind
- TypeScript

---

### Orchestrator Layer

Controla toda execução.

Responsabilidades:

- iniciar execução
- controlar pipeline
- coordenar a validação de respostas
- registrar logs
- coordenar a persistência de artefatos

O Orchestrator não monta prompts e não chama diretamente o AI Provider.

---

### Knowledge Layer

Contém todo o conhecimento do projeto.

Arquivos:

- PROJECT_CONTEXT
- WORKFLOW
- TECH_STACK
- AGENTS
- ADRs

---

### Agent Layer

Cada agente possui:

- prompt próprio
- contexto próprio
- schema próprio
- responsabilidade única

---

### Persistence Layer

Tecnologias

- SQLite
- Prisma

Responsável por armazenar:

- projetos
- execuções
- artefatos
- logs
- mensagens

---

### AI Layer

Toda comunicação com IA acontece nesta camada.

Inicialmente:

OpenAI Responses API

Arquitetura preparada para:

- Claude
- Gemini
- Azure OpenAI

---

## Princípios

- Modularidade
- AI First
- Baixo Acoplamento
- Alta Coesão
- Componentes Independentes
- Prompts Versionados
