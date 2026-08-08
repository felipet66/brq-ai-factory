# Prompt Playground & Agent Debugger Flow

## Objetivo

Documentar o Playground administrativo da Sprint 20 e a fronteira definida pelo
[ADR-030](ADR/ADR-030-PROMPT-PLAYGROUND-BOUNDARY.md). A ferramenta inspeciona a construção real dos
prompts e valida respostas manuais sem executar agentes e sem acessar OpenAI.

Toda informação é transitória: **Inspection data is ephemeral and is not persisted.**

## Playground Architecture

```mermaid
flowchart LR
    ADMIN["ADMIN"] --> PAGE["/playground"]
    PAGE --> CLIENT["Playground HTTP client"]
    CLIENT --> API["ADMIN-only Playground API"]
    API --> RUNTIME["Prompt inspection composition root"]
    RUNTIME --> INSPECTOR["@brq/prompt-inspector"]
    RUNTIME --> ADAPTERS["Fixed PO / Developer / QA adapters"]
    ADAPTERS --> PUBLIC["Public agent assets, projections and validators"]
    INSPECTOR --> KNOWLEDGE["Knowledge Loader"]
    INSPECTOR --> BUILDER["Prompt Builder"]
    INSPECTOR --> VALIDATOR["Response Validator"]

    RUNTIME -. "cannot reach" .-> BLOCKED["Provider / Runner / Orchestrator / Engine / Queue / Worker"]
```

O runtime do Inspector é separado de `apps/web/src/server/runtime.ts`. A aresta pontilhada representa
uma fronteira proibida e protegida por testes de dependência, não uma dependência disponível.

## Prompt Inspection Flow

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant UI as Playground UI
    participant API as Playground API
    participant Inspector as Prompt Inspector
    participant Adapter as Agent inspection adapter
    participant Knowledge as Knowledge Loader
    participant Builder as Prompt Builder

    Admin->>UI: selecionar agente e fornecer input
    UI->>API: POST /api/playground/preview
    API->>Inspector: preview(input, AbortSignal)
    Inspector->>Adapter: validar e projetar input
    Inspector->>Knowledge: load(selection pública)
    Knowledge-->>Inspector: contexto + hashes + bytes
    Inspector->>Adapter: criar request com assets públicos
    Inspector->>Builder: build(request)
    Builder-->>Inspector: PromptResult determinístico
    Inspector-->>API: projeção sanitizada e imutável
    API-->>UI: envelope no-store
    UI-->>Admin: pipeline, prompt, budget, hashes e contrato
```

Nenhum passo chama `AgentRunner`, `AIProvider.generate` ou uma fachada `execute()` de agente.

## Visual Pipeline

```mermaid
flowchart LR
    K["Knowledge"] --> R["Rules"]
    R --> T["Template"]
    T --> RS["Resolution"]
    RS --> RD["Rendering"]
    RD --> B["Budget"]
    B --> C["Contract"]
```

Cada node possui estado textual `IDLE`, `VALID`, `WARNING` ou `ERROR`. Selecionar um node apenas
altera o detalhe exibido no browser; não dispara execução.

## Trust Boundary Flow

```mermaid
flowchart TB
    subgraph TRUSTED["TRUSTED / INSTRUCTIONS"]
        IDENTITY["Agent identity"]
        GLOBAL["Global and security rules"]
        AGENT["Agent rules"]
        CONTRACT["Output contract"]
    end

    subgraph UNTRUSTED["UNTRUSTED / INPUT"]
        KNOWLEDGE["Knowledge context"]
        SPEC["Specifications and constraints"]
        USER["User input"]
    end

    TRUSTED --> BUILDER["Prompt Builder AST"]
    UNTRUSTED --> BUILDER
    BUILDER --> CHANNELS["Separated instructions and input"]
```

Os rótulos são derivados das sections produzidas pelo Prompt Builder. O frontend não reclassifica
conteúdo nem duplica uma política própria.

## Validation Preview Flow

```mermaid
flowchart TD
    MANUAL["Manual or example candidate"] --> RV["Response Validator"]
    RV -->|"PASS"| SCHEMA["JSON Schema projection"]
    RV -->|"FAIL"| STOP1["Remaining stages: NOT_RUN"]
    SCHEMA -->|"PASS"| ZOD["Agent public Zod contract"]
    SCHEMA -->|"FAIL"| STOP2["Remaining stages: NOT_RUN"]
    ZOD -->|"PASS"| BUSINESS["Public Business Validation"]
    ZOD -->|"FAIL"| STOP3["Business Validation: NOT_RUN"]
    BUSINESS --> RESULT["PASS or FAIL + sanitized issues"]
```

`JSON Schema` é a projeção da etapa de schema do Response Validator, e não uma segunda engine. O
conteúdo não é corrigido, truncado ou persistido. O `candidateHash` identifica apenas esse payload
diagnóstico em memória.

## Frontend Interaction

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> BUILDING: Build prompt
    BUILDING --> READY: preview válido
    BUILDING --> ERROR: falha sanitizada
    READY --> VALIDATING: Validate candidate
    VALIDATING --> READY: resultado PASS ou FAIL
    READY --> IDLE: trocar agente
    ERROR --> BUILDING: tentar novamente
```

Trocar o agente ou desmontar a experiência aborta requests pendentes e descarta todo estado
ephemeral. Nada é gravado em storage ou query string.

## Security Boundary

```mermaid
flowchart TD
    REQUEST["Playground request"] --> SESSION{"Authenticated?"}
    SESSION -- "No" --> UNAUTH["401 API / redirect login"]
    SESSION -- "Yes" --> ROLE{"ADMIN?"}
    ROLE -- "No" --> DENIED["403 API / not found page"]
    ROLE -- "Yes" --> HTTP["Origin + media type + byte limit + strict Zod"]
    HTTP --> INSPECT["Ephemeral inspection"]
    INSPECT --> RESPONSE["no-store + security headers"]
    INSPECT -. "never" .-> STORAGE["Repository / Observability / History"]
    INSPECT -. "never" .-> PROVIDER["AI Provider / Agent execution"]
```

Logs usam somente request ID, user ID, agente, bytes, hashes, duração, status e códigos
sanitizados. Prompt, input, Knowledge content, specifications, candidato e output contract completo
permanecem proibidos.

## Dados apresentados

- prompt: instructions e input renderizados;
- budget: bytes de instructions, input e output contract, total, limite e percentual;
- Knowledge: ID, categoria, required/optional, bytes e hash;
- hashes: template, instructions, input, output contract, prompt, rules e Knowledge;
- contrato: formato, versões, propriedades, required, arrays, enums, constraints, hash e JSON
  read-only;
- validação: status por estágio e issues sanitizadas.

Somente um ADMIN recebe prompt e schema completos. Conteúdo documental não integra o Knowledge
Inspector nesta Sprint porque a API pública atual não oferece leitura individual adequada sem
ampliar a fronteira.

## Fora do escopo

Não existem execução, provider selector, edição/versionamento de assets, persistência, histórico de
preview, A/B testing, evaluation framework, prompt registry, streaming, WebSocket, editor Monaco
ou qualquer funcionalidade da Sprint 21.
