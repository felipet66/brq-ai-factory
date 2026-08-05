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

Carrega apenas o conhecimento necessário.

---

## Prompt Builder

Monta o prompt final.

---

## Agent Runner

Executa agentes.

Único componente autorizado a chamar IA.

É genérico e não contém regras específicas de um agente.

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

Abstração da OpenAI.

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
- `core/ai-provider`.

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
