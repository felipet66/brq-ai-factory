# Agent Runner Flow

## Objetivo

Este documento apresenta visualmente o fluxo do Agent Runner implementado na Sprint 6.

Ele serve como material de onboarding. O [ADR-016](ADR/ADR-016-AGENT-RUNNER-BOUNDARY.md) é a decisão normativa; este documento explica como contratos, validações, Prompt Builder, AI Provider, cancelamento, timeout, envelope interno e resultado público trabalham em conjunto.

---

# Fronteira do Módulo

```mermaid
flowchart LR
    CALLER["Consumer futuro"] -->|"AgentRunRequest + AgentRunOptions"| RUNNER["core/agent-runner"]
    RUNNER -->|"mapeamento interno"| BUILDER["PromptBuilder"]
    BUILDER -->|"PromptResult"| RUNNER
    RUNNER -->|"uma AIRequest"| PROVIDER["AIProvider abstrato"]
    PROVIDER -->|"AIResponse normalizado"| RUNNER
    RUNNER -->|"AgentRunResult"| CALLER

    OPENAI["OpenAI / Responses API"] -.->|"não importado"| RUNNER
    VALIDATOR["Response Validator"] -.->|"etapa posterior"| RUNNER
    DB["Prisma / Persistence"] -.->|"sem acesso"| RUNNER
    ORC["Orchestrator"] -.->|"não importado"| RUNNER
```

O Runner é o único componente de produção autorizado a invocar `AIProvider`. Ele depende da interface abstrata injetada, nunca de um adapter concreto.

---

# Contratos de Entrada

```text
AgentRunRequest
├── context: AgentRunContext
│   ├── execution: ExecutionMetadata
│   │   ├── executionId
│   │   ├── agentExecutionId
│   │   ├── agent
│   │   ├── attempt
│   │   └── agentVersion
│   ├── requestId?
│   └── traceId?
├── prompt: PromptRequest
├── model
├── maxOutputTokens?
└── timeoutMs?

AgentRunOptions
└── signal?
```

`agentExecutionId` é obrigatório e acompanha toda a invocação. O Runner não cria a entidade, não incrementa `attempt` e não altera estado.

`PromptRequest` é um contrato público próprio:

```text
PromptRequest
├── template
├── ruleSets
├── contexts
├── variables
├── constraints
├── outputContract
└── maxBytes?
```

Ele não expõe `PromptBuildInput`. A semelhança estrutural é intencional, mas a conversão permanece dentro do Runner para que a API pública não fique acoplada a um tipo de entrada interno do Prompt Builder.

---

# Sequência Completa

```mermaid
sequenceDiagram
    autonumber
    participant C as Consumer futuro
    participant R as Agent Runner
    participant V as Schemas do Runner
    participant PB as Prompt Builder
    participant AP as AIProvider
    participant E as ResponseEnvelope interno

    C->>R: run(AgentRunRequest, AgentRunOptions)
    R->>V: validar request e opções técnicas
    V-->>R: contratos normalizados
    R->>R: registrar agent.run.started
    R->>PB: build(entrada estrutural mapeada, maxBytes)
    PB-->>R: PromptResult imutável
    R->>V: validar resultado técnico do prompt
    V-->>R: PromptResult válido
    R->>R: medir build e registrar prompt.completed
    R->>R: mapear canais e output contract para AIRequest
    R->>AP: generate(AIRequest, signal/timeout/correlation)
    AP-->>R: AIResponse normalizado
    R->>V: validar estrutura técnica da resposta
    V-->>R: AIResponse válido
    R->>E: canonicalizar, medir e calcular responseHash
    E-->>R: envelope interno validado
    R->>R: registrar provider.completed
    R->>R: projetar AgentRunResult
    R->>V: validar resultado público
    V-->>R: AgentRunResult válido
    R->>R: registrar completed
    R-->>C: AgentRunResult
```

Existe exatamente uma chamada a `AIProvider.generate`. Nenhuma etapa do Runner executa retry.

---

# Integração com o Prompt Builder

