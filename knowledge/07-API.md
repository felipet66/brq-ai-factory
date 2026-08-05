# API

## Objetivo

Definir a API oficial da plataforma.

A API será responsável apenas por expor funcionalidades.

Toda lógica permanece no Orchestrator.

---

# Endpoints

## Projects

POST /api/projects

Cria um projeto.

GET /api/projects

Lista projetos.

GET /api/projects/:id

Obtém detalhes.

DELETE /api/projects/:id

Remove projeto.

---

## Executions

POST /api/executions

Inicia uma execução.

GET /api/executions/:id

Consulta progresso.

GET /api/executions/:id/logs

Consulta logs.

GET /api/executions/:id/artifacts

Lista artefatos.

---

## Agents

GET /api/agents

Lista agentes.

GET /api/agents/:id

Detalhes.

---

## Prompts

GET /api/prompts

Lista prompts.

PUT /api/prompts/:id

Atualiza prompt.

---

# Response Pattern

Todas as respostas seguem:

{
success,
data,
metadata,
errors
}

---

# Versionamento

Inicialmente

v1

No futuro

v2

Sem quebrar compatibilidade.
