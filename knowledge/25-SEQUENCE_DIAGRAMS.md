# Sequence Diagrams

O fluxo multiagente está em [36-ORCHESTRATOR_FLOW.md](36-ORCHESTRATOR_FLOW.md), o ciclo do Engine
em [37-EXECUTION_ENGINE_FLOW.md](37-EXECUTION_ENGINE_FLOW.md) e o adapter HTTP em
[38-HTTP_API_FLOW.md](38-HTTP_API_FLOW.md). O Frontend MVP está em
[39-FRONTEND_FLOW.md](39-FRONTEND_FLOW.md). Persistência, review e retry permanecem futuros.

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

```mermaid
sequenceDiagram
    autonumber
    participant Consumer
    participant QA as QA Agent
    participant Knowledge as Knowledge Loader
    participant Runner as Agent Runner
    participant Validator as Response Validator
    participant Business as QA Business Validation
    participant Artifact as Artifact Generator

    Consumer->>QA: execute(ProductOwnerSpecification, TechnicalSpecification)
    QA->>QA: validar request e compatibilidade das fontes
    QA->>Knowledge: load(QA)
    Knowledge-->>QA: KnowledgeContext
    QA->>Runner: run(AgentRunRequest com 3 contextos)
    Runner-->>QA: AgentRunResult de uma chamada
    QA->>Validator: validate(resultado + contrato)
    Validator-->>QA: ValidationResult

    alt resposta aceita
        QA->>Business: validar QASpecification + duas fontes
        Business-->>QA: readiness + cobertura AC/BR/DEC/DOD
        alt Business Validation aceita
            QA->>Artifact: generate(validação + specification)
            Artifact-->>QA: 3 ArtifactDrafts
            QA-->>Consumer: GENERATED
        else Business Validation rejeitada
            QA-->>Consumer: VALIDATION_REJECTED
        end
    else resposta rejeitada
        QA-->>Consumer: VALIDATION_REJECTED
    end
```

A fachada encerra a tentativa em memória. Não executa testes, não gera código ou Playwright, não persiste artifacts, não retenta e não chama outros agentes ou Orchestrator.

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

## Sequência implementada na Sprint 13

O fluxo atual do Execution Engine, incluindo identidade determinística, estados, integração
pública, falhas e cancelamento, está documentado em
[37-EXECUTION_ENGINE_FLOW.md](37-EXECUTION_ENGINE_FLOW.md). Os diagramas persistentes e de retry
acima permanecem visão futura.

## Sequência implementada na Sprint 14

```mermaid
sequenceDiagram
    actor Client
    participant API as Next.js Route Handler
    participant Engine as Execution Engine
    participant Orchestrator

    Client->>API: POST /api/executions
    API->>API: transport guards + Zod + requestId
    API->>Engine: execute(public ExecutionRequest, same signal)
    Engine->>Orchestrator: execute(public WorkflowRequest)
    Orchestrator-->>Engine: WorkflowResult
    Engine-->>API: ExecutionResult
    API-->>Client: standardized HTTP response
```

A sequência completa, incluindo health, lookup 501, status e trust boundaries, está em
[38-HTTP_API_FLOW.md](38-HTTP_API_FLOW.md).

## Sequência implementada na Sprint 15

```mermaid
sequenceDiagram
    actor User as Usuário
    participant Frontend
    participant Client as execution-client
    participant API as POST /api/executions
    participant Engine as Execution Engine
    participant Workflow

    User->>Frontend: Project Name + Objective
    Frontend->>Client: executeWorkflow(input)
    Client->>API: request HTTP 1.0.0
    API->>Engine: execute(public ExecutionRequest)
    Engine->>Workflow: executar PO → Developer → QA
    Workflow-->>Engine: WorkflowResult
    Engine-->>API: ExecutionResult
    API-->>Client: envelope HTTP
    Client->>Client: projetar ExecutionSummary
    Client-->>Frontend: somente summary
    Frontend-->>User: resultado resumido
```

O resultado bruto não atravessa o client HTTP. A sequência completa e os estados locais estão em
[39-FRONTEND_FLOW.md](39-FRONTEND_FLOW.md).