```mermaid
flowchart TD
    REQUEST["PromptRequest do Runner"] --> MAP["Mapeamento explícito"]
    MAP --> INPUT["Entrada privada do Prompt Builder"]
    INPUT --> PB["PromptBuilder.build"]
    PB --> RESULT["PromptResult validado"]
    RESULT --> INSTRUCTIONS["rendered.instructions"]
    RESULT --> USERINPUT["rendered.input"]
    RESULT --> CONTRACT["outputContract"]
    RESULT --> META["metadata + budget"]

    RESULT -.->|"não muta"| MAPAI["Mapeamento para AIRequest"]
```

O Runner preserva os textos renderizados e a fronteira de confiança entre `instructions` e `input`. Ele não reordena seções, não renderiza a AST novamente e não seleciona templates, regras ou contexto.

---

# Mapeamento para o AI Provider

```mermaid
flowchart LR
    PR["PromptResult"] --> I["AIRequest.instructions"]
    PR --> U["AIRequest.input"]
    MODEL["AgentRunRequest.model"] --> M["AIRequest.model"]
    TOKENS["maxOutputTokens?"] --> T["AIRequest.maxOutputTokens?"]

    OC{"outputContract.format"}
    PR --> OC
    OC -->|"TEXT"| TEXT["responseFormat: text"]
    OC -->|"JSON_SCHEMA"| JSON["responseFormat: json_schema + strict"]
    JSON --> NAME["name = contract_ + 55 chars de outputContractHash"]
```

O nome técnico usa somente caracteres aceitos e possui no máximo 64 caracteres. Ele é derivado do hash, e não do ID livre do contrato, evitando incompatibilidade e colisão por normalização.

As opções encaminhadas ao provider são:

```text
signal     ← AgentRunOptions.signal
timeoutMs  ← AgentRunRequest.timeoutMs
requestId  ← AgentRunContext.requestId
traceId    ← AgentRunContext.traceId
```

O Runner conhece apenas `AIProvider`, `AIRequest`, `AIResponse` e seus schemas públicos. Responses API e adapters concretos permanecem fora da fronteira.

---

# Camadas de Validação

```mermaid
flowchart TD
    A["AgentRunRequest desconhecido"] --> B{"Schema de entrada"}
    B -->|"inválido"| ERR1["Erro técnico do Runner"]
    B -->|"válido"| C["Prompt Builder"]
    C --> D{"PromptResult coerente"}
    D -->|"inválido"| ERR2["Falha técnica de integração"]
    D -->|"válido"| E["AI Provider"]
    E --> F{"AIResponse normalizado"}
    F -->|"inválido"| ERR3["Falha técnica de resposta"]
    F -->|"válido"| G["ResponseEnvelope interno"]
    G --> H{"AgentRunResult coerente"}
    H -->|"inválido"| ERR4["Falha técnica de projeção"]
    H -->|"válido"| OK["Retorno público"]

    OK -.-> NEXT["Response Validator futuro"]
```

Essas validações garantem forma, tipos, limites e coerência técnica. Elas não garantem que:

- `structuredData` obedeça ao output contract funcional;
- a resposta cumpra regras de PO, Developer ou QA;
- o conteúdo seja semanticamente seguro ou correto;
- a resposta possa ser persistida ou convertida em artifact.

O `AgentRunResult` continua sendo entrada não confiável do Response Validator futuro.

---

# ResponseEnvelope Interno

```mermaid
flowchart LR
    RESPONSE["AIResponse validado"] --> CANON["Representação canônica"]
    CANON --> HASH["SHA-256 responseHash"]
    CANON --> SIZE["bytes UTF-8 recebidos"]

    RESPONSE --> ENV["ResponseEnvelope"]
    CANON --> ENV
    HASH --> ENV
    SIZE --> ENV

    ENV --> PROJECT["Projeção"]
    PROJECT --> PUBLIC["AgentRunResult"]
    ENV -.->|"não exportado"| CALLER["Consumer"]
```

O envelope mantém a resposta normalizada somente durante a execução e concentra a preparação determinística da saída. O `AIResponse` bruto não integra o contrato público do Runner.

---

# AgentRunResult

