# Database

## Objetivo

Definir a persistência da aplicação.

Os campos abaixo representam o modelo conceitual. O mapeamento físico para Prisma pertence à Sprint 2.

Banco inicial:

SQLite

ORM:

Prisma

---

# Entidades

## Project

- id
- name
- description
- status
- createdAt
- updatedAt

---

## Execution

- id
- projectId
- status
- createdAt
- startedAt
- finishedAt

---

## AgentExecution

- id
- executionId
- agent
- attempt
- input
- output
- agentVersion
- promptVersion
- schemaVersion
- model
- usage
- durationMs
- status
- createdAt
- startedAt
- finishedAt

---

## Artifact

- id
- executionId
- agentExecutionId
- name
- type
- filename
- content
- version
- createdAt
- provenance

---

## Log

- id
- executionId
- level
- message
- createdAt

---

## PromptVersion

- id
- agent
- version
- prompt
- createdAt

---

## Config

Configurações globais.

Exemplos

- modelo padrão
- temperatura
- timeout
- retry

---

# Estratégia

Nenhum dado deverá ser perdido.

Toda execução será persistida.

Toda resposta dos agentes será persistida.

Toda alteração de prompt deverá ser versionada.

---

# Roadmap

SQLite

↓

PostgreSQL

↓

Redis

↓

Vector Database

↓

Analytics
