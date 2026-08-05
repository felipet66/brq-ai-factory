# Domain Model

## Objetivo

Definir os principais conceitos de domínio do BRQ AI Factory.

Este documento representa o modelo conceitual da plataforma.

---

# Entidades

## Project

Representa um projeto criado pelo usuário.

Responsabilidades:

- armazenar informações gerais
- conter múltiplas execuções
- manter histórico

Atributos

- id
- name
- description
- status
- createdAt
- updatedAt

---

## Execution

Representa uma execução da fábrica.

Cada nova demanda gera uma Execution.

Uma Execution percorre todo o pipeline de agentes.

Atributos

- id
- projectId
- status
- startedAt
- finishedAt

---

## Agent

Representa um agente especializado.

Exemplos:

- Product Owner
- Developer
- QA

Cada agente possui:

- prompt
- schema
- configuração
- versão

---

## AgentExecution

Representa a execução de um agente dentro de uma Execution.

Atributos

- id
- executionId
- agentId
- input
- output
- duration
- tokens
- model
- status

---

## Artifact

Todo resultado produzido por um agente.

Exemplos

- story.md
- acceptance.md
- implementation.md
- playwright.spec.ts

Atributos

- id
- executionId
- type
- filename
- content

---

## PromptVersion

Cada alteração de prompt gera uma nova versão.

Permite reproduzir execuções antigas.

Atributos

- id
- version
- description
- createdAt

---

## Message

Representa o contexto trocado entre Orchestrator e Agentes.

Atributos

- role
- content
- timestamp

---

# Relacionamentos

Project

↓

Execution

↓

AgentExecution

↓

Artifact

Execution

↓

Messages

Agent

↓

PromptVersion

---

# Regras

Um Project possui várias Executions.

Uma Execution possui várias AgentExecutions.

Cada AgentExecution produz zero ou mais Artifacts.

Todo Artifact pertence a apenas uma Execution.

Nenhum Agent conhece outro Agent.

Toda comunicação acontece através do Orchestrator.
