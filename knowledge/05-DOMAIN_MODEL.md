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

Estados canônicos:

- `ACTIVE`
- `ARCHIVED`

Um Project inicia em `ACTIVE` e pode ser arquivado. `ARCHIVED` é terminal no MVP.

---

## Execution

Representa uma execução da fábrica.

Cada nova demanda gera uma Execution.

Uma Execution percorre todo o pipeline de agentes.

Atributos

- id
- projectId
- status
- createdAt
- startedAt
- finishedAt

Estados canônicos:

- `CREATED`
- `RUNNING`
- `REQUIRES_REVIEW`
- `SUCCESS`
- `FAILED`
- `CANCELLED`

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

Estados canônicos:

- `CREATED`
- `RUNNING`
- `SUCCESS`
- `PARTIAL_SUCCESS`
- `REQUIRES_REVIEW`
- `FAILED`
- `CANCELLED`

Uma `AgentExecution` representa uma única tentativa. Retry automático cria uma nova `AgentExecution`, com novo identificador e `attempt` incrementado, dentro da mesma `Execution`.

## Coerência temporal

- `CREATED`: `startedAt` e `finishedAt` nulos;
- `RUNNING`: `startedAt` preenchido e `finishedAt` nulo;
- `REQUIRES_REVIEW` de `Execution`: `startedAt` preenchido e `finishedAt` nulo;
- estados finais: `finishedAt` preenchido;
- quando ambos existirem, `finishedAt` não pode ser anterior a `startedAt`;
- uma entidade cancelada antes de iniciar pode possuir `startedAt` nulo.

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
- agentExecutionId
- name
- type
- filename
- content
- version
- createdAt
- provenance

Antes do enriquecimento pela plataforma, o Artifact Generator produz um `ArtifactDraft` com `name`, `filename`, `type` e `content` a partir de um `ValidationResult` aceito e de uma `ArtifactSpecification` declarativa. O agente não cria o registro persistido, e o Generator não atribui ID, versão ou provenance de banco. Tanto o draft quanto o artefato final aceitam somente um nome de arquivo seguro, sem caminhos absolutos, `../` ou separadores de diretório.

---

## PromptVersion

Cada alteração de prompt gera uma nova versão.

Permite reproduzir execuções antigas.

Atributos

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

Estados canônicos:

- `DRAFT`
- `ACTIVE`
- `DEPRECATED`
- `ARCHIVED`

O conteúdo, a versão, o hash, a versão do schema e a origem são imutáveis. Somente o status pode ser alterado.

---

## Log

Registro estruturado e append-only de um evento de uma Execution.

Atributos

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

Execution

↓

Log

---

# Regras

Um Project possui várias Executions.

Uma Execution possui várias AgentExecutions.

Cada AgentExecution pode originar zero ou mais ArtifactDrafts e, após enriquecimento e persistência por componentes posteriores, zero ou mais Artifacts.

Todo Artifact pertence a apenas uma Execution.

Todo Artifact referencia a AgentExecution que o produziu.

Nenhum Agent conhece outro Agent.

Toda comunicação acontece através do Orchestrator.