```text
AgentRunResult
├── output
│   ├── content
│   ├── structuredData
│   ├── finishReason
│   └── responseHash
├── prompt
│   ├── metadata
│   └── budget
├── outputContract
├── provider
│   ├── provider
│   ├── requestedModel
│   ├── responseModel
│   └── responseId
└── metrics
    ├── observed
    │   ├── totalDurationMs
    │   ├── promptBuilderDurationMs
    │   ├── providerDurationMs
    │   ├── bytesSent
    │   └── bytesReceived
    └── reported
        ├── durationMs
        ├── attempts
        └── usage
```

`observed` é medido pelo Runner com relógio monotônico. `reported` preserva os valores do `AIResponse`. Diferenças entre as durações são esperadas porque os limites de medição não são os mesmos. Tokens nunca são estimados pelo Runner.

---

# Cancelamento e Timeout

```mermaid
sequenceDiagram
    participant C as Consumer
    participant R as Agent Runner
    participant AP as AIProvider

    C->>R: run(request, signal)
    R->>AP: generate(aiRequest, signal, timeoutMs)

    alt AbortSignal cancelado
        AP-->>R: AIProviderError CANCELLED
        R->>R: registrar agent.run.cancelled
        R-->>C: preservar falha canônica
    else timeout aplicado pelo provider
        AP-->>R: AIProviderError TIMEOUT
        R->>R: registrar agent.run.timed_out
        R-->>C: preservar falha canônica
    else outra falha
        AP-->>R: erro canônico
        R->>R: registrar agent.run.failed
        R-->>C: preservar falha canônica
    end
```

O Runner não cria `AbortController`, não agenda timer e não repete a chamada. O provider é o único responsável por aplicar o timeout técnico. O consumer futuro decide se uma falha deve gerar outra `AgentExecution`.

---

# Eventos e Dados Permitidos

```text
agent.run.started
agent.run.prompt.completed
agent.run.provider.completed
agent.run.completed
agent.run.failed
agent.run.cancelled
agent.run.timed_out
```

Os eventos podem conter somente metadados técnicos aplicáveis:

- executionId, agentExecutionId, agent, attempt e agentVersion;
- requestId e traceId;
- promptId, versões, hashes e orçamento;
- provider, modelo solicitado e respondido, responseId e finish reason;
- durações observadas e reportadas, tentativas, uso e bytes;
- código de erro.

Nunca podem conter:

- `instructions`, `input` ou outras partes do prompt;
- resposta completa, `content` ou `structuredData`;
- valores de variáveis ou contexto;
- API keys, authorization headers, cookies ou segredos;
- JSON Schemas completos.

---

# Dependências

```mermaid
flowchart TD
    RUNNER["@brq/agent-runner"] --> PB["@brq/prompt-builder<br/>API pública"]
    RUNNER --> AP["@brq/ai-provider<br/>API pública"]
    RUNNER --> SHARED["@brq/shared<br/>tipos transversais e logger"]

    RUNNER -.->|"proibido"| OPENAI["@brq/ai-provider/openai"]
    RUNNER -.->|"proibido"| AGENTS["agents/"]
    RUNNER -.->|"proibido"| ORCH["core/orchestrator"]
    RUNNER -.->|"proibido"| KNOWLEDGE["core/knowledge-loader e knowledge/"]
    RUNNER -.->|"proibido"| PRISMA["prisma/"]
    RUNNER -.->|"proibido"| APPS["apps/"]
```

Adapters fake podem ser usados por testes de integração, sem se tornar dependência da implementação de produção. A suíte padrão não realiza chamada real.

---

# Resumo para Onboarding

```text
AgentRunRequest validado
        ↓
PromptRequest mapeado internamente
        ↓
PromptResult determinístico
        ↓
AIRequest provider-neutral
        ↓
uma chamada a AIProvider.generate
        ↓
AIResponse tecnicamente validado
        ↓
ResponseEnvelope interno
        ↓
AgentRunResult público e rastreável
```

Ao depurar o módulo, verifique primeiro `agentExecutionId`, a fase registrada e a origem da métrica. O Runner integra contratos; ele não coordena o pipeline nem interpreta funcionalmente a resposta.
