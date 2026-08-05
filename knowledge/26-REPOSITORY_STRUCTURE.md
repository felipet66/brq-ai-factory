# Repository Structure

## Objetivo

Definir a organização física do repositório.

Toda implementação deve respeitar esta estrutura.

---

# Estrutura

```
BRQ-AI-FACTORY/

.ai/

knowledge/

apps/

core/

agents/

prompts/

shared/

prisma/

package.json

README.md
```

---

# .ai

Contém documentação utilizada exclusivamente pelas IAs.

Arquivos:

```
PROJECT_MEMORY.md

CODEX_INSTRUCTIONS.md

DEVELOPMENT_WORKFLOW.md

IMPLEMENTATION_STRATEGY.md

NEXT_STEPS.md

OPEN_QUESTIONS.md
```

Nenhum código deve existir nesta pasta.

---

# knowledge

Representa a Knowledge Layer.

Contém toda documentação do projeto.

Inclui:

- arquitetura
- domínio
- agentes
- padrões
- ADRs
- segurança
- roadmap

Esta pasta representa a principal fonte de verdade.

---

# apps

Aplicações.

Inicialmente:

```
apps/

web/
```

No futuro:

```
mobile/

desktop/

admin/
```

---

# core

Contém toda lógica central da plataforma.

Estrutura:

```
core/

execution-engine/

orchestrator/

knowledge-loader/

prompt-builder/

agent-runner/

response-validator/

artifact-generator/

ai-provider/
```

---

## Execution Engine

Responsável por iniciar e controlar execuções.

---

## Orchestrator

Coordena o pipeline.

Nunca conversa diretamente com a OpenAI.

---

## Knowledge Loader

Autoriza, indexa, seleciona e carrega apenas o conhecimento necessário.

Estrutura inicial:

```text
knowledge-loader/

knowledge-manifest.json

contracts.ts

schemas.ts

knowledge-source.ts

knowledge-loader.ts

filesystem/

testing/
```

O manifesto é declarativo e validado por Zod. IDs documentais são explícitos e independentes dos nomes físicos. `KnowledgeSource` mantém consumidores desacoplados do filesystem.

O módulo produz contexto íntegro e rastreável, com orçamento configurável. Não monta prompts, executa agentes, coordena o pipeline, persiste dados, resume conteúdo ou utiliza IA, embeddings, RAG e busca semântica.

---

## Prompt Builder

Transforma estruturas prontas em um `PromptResult` determinístico.

Estrutura inicial:

```text
prompt-builder/

package.json

canonical-json.ts

contracts.ts

context-injector.ts

errors.ts

hashing.ts

immutability.ts

index.ts

prompt-assembler.ts

prompt-budget.ts

prompt-builder.ts

prompt-comparator.ts

prompt-renderer.ts

prompt-template.ts

schemas.ts

variable-resolver.ts

testing/prompt-fixtures.ts

*.spec.ts
```

O prompt segue a hierarquia conceitual imutável `PromptDocument → PromptSection → PromptBlock → PromptFragment`, representada concretamente por `PromptTemplate` antes da resolução e por `ResolvedPromptDocument` depois dela. Seções declaram os canais semânticos `INSTRUCTIONS` ou `INPUT`; o renderer produz os textos separados `instructions` e `input`.

A transformação é pura e sem I/O de domínio ou acesso a recursos externos; o logger estruturado injetável é sua única saída lateral. O módulo não lê `agents/`, `prompts/` ou `knowledge/`, não carrega assets, não seleciona versões e não conhece AI Provider, Agent Runner, Orchestrator, Knowledge Source, Prisma ou frontend.

---

## Agent Runner

Executa a fronteira genérica entre um prompt estruturado e o AI Provider.

Estrutura inicial:

```text
agent-runner/

package.json

agent-runner.ts

contracts.ts

errors.ts

index.ts

response-envelope.ts

schemas.ts

*.spec.ts
```

Único componente de produção autorizado a chamar a interface abstrata de IA.

