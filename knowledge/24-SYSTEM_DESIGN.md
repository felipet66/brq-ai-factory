# System Design

## Objetivo

Este documento descreve a arquitetura completa do BRQ AI Factory.

Ele representa a principal referência técnica para implementação da plataforma.

Toda implementação deve respeitar os princípios definidos neste documento.

Quando houver conflito entre código e este documento, este documento deverá ser considerado a fonte de verdade até que uma decisão arquitetural (ADR) seja registrada.

---

# Visão Geral

O BRQ AI Factory é uma plataforma AI First baseada em agentes especializados.

Cada agente representa uma função tradicional de uma Software Factory.

A plataforma recebe uma demanda e a transforma em um conjunto de artefatos de software através de um pipeline controlado.

Fluxo macro:

```
Usuário
    │
    ▼
Frontend
    │
    ▼
Execution Engine
    │
    ▼
Orchestrator
    │
    ▼
Knowledge Loader
    │
    ▼
Prompt Builder
    │
    ▼
Agent Runner
    │
    ▼
AI Provider
    │
    ▼
Response Validator
    │
    ▼
Artifact Generator
    │
    ▼
Persistence
```

---

# Princípios Arquiteturais

A arquitetura segue os seguintes princípios:

- AI First
- Clean Architecture
- Modularidade
- Baixo Acoplamento
- Alta Coesão
- Single Responsibility
- Open/Closed
- Documentação como Fonte de Verdade
- Human in the Loop

---

# Componentes

## Frontend

Responsável apenas pela experiência do usuário.

Funções:

- criar projetos
- criar demandas
- acompanhar execuções
- visualizar artefatos
- visualizar logs
- acompanhar progresso

Nunca deve conter regras de negócio.

---

## API

Responsável por expor funcionalidades.

Não contém lógica complexa.

Responsabilidades:

- validar entrada
- autenticação
- autorização
- chamar Execution Engine
- retornar resposta

---

## Execution Engine

É a porta de entrada do sistema.

Responsável por iniciar uma execução completa.

Funções:

- criar Execution
- iniciar pipeline
- acompanhar estados
- encerrar execução
- cancelar execução

Nunca conversa diretamente com a IA.

---

## Orchestrator

É o coordenador da plataforma.

Funções:

- controlar ordem dos agentes
- persistir estados
- controlar retries
- controlar timeout
- controlar logs
- decidir próximo passo

O Orchestrator nunca gera prompts.

O Orchestrator nunca chama diretamente a OpenAI.

---

## Knowledge Loader

Responsável por autorizar, indexar, selecionar e carregar apenas o conhecimento documental necessário.

O contrato `KnowledgeSource` abstrai a origem. O MVP utiliza filesystem, enquanto consumidores operam somente com IDs lógicos e metadados. Um manifesto JSON versionado e validado por Zod define os documentos permitidos, com IDs explícitos e independentes de filenames.

Cada instância mantém um índice imutável com hashes SHA-256. A seleção por contexto é determinística e versionada. Durante o carregamento, apenas documentos selecionados são relidos e comparados ao índice; mudanças não são incorporadas silenciosamente.

O orçamento de documentos e bytes é configurado por instância. Documentos obrigatórios não são removidos nem truncados; opcionais que não couberem são omitidos de forma rastreável.

Exemplo:

```
knowledge/

↓

Architecture

↓

Workflow

↓

Coding Standards

↓

Security

↓

Agent Docs

↓

Prompt Context
```

O objetivo é reduzir consumo de contexto.

O Context Composer preserva cada documento sem resumo ou transformação e inclui delimitadores, ID, categoria e hash. O Knowledge Loader não monta prompts, executa agentes, coordena o pipeline, persiste dados ou utiliza IA, embeddings, RAG e busca semântica.

---

## Prompt Builder

Recebe:

- contexto estruturado do Knowledge Loader
- prompt base
- entrada do usuário

Gera:

Prompt Final

Exemplo:

```
Prompt Base

+

Security Rules

+

Architecture

+

Workflow

+

Agent Prompt

+

Execution Context

↓

Prompt Final
```

---

## Agent Runner

Único componente autorizado a conversar com o AI Provider.

Responsabilidades:

- enviar prompt
- receber resposta
- medir duração
- medir tokens
- registrar erros
- retornar resposta

---

## AI Provider

Camada de abstração.

Recebe uma solicitação já montada, chama uma implementação concreta e normaliza conteúdo, modelo, uso de tokens e metadados técnicos. Não monta prompts, não carrega conhecimento, não valida contratos funcionais, não cria artefatos e não persiste dados.

Implementações futuras:

- OpenAI
- Claude
- Gemini
- Azure OpenAI

Nenhum outro componente conhece a implementação concreta.

---

## Response Validator

Responsável por validar toda resposta da IA.

Valida:

- JSON
- Schema
- Campos obrigatórios
- Regras de negócio
- Segurança

