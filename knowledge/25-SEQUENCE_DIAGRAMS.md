# Sequence Diagrams

## Objetivo

Este documento descreve os principais fluxos de execução do BRQ AI Factory utilizando diagramas Mermaid.

Os diagramas representam o comportamento esperado do sistema.

Toda implementação deve respeitar estes fluxos.

---

# Fluxo Geral

```mermaid
flowchart TD

A[Usuário] --> B[Frontend]

B --> C[API]

C --> D[Execution Engine]

D --> E[Orchestrator]

E --> F[Knowledge Loader]

F --> G[Prompt Builder]

G --> H[Agent Runner]

H --> I[AI Provider]

I --> J[Response Validator]

J --> K[Artifact Generator]

K --> L[Persistence]

L --> M[Frontend]
```

---

# Criação de Projeto

```mermaid
sequenceDiagram

participant U as Usuário
participant F as Frontend
participant API
participant DB

U->>F: Criar Projeto

F->>API: POST /api/projects

API->>DB: Criar Project

DB-->>API: Project

API-->>F: Success

F-->>U: Projeto criado
```

---

# Nova Execução

```mermaid
sequenceDiagram

participant User

participant API

participant Engine

participant Orchestrator

User->>API: Nova Demanda

API->>Engine: createExecution()

Engine->>Orchestrator: start()

Orchestrator-->>Engine: executionId

Engine-->>API: Success

API-->>User: Execution criada
```

---

# Product Owner

```mermaid
sequenceDiagram

participant Orchestrator

participant Knowledge

participant Prompt

participant Runner

participant AI

participant Validator

participant Artifact

participant DB

Orchestrator->>Knowledge: carregar contexto

Knowledge-->>Orchestrator: contexto

Orchestrator->>Prompt: montar prompt

Prompt-->>Orchestrator: prompt final

Orchestrator->>Runner: executar

Runner->>AI: Responses API

AI-->>Runner: resposta

Runner->>Validator: validar

Validator-->>Runner: válido

Runner->>Artifact: gerar artefatos

Artifact->>DB: persistir

DB-->>Orchestrator: sucesso
```

---

# Developer

Mesmo fluxo do Product Owner.

A única diferença é o Prompt.

---

# QA

Mesmo fluxo do Product Owner.

A única diferença é o Prompt.

---

# Pipeline Completo

```mermaid
flowchart LR

PO[Product Owner]

DEV[Developer]

QA

PO --> DEV

DEV --> QA
```

---

# Retry

```mermaid
flowchart TD

A[Resposta]

B{Schema válido?}

C[Persistir]

D[Retry]

E[Falha]

A --> B

B -->|Sim| C

B -->|Não| D

D --> B

D -->|Limite excedido| E
```

---

# Human Review

```mermaid
flowchart TD

A[Resposta]

B{Confiança suficiente?}

C[Continuar]

D[Human Review]

A --> B

B -->|Sim| C

B -->|Não| D
```

---

# Persistência

```mermaid
flowchart TD

Execution

↓

AgentExecution

↓

Artifacts

↓

Logs

↓

PromptVersion
```

---

# Cancelamento

```mermaid
sequenceDiagram

User->>Frontend: Cancelar

Frontend->>API: Cancel

API->>Execution Engine

Execution Engine->>Orchestrator

Orchestrator->>Runner: Abort

Runner-->>Orchestrator

Orchestrator-->>API

API-->>Frontend
```

---

# Erro

```mermaid
flowchart TD

Erro

↓

Log

↓

Retry

↓

Retry Funcionou?

↓

Sim

↓

Continuar

↓

Não

↓

FAILED
```

---

# Estados

```mermaid
stateDiagram-v2

[*] --> CREATED

CREATED --> RUNNING

RUNNING --> SUCCESS

RUNNING --> FAILED

RUNNING --> CANCELLED

FAILED --> RETRY

RETRY --> RUNNING
```