Seus contratos públicos incluem `PromptRequest`, `AgentRunRequest`, `AgentRunOptions` e `AgentRunResult`. `PromptRequest` pertence ao Runner e não expõe `PromptBuildInput`. O `ResponseEnvelope` que mantém o `AIResponse` validado, sua representação canônica, hash e tamanho é exclusivamente interno.

O módulo é genérico, executa uma única chamada ao provider e não contém regras específicas de agente, retry, timer, persistência ou validação funcional. O timeout é aplicado pelo AI Provider, e o `AbortSignal` recebido é somente encaminhado.

---

## Response Validator

Valida:

- JSON

- Schema

- Segurança

---

## Artifact Generator

Transforma JSON em arquivos.

---

## AI Provider

Abstração provider-neutral com OpenAI como adapter inicial.

Permite múltiplos modelos.

---

# agents

Implementação dos agentes.

Estrutura:

```
product-owner/

developer/

qa/

shared/
```

Cada agente possui:

```
prompt.md

agent.ts

schema.ts

types.ts

README.md

tests/

examples/
```

Essa estrutura é futura. A Sprint 5 não cria agentes, prompts funcionais ou consumers de produção.

---

# prompts

Prompts versionados.

```
shared/

product-owner/

developer/

qa/
```

O Prompt Builder monta o Prompt Final.

Na Sprint 5, esta pasta permanece reservada. Prompt Manifest, assets versionados, loader, selector e registry serão definidos somente quando houver agents e consumers concretos; o Builder recebe estruturas prontas e não acessa esta pasta.

---

# prisma

Contém a configuração local de persistência do MVP.

Desde a Sprint 2 contém:

```text
client.ts
mappers.ts
migrations/
repositories/
tests/
schema.prisma
```

O workspace `@brq/prisma` depende de `@brq/shared`. Nenhum detalhe do Prisma pertence à Shared Layer ou ao `core`.

---

# shared

Código reutilizável.

Estrutura:

```
types/

schemas/

constants/

logger/

utils/

config/

errors/
```

Nenhuma regra específica de agente deve existir aqui.

---

# npm workspaces

O `package.json` da raiz coordena os npm workspaces.

Workspaces implementados:

- `apps/web`;
- `shared`;
- `prisma`;
- `core/ai-provider`;
- `core/knowledge-loader`;
- `core/prompt-builder`;
- `core/agent-runner`.

Cada módulo é registrado como workspace somente quando for implementado pela Sprint correspondente.

---

# Fluxo de Dependências

```
apps

↓

core

↓

agents

↓

shared
```

A camada superior conhece a inferior.

Nunca o contrário.

---

# Regras

## apps

Pode acessar:

- core

- shared

Não acessa diretamente agentes.

---

## core

Pode acessar:

- agents

- prompts

- shared

O Prompt Builder é uma exceção mais restrita dentro de `core`: recebe estruturas prontas e não acessa `agents/`, `prompts/` ou `knowledge/`.

O Agent Runner pode acessar somente as APIs públicas de `core/prompt-builder`, `core/ai-provider` e componentes transversais de `shared`. Não pode importar adapters concretos de provider, OpenAI, Responses API, `agents/`, Orchestrator, Knowledge Loader, `knowledge/`, Prisma ou `apps/`.

---

## agents

Pode acessar:

- shared

Nunca acessa outro agente.

---

## prompts

Não contém código.

Apenas instruções.

---

## knowledge

Nunca depende do código.

O código depende dela.

---

# Convenções

Arquivos:

```
kebab-case
```

Classes:

```
PascalCase
```

Variáveis:

```
camelCase
```

Constantes:

```
UPPER_SNAKE_CASE
```

---

# Crescimento Futuro

A estrutura permite adicionar:

```
workers/

queue/

plugins/

memory/

evaluation/

analytics/

sdk/

cli/

monitoring/
```

Sem alterar os módulos existentes.

---

# Objetivo Final

A estrutura do repositório deve permitir:

- baixo acoplamento;
- alta coesão;
- modularidade;
- escalabilidade;
- reutilização;
- facilidade de navegação;
- implementação por agentes de IA;
- evolução incremental sem refatorações estruturais frequentes.
