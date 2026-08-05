# Database

## Objetivo

Definir a persistência da aplicação.

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
- startedAt
- finishedAt

---

## AgentExecution

- id
- executionId
- agent
- model
- tokens
- duration
- status
- createdAt

---

## Artifact

- id
- executionId
- type
- filename
- content

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
