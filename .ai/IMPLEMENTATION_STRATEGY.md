# IMPLEMENTATION STRATEGY

## Objetivo

Este documento define a estratégia oficial de implementação do BRQ AI Factory.

O objetivo é orientar o desenvolvimento incremental da plataforma, permitindo que cada etapa seja concluída, validada e revisada antes da próxima.

O desenvolvimento deve ocorrer em pequenas entregas (Sprints), preservando a arquitetura definida na Knowledge Layer.

---

# Filosofia

O projeto deve seguir os seguintes princípios:

- Implementação incremental
- Arquitetura antes do código
- Qualidade antes da velocidade
- Testes desde o início
- Revisões frequentes
- Baixo acoplamento
- Alta coesão
- AI First

Nenhuma Sprint deve quebrar funcionalidades entregues anteriormente.

---

# Estratégia Geral

Cada Sprint deve seguir o fluxo:

```
Planejamento

↓

Implementação

↓

Testes

↓

Revisão

↓

Documentação

↓

Próxima Sprint
```

Nunca iniciar uma Sprint sem concluir a anterior.

---

# Definition of Done

Uma Sprint só pode ser considerada concluída quando:

- Build funcionando
- TypeScript sem erros
- Lint aprovado
- Testes passando
- Documentação atualizada
- Arquitetura preservada
- Sem TODOs críticos
- Sem código morto

---

# Sprint 0 — Foundation

Objetivo

Criar a estrutura inicial do projeto.

Entregas

- Estrutura de pastas
- Configuração do Next.js
- TypeScript
- ESLint
- Prettier
- Husky
- Prisma
- SQLite
- Configurações compartilhadas
- Node.js 24 LTS
- npm workspaces
- testes unitários e smoke
- CI com lint, typecheck, testes, Prisma validate e build
- baseline de segurança e observabilidade

Limites da Sprint

- Prisma e SQLite apenas no nível de infraestrutura
- nenhum model, migration, seed ou repository
- nenhum teste E2E
- nenhum deploy
- nenhum item da Shared Layer além do baseline mínimo de config, erros e logger

Critério de aceite

O projeto inicia corretamente e possui toda a estrutura base.

---

# Sprint 1 — Shared Layer

Objetivo

Construir toda infraestrutura compartilhada.

Entregas

shared/

- types
- schemas
- constants
- utils
- logger
- errors
- config
- estados canônicos de Project, Execution e AgentExecution
- contratos base de agentes e artefatos
- códigos de erro compartilhados
- testes unitários e de contrato

Limites da Sprint

- preservar os baselines existentes de config, erros e logger
- não implementar AIProvider, persistência, agentes ou Orchestrator
- retries automáticos criam uma nova AgentExecution na mesma Execution
- retomadas após falha ou revisão permanecem decisões explícitas do fluxo futuro

Critério

Todos os módulos podem reutilizar estes componentes.

---

# Sprint 2 — Persistence

Objetivo

Implementar persistência.

Entregas

- Prisma Schema
- Repositories
- Migrations
- Seed somente quando existir dado inicial obrigatório
- Configuração SQLite
- testes de integração com banco isolado

Entidades

- Project
- Execution
- AgentExecution
- Artifact
- PromptVersion
- Log

Critério

Persistência funcional.

Decisões da implementação

- nenhum seed é necessário no MVP atual;
- contratos e ports permanecem em `shared`;
- Prisma Client, mapeadores e implementações permanecem em `prisma`;
- repositories não executam lógica de negócio nem transições de estado.

---

# Sprint 3 — AI Provider

Objetivo

Criar abstração para IA.

Entregas

core/ai-provider

Implementar:

- Interface AIProvider
- OpenAIProvider
- FakeAIProvider
- Configuração

Decisões da implementação

- contratos específicos permanecem em `core/ai-provider` e não conhecem a Responses API;
- OpenAIProvider utiliza a Responses API apenas como adapter inicial;
- timeout padrão de 60 segundos com configuração server-side;
- retry técnico somente para falha de conexão sem resposta HTTP válida;
- FakeAIProvider cobre falhas técnicas, JSON malformado e structured output incompatível;
- suíte padrão não realiza chamadas reais.

Critério

A aplicação consegue conversar com um provider utilizando interfaces.

---

# Sprint 4 — Knowledge Loader

Objetivo

Criar o carregador da Knowledge Layer.

Entregas

core/knowledge-loader

Funções

- localizar documentos
- carregar contexto
- resumir contexto
- separar contexto por agente

Critério

