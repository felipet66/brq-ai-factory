# Database

## Objetivo

Definir a persistência da aplicação.

Os campos abaixo representam o modelo persistido pelo Prisma desde a Sprint 2.

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
- inputTokens
- outputTokens
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
- agentExecutionId
- artifactId
- level
- event
- message
- context
- requestId
- traceId
- createdAt

---

## PromptVersion

- id
- agent
- version
- schemaVersion
- content
- hash
- status
- description
- source
- createdAt
- updatedAt

---

## Decisões físicas

- estados e tipos canônicos são persistidos como texto e validados pelos schemas da Shared Layer;
- input, output, provenance e context são persistidos como JSON;
- tokens e duração são colunas escalares;
- datas são armazenadas como `DateTime` e mapeadas para ISO 8601;
- relações históricas obrigatórias usam `Restrict`;
- correlações opcionais de Log com AgentExecution e Artifact usam `SetNull`;
- não existem repositories de hard delete no MVP.

## Unicidade e versionamento

- AgentExecution: `(executionId, agent, attempt)`;
- Artifact: `(executionId, filename, version)`;
- PromptVersion: `(agent, version)`.

Artifact e PromptVersion geram novos registros em vez de sobrescrever conteúdo histórico.

Configuração global permanece em variáveis de ambiente. Não existe entidade `Config` nesta etapa, evitando persistência de segredos.

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
