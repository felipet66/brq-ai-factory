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

`knowledge/` permanece como fonte documental. `core/knowledge-loader` autoriza documentos por manifesto JSON validado por Zod, abstrai a origem por `KnowledgeSource`, constrói um índice imutável com hashes e aplica uma política determinística de seleção.

O contexto produzido preserva o conteúdo original e inclui ID, categoria, hash e delimitadores por documento. Orçamentos são configurados por instância e nunca causam truncamento silencioso.

O Knowledge Loader não monta prompts, executa agentes, coordena o pipeline, persiste dados, resume conteúdo ou utiliza IA, embeddings, RAG e busca semântica.

---

### Prompt Layer

`core/prompt-builder` recebe estruturas prontas e produz um `PromptResult` determinístico. A hierarquia conceitual `PromptDocument → PromptSection → PromptBlock → PromptFragment` é representada por `PromptTemplate` antes da resolução e por `ResolvedPromptDocument` depois dela.

Seções usam os canais semânticos `INSTRUCTIONS` e `INPUT`. Templates, constraints, contexto, variáveis e output contracts são validados e compostos em ordem explícita; orçamento e hashes usam bytes UTF-8 e representações canônicas.

A transformação é pura e não realiza I/O de domínio nem acessa recursos externos; o logger estruturado injetável é sua única saída lateral. O Prompt Builder não carrega assets, seleciona versões, chama providers, executa agentes, coordena o pipeline ou persiste dados.

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