Cada agente recebe apenas o conhecimento necessário.

---

# Sprint 5 — Prompt Builder

Objetivo

Construir prompts dinamicamente.

Entregas

core/prompt-builder

Responsabilidades

- carregar prompt base
- adicionar contexto
- adicionar regras
- adicionar segurança
- adicionar entrada do usuário

Critério

Prompt final estruturado.

---

# Sprint 6 — Response Validator

Objetivo

Validar respostas da IA.

Entregas

- validação JSON
- validação Schema
- validação Segurança
- tratamento de erro
- retry

Critério

Nenhuma resposta inválida entra na aplicação.

---

# Sprint 7 — Artifact Generator

Objetivo

Converter respostas estruturadas em artefatos.

Entregas

- story.md
- acceptance.md
- implementation.md
- quality-report.md
- playwright.spec.ts

Critério

Artefatos persistidos corretamente.

---

# Sprint 8 — Product Owner Agent

Objetivo

Implementar o primeiro agente.

Entregas

agents/product-owner

- runner
- prompt
- schema
- testes

Critério

O agente produz User Story válida.

---

# Sprint 9 — Developer Agent

Objetivo

Implementar o segundo agente.

Entregas

agents/developer

Critério

O agente gera plano técnico e implementação.

---

# Sprint 10 — QA Agent

Objetivo

Implementar o terceiro agente.

Entregas

agents/qa

Critério

O agente produz plano de testes e relatório de qualidade.

---

# Sprint 11 — Orchestrator

Objetivo

Coordenar toda a Software Factory.

Entregas

core/orchestrator

Responsabilidades

- pipeline
- estados
- retries
- logs
- persistência

Critério

Os três agentes executam em sequência.

---

# Sprint 12 — Execution Engine

Objetivo

Criar o motor da plataforma.

Responsabilidades

- iniciar execução
- cancelar execução
- acompanhar execução
- finalizar

Critério

Uma execução percorre todo o pipeline.

---

# Sprint 13 — API

Objetivo

Criar a API oficial.

Endpoints

- Projects
- Executions
- Agents
- Prompts

Critério

Frontend consegue consumir a plataforma.

---

# Sprint 14 — Frontend

Objetivo

Criar interface web.

Páginas

- Dashboard
- Projetos
- Nova Execução
- Execução
- Artefatos
- Logs

Critério

Usuário consegue utilizar todo o fluxo.

---

# Sprint 15 — Observabilidade

Objetivo

Adicionar rastreabilidade.

Entregas

- logs estruturados
- métricas
- eventos
- dashboard

Critério

Toda execução pode ser auditada.

---

# Sprint 16 — Segurança

Objetivo

Adicionar controles de segurança.

Entregas

- validações
- sanitização
- proteção contra Prompt Injection
- autenticação inicial
- autorização

Critério

Fluxo protegido.

---

# Sprint 17 — Refino

Objetivo

Melhorar qualidade.

Atividades

- refatorações
- otimizações
- documentação
- cobertura de testes
- performance

Critério

Projeto preparado para produção.

---

# Ordem Obrigatória

As Sprints devem ser executadas exatamente nesta sequência.

Não inverter.

Não pular.

Caso uma Sprint dependa de outra, a anterior deve estar concluída.

---

# Revisão ao Final de Cada Sprint

Ao concluir uma Sprint, o Codex deve apresentar:

## Resumo

O que foi implementado.

---

## Arquivos Criados

Lista completa.

---

## Arquivos Modificados

Lista completa.

---

## Testes

Quais testes foram criados.

---

## Pendências

Itens que ficaram para a próxima Sprint.

---

## Riscos

Possíveis impactos.

---

## Próxima Sprint Recomendada

Indicar exatamente qual Sprint deve iniciar.

---

# Regras para o Codex

Nunca implemente duas Sprints ao mesmo tempo.

Nunca pule etapas.

Nunca altere arquitetura sem ADR.

Nunca modifique código fora do escopo da Sprint.

Sempre preserve compatibilidade com as Sprints anteriores.

Ao terminar uma Sprint, aguarde aprovação antes de iniciar a próxima.

---

# Objetivo Final

Ao final da Sprint 17, o BRQ AI Factory deverá ser uma plataforma AI First completa, capaz de:

- Orquestrar múltiplos agentes especializados.
- Produzir artefatos rastreáveis.
- Persistir execuções.
- Validar respostas de IA.
- Gerar documentação automaticamente.
- Permitir revisão humana.
- Evoluir para novos agentes e novos modelos de IA sem alterações estruturais.
