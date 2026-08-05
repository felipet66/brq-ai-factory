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

K --> KD[ArtifactGenerationResult em memória]

KD --> L[Persistência posterior]

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

participant Runner

participant Prompt

participant Provider

participant Validator

participant Artifact

participant DB

Orchestrator->>Knowledge: carregar contexto

Knowledge-->>Orchestrator: contexto

Orchestrator->>Runner: run(AgentRunRequest)

Runner->>Prompt: build(prompt mapeado)

Prompt-->>Runner: PromptResult

Runner->>Provider: generate(AIRequest abstrato)

Provider-->>Runner: AIResponse normalizado

Runner-->>Orchestrator: AgentRunResult

Orchestrator->>Validator: validate(resultado + contrato)

Validator-->>Orchestrator: ValidationResult

alt resposta válida
    Orchestrator->>Artifact: generate(validação + specification)
    Artifact-->>Orchestrator: ArtifactGenerationResult
    Orchestrator->>Orchestrator: enriquecer drafts
    Orchestrator->>DB: persistir ArtifactCreateInput
    DB-->>Orchestrator: Artifacts versionados
else resposta inválida
    Orchestrator->>Orchestrator: decidir próximo passo
end
```

---

# Developer

```mermaid
sequenceDiagram
    autonumber
    participant Consumer
    participant Developer as Developer Agent
    participant Knowledge as Knowledge Loader
    participant Runner as Agent Runner
    participant Prompt as Prompt Builder
    participant Provider as AI Provider
    participant Validator as Response Validator
    participant Business as Developer Business Validation
    participant Artifact as Artifact Generator

    Consumer->>Developer: execute(ProductOwnerSpecification válida)
    Developer->>Knowledge: load(DEVELOPER)
    Knowledge-->>Developer: contexto dentro do orçamento
    Developer->>Runner: run(AgentRunRequest)
    Runner->>Prompt: build(prompt mapeado)
    Prompt-->>Runner: PromptResult
    Runner->>Provider: generate(AIRequest abstrato)
    Provider-->>Runner: AIResponse normalizada
    Runner-->>Developer: AgentRunResult
    Developer->>Validator: validate(resultado + contrato)
    Validator-->>Developer: ValidationResult

    alt resposta aceita
        Developer->>Business: validar TechnicalSpecification + origem PO
        Business-->>Developer: readiness + issues + cobertura dos AC
        alt Business Validation aceita
            Developer->>Artifact: generate(validação + specification)
            Artifact-->>Developer: 3 ArtifactDrafts
            Developer-->>Consumer: GENERATED
        else Business Validation rejeitada
            Developer-->>Consumer: VALIDATION_REJECTED
        end
    else resposta rejeitada
        Developer-->>Consumer: VALIDATION_REJECTED
    end
```

A fachada atua como arquiteto e encerra a tentativa em memória. Não gera código ou testes, não executa comandos, não persiste artifacts, não altera estados, não retenta e não chama Product Owner, QA ou Orchestrator.

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

CREATED --> CANCELLED

RUNNING --> SUCCESS

RUNNING --> FAILED

RUNNING --> CANCELLED

RUNNING --> REQUIRES_REVIEW

REQUIRES_REVIEW --> RUNNING: resolução humana auditável

REQUIRES_REVIEW --> FAILED

REQUIRES_REVIEW --> CANCELLED

FAILED --> RUNNING: retomada explícita
```

Retries automáticos de agentes não usam `FAILED --> RUNNING` nesta máquina. Cada retry cria uma nova `AgentExecution` em `CREATED`, dentro da mesma `Execution`.