Respostas inválidas geram retry.

---

## Artifact Generator

Transforma respostas estruturadas em artefatos.

Exemplo:

```
JSON

↓

story.md

↓

acceptance.md

↓

implementation.md

↓

playwright.spec.ts
```

---

## Persistence

Responsável por armazenar:

- Projects
- Executions
- Agent Executions
- Artifacts
- Logs
- Prompt Versions

Os ports de persistência pertencem a `shared/`. Implementações, mapeadores, migrations e Prisma Client pertencem a `prisma/`. Regras de negócio e transições de estado permanecem fora dos repositories.

---

# Fluxo Completo

```
Criar Projeto

↓

Criar Demanda

↓

Criar Execution

↓

Executar Product Owner

↓

Persistir

↓

Executar Developer

↓

Persistir

↓

Executar QA

↓

Persistir

↓

Finalizar
```

---

# Fluxo Interno do Product Owner

```
Execution

↓

Knowledge Loader

↓

Prompt Builder

↓

Agent Runner

↓

OpenAI

↓

Response Validator

↓

Artifact Generator

↓

Persistência
```

Os demais agentes seguem exatamente o mesmo fluxo.

---

# Estados

Estados de `Execution`:

```text
CREATED
RUNNING
REQUIRES_REVIEW
SUCCESS
FAILED
CANCELLED
```

`FAILED → RUNNING` representa somente uma retomada explícita e nunca ocorre automaticamente. `REQUIRES_REVIEW → RUNNING` deverá depender de uma resolução humana auditável.

Estados de `AgentExecution`:

```text
CREATED
RUNNING
SUCCESS
PARTIAL_SUCCESS
REQUIRES_REVIEW
FAILED
CANCELLED
```

Os resultados de uma `AgentExecution` são terminais para aquela tentativa.

---

# Retry

Quando permitido:

- timeout
- erro temporário
- JSON inválido
- schema inválido

Nunca realizar retry infinito.

Retry automático cria uma nova `AgentExecution`, com novo identificador e `attempt` incrementado, dentro da mesma `Execution`. `RETRY` é um evento, não um estado persistido.

Retries internos do `AIProvider` são tentativas técnicas distintas: somente falhas de conexão sem resposta HTTP válida podem ser repetidas e todas permanecem na mesma chamada. Respostas HTTP, recusas e conteúdo inválido nunca disparam retry técnico. O Orchestrator continua responsável por qualquer nova `AgentExecution`.

```
Tentativa 1

↓

Falhou

↓

Retry

↓

Sucesso
```

---

# Human Review

O sistema deve interromper automaticamente quando:

- requisito ambíguo
- segurança
- conflito documental
- baixa confiança
- mudança arquitetural

Status:

```
REQUIRES_REVIEW
```

---

# Observabilidade

Cada execução registra:

- duração
- tokens
- agente
- modelo
- prompt
- artifacts
- logs
- retries
- erros

---

# Segurança

Todos os componentes devem tratar entradas como não confiáveis.

Validação obrigatória:

- API
- IA
- Banco
- Exportação

Nunca confiar diretamente na resposta da IA.

O Knowledge Loader opera com manifesto allowlist, raiz server-side, contenção por caminho real e rejeição de traversal, symlinks, arquivos não regulares e conteúdo alterado após a indexação.

---

# Estrutura Física

```
apps/
    web/

knowledge/

core/

    execution-engine/

    orchestrator/

    knowledge-loader/

    prompt-builder/

    response-validator/

    artifact-generator/

    ai-provider/

agents/

prompts/

shared/
```

---

# Sequência de Chamadas

```
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

↓

Frontend
```

---

# Escalabilidade

A arquitetura permite:

- múltiplos modelos
- novos agentes
- execução paralela
- filas
- workers
- RAG
- memória persistente
- plugins

Sem alteração estrutural.

---

# Roadmap Arquitetural

MVP

↓

SQLite

↓

PostgreSQL

↓

Redis

↓

Workers

↓

Filas

↓

Múltiplos Providers

↓

Memory Layer

↓

RAG

↓

Marketplace de Agentes

---

# Regras para Implementação

Todo módulo implementado deve:

- possuir testes
- possuir documentação
- possuir logs
- validar entrada
- validar saída
- tratar erros
- respeitar arquitetura

Nenhuma implementação deve alterar esta arquitetura sem criação de um novo ADR.

---

# Critérios de Qualidade

A arquitetura será considerada adequada quando:

- novos agentes puderem ser adicionados sem alterar os existentes;
- novos modelos de IA puderem ser adicionados sem alterar o Orchestrator;
- novos prompts puderem ser versionados sem quebrar execuções anteriores;
- toda execução puder ser reproduzida;
- qualquer falha puder ser rastreada por logs e artefatos;
- o sistema puder evoluir do MVP para uma plataforma enterprise preservando os mesmos princípios arquiteturais.
