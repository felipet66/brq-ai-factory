# Developer Agent Flow

## Objetivo

Este documento apresenta visualmente o Developer Agent da Sprint 10. O agente transforma exclusivamente uma `ProductOwnerSpecification` validada em uma `TechnicalSpecification` declarativa e três `ArtifactDrafts`, sem gerar código ou testes e sem coordenar o workflow.

O [ADR-020](ADR/ADR-020-DEVELOPER-AGENT-BOUNDARY.md) é a decisão normativa. Para entender as fronteiras reutilizadas, consulte também os fluxos do [Agent Runner](28-AGENT_RUNNER_FLOW.md), [Response Validator](29-RESPONSE_VALIDATOR_FLOW.md), [Artifact Generator](30-ARTIFACT_GENERATOR_FLOW.md) e a [visão geral do pipeline](33-PIPELINE_OVERVIEW.md).

## Fronteira do módulo

```mermaid
flowchart LR
    CALLER["Consumer futuro<br/>ProductOwnerSpecification + metadados"] --> DEV["agents/developer<br/>DeveloperAgent"]

    DEV --> KL["Knowledge Loader<br/>API pública"]
    DEV --> AR["Agent Runner<br/>API pública"]
    DEV --> RV["Response Validator<br/>API pública"]
    DEV --> AG["Artifact Generator<br/>API pública"]
    DEV --> PBUTIL["Prompt Builder entrypoint<br/>schemas + hashing canônico"]
    DEV --> POCONTRACT["Product Owner entrypoint<br/>contrato + schema de entrada"]

    AR --> PB["Prompt Builder<br/>injetado no Runner"]
    AR --> AP["AI Provider<br/>injetado no Runner"]
    DEV --> RESULT["DeveloperAgentResult<br/>imutável"]

    DEV -.->|"não executa"| PO["Product Owner Agent"]
    DEV -.->|"não chama"| AP
    DEV -.->|"não acessa"| DB["Prisma / repositories"]
    DEV -.->|"não conhece"| QA["QA Agent"]
    DEV -.->|"futuro"| ORCH["Orchestrator"]
```

O acesso ao pacote do Product Owner serve somente para validar o contrato entregue. Não existe chamada entre fachadas. O acesso ao Prompt Builder é limitado aos contratos públicos e ao hashing canônico; `build` continua encapsulado pelo Agent Runner.

## Contratos conceituais

```text
DeveloperAgentRequest
├── context
│   ├── executionId
│   ├── agentExecutionId
│   ├── attempt
│   ├── agentVersion
│   ├── requestId?
│   └── traceId?
├── productOwnerSpecification
├── model
└── limits?

TechnicalSpecification
├── readiness
├── title, summary, objective
├── complexity + estimatedStoryPoints
├── architecture
├── components + modules + flows
├── contracts + apis + events
├── dataModel
├── internalDependencies + externalDependencies
├── risks
├── implementationPhases + implementationPlan
├── technicalBacklog + definitionOfDone
├── decisions + traceability
└── assumptions + openQuestions + outOfScope

DeveloperAgentResult
├── outcome: GENERATED
│   ├── specification
│   ├── readiness
│   ├── artifacts[3]
│   └── metadata
└── outcome: VALIDATION_REJECTED
    ├── rejectedAt: RESPONSE_VALIDATION | BUSINESS_VALIDATION
    ├── specification: null
    ├── artifacts: []
    ├── validation
    └── metadata
```

O request não aceita prompt, rule sets, output contract, Artifact Specification, filenames ou demanda bruta. Uma `ProductOwnerSpecification` válida é a única entrada funcional; sua própria readiness pode indicar pendências ou necessidade de esclarecimento e participa da derivação da readiness técnica.

## Assets da versão inicial

```mermaid
flowchart TD
    MANIFEST["assets:developer@1.0.0"] --> TEMPLATE["prompt:developer@1.0.0"]
    MANIFEST --> GLOBAL["rules:global-baseline@1.0.0"]
    MANIFEST --> SECURITY["rules:security-baseline@1.0.0"]
    MANIFEST --> RULES["rules:developer@1.0.0"]
    MANIFEST --> CONTRACT["contract:developer-technical-specification@1.0.0"]
    MANIFEST --> ARTIFACTS["artifacts:developer@1.0.0"]

    TEMPLATE --> VERIFY["validar IDs + versões + wiring"]
    GLOBAL --> VERIFY
    SECURITY --> VERIFY
    RULES --> VERIFY
    CONTRACT --> VERIFY
    ARTIFACTS --> VERIFY
    VERIFY --> HASH["hash de cada asset + bundleHash fixado"]
    HASH --> BUNDLE["DeveloperPromptAssets<br/>deep-frozen"]
```

Os assets ficam em `prompts/developer/1.0.0/`. O manifest é declarativo e não seleciona arquivos a partir de conteúdo externo. Alterar qualquer asset sem versionar o bundle causa rejeição na factory.

## Sequência completa — sucesso

```mermaid
sequenceDiagram
    autonumber
    participant C as Consumer
    participant D as DeveloperAgent
    participant K as Knowledge Loader
    participant R as Agent Runner
    participant P as Prompt Builder interno
    participant AI as AI Provider abstrato
    participant V as Response Validator
    participant B as Developer Business Validation
    participant A as Artifact Generator

    C->>D: createDeveloperAgent(dependencies, assets)
    D->>D: validar dependências, IDs, versões e hashes
    D-->>C: facade pronta
    C->>D: execute(request, signal?)
    D->>D: validar request + ProductOwnerSpecification
    D->>K: load({ context: DEVELOPER, limites? })
    K-->>D: KnowledgeContext dentro do orçamento
    D->>D: projetar Knowledge + specification como INPUT/UNTRUSTED
    D->>R: run(AgentRunRequest, { signal })
    R->>P: build(PromptRequest)
    P-->>R: PromptResult
    R->>AI: generate(AIRequest, timeout/signal)
    AI-->>R: AIResponse normalizada
    R-->>D: AgentRunResult
    D->>V: validate(runResult + ValidationContract)
    V-->>D: ValidationResult valid=true
    D->>B: validar TechnicalSpecification contra origem PO
    B-->>D: valid + expectedReadiness + issues
    D->>A: generate(ValidationResult + ArtifactSpecification)
    A-->>D: ArtifactGenerationResult
    D->>D: validar resultado, projetar linhagem e deep-freeze
    D-->>C: GENERATED + specification + 3 drafts
```

O Agent Runner faz exatamente uma chamada abstrata ao provider. A fachada não executa retry e não inicia automaticamente outro agente.

## Trust boundaries

```mermaid
flowchart TB
    subgraph TRUSTED["Configuração server-side confiável, ainda validada"]
        TEMPLATE2["PromptTemplate"]
        RULES2["Rule Sets"]
        OUT["Output + Validation Contract"]
        ASPEC["ArtifactSpecification"]
    end

    subgraph UNTRUSTED["Conteúdo não confiável"]
        KCONTENT["Knowledge content"]
        POSPEC["ProductOwnerSpecification"]
        MODEL["Resposta do modelo"]
        DRAFTS["Conteúdo dos drafts"]
    end

    TEMPLATE2 --> INSTRUCTIONS["INSTRUCTIONS / TRUSTED"]
    RULES2 --> INSTRUCTIONS
    OUT --> INSTRUCTIONS
    KCONTENT --> INPUT["INPUT / UNTRUSTED"]
    POSPEC --> INPUT
    INSTRUCTIONS --> GENERATION["Chamada via Agent Runner"]
    INPUT --> GENERATION
    GENERATION --> MODEL
    MODEL --> RV2["Response Validation"]
    RV2 --> BV2["Developer Business Validation"]
    ASPEC --> ARTIFACTGEN["Artifact Generation"]
    BV2 -->|"gate válido"| ARTIFACTGEN
    RV2 -->|"ValidationResult preservado"| ARTIFACTGEN
    ARTIFACTGEN --> DRAFTS
```

Validação contratual não transforma conteúdo em instrução nem torna a proposta universalmente segura. Drafts continuam sendo dados e exigirão escaping no destino e políticas futuras de revisão.

## Response Validation e Business Validation

```mermaid
flowchart TD
    RUN["AgentRunResult"] --> RESPONSE["Response Validator"]
    RESPONSE --> ROK{"valid?"}
    ROK -->|"não"| RR["VALIDATION_REJECTED<br/>RESPONSE_VALIDATION"]
    ROK -->|"sim"| STRUCTURE["parse estrutural da<br/>TechnicalSpecification"]
    STRUCTURE --> SOK{"estrutura válida?"}
    SOK -->|"não"| BR["VALIDATION_REJECTED<br/>BUSINESS_VALIDATION"]
    SOK -->|"sim"| IDS["IDs + referências + duplicidades"]
    IDS --> GRAPHS["ordem + dependências + ciclos"]
    GRAPHS --> DATA["coerência do modelo de dados"]
    DATA --> COVERAGE["cobertura integral dos Acceptance Criteria"]
    COVERAGE --> READY["readiness + completude"]
    READY --> BOK{"valid?"}
    BOK -->|"não"| BR
    BOK -->|"sim"| GENERATE["Artifact Generator"]
```

O Response Validator continua genérico. Somente a Developer Business Validation conhece IDs funcionais, grafos técnicos, readiness e cobertura de critérios de aceite. Nenhuma etapa corrige a resposta.

## Cobertura dos Acceptance Criteria

```mermaid
flowchart LR
    POAC["ProductOwnerSpecification<br/>acceptanceCriteria: AC-001...AC-n"] --> EXPECTED["conjunto esperado de AC"]
    TRACE["TechnicalSpecification<br/>traceability[].sourceIds"] --> REFERENCES["referências AC / BR / BL"]
    REFERENCES --> KNOWN{"todos os IDs existem<br/>na origem?"}
    KNOWN -->|"não"| UNKNOWN["issue de referência desconhecida"]
    KNOWN -->|"sim"| COVERED["conjunto de AC cobertos"]
    EXPECTED --> DIFF["expected AC − covered AC"]
    COVERED --> DIFF
    DIFF --> EMPTY{"diferença vazia?"}
    EMPTY -->|"não"| MISSING["issue por Acceptance Criterion sem cobertura"]
    EMPTY -->|"sim"| PASS["gate de cobertura aceito"]

    TRACE --> TARGETS{"cada item possui<br/>destino técnico?"}
    TARGETS -->|"não"| NOTARGET["issue de rastreabilidade sem destino"]
    TARGETS -->|"sim"| PASS
```

Cobertura integral significa que todo ID `AC-nnn` da origem aparece em pelo menos um `traceability[].sourceIds`. Isso não avalia qualidade semântica; estabelece uma relação declarativa e verificável para revisão e auditoria.

## Readiness técnica

```mermaid
flowchart TD
    SOURCE{"PO readiness =<br/>REQUIRES_CLARIFICATION?"}
    SOURCE -->|"sim"| CLARIFY["REQUIRES_CLARIFICATION"]
    SOURCE -->|"não"| BLOCKING{"pergunta técnica BLOCKING?"}
    BLOCKING -->|"sim"| CLARIFY
    BLOCKING -->|"não"| PARTIAL_SOURCE{"PO PARTIALLY_READY?"}
    PARTIAL_SOURCE -->|"sim"| PARTIAL["PARTIALLY_READY"]
    PARTIAL_SOURCE -->|"não"| PENDING{"pergunta NON_BLOCKING<br/>ou premissa pendente?"}
    PENDING -->|"sim"| PARTIAL
    PENDING -->|"não"| READY["READY"]
```

A readiness calculada deve coincidir com o valor declarado pela resposta. Divergência é rejeição funcional, nunca correção silenciosa.

## Rendering dos artifacts

```mermaid
flowchart LR
    VALID["ValidationResult valid=true"] --> AG2["Artifact Generator"]
    BV3["Developer Business Validation valid=true"] --> GATE["gate da fachada"]
    GATE --> AG2
    SPEC2["ArtifactSpecification<br/>server-side"] --> AG2

    AG2 --> ARCH["architecture.md<br/>TEXT / text/markdown"]
    AG2 --> PLAN["implementation-plan.md<br/>TEXT / text/markdown"]
    AG2 --> DEC["technical-decisions.json<br/>JSON / application/json"]

    ARCH --> MEMORY["ArtifactDrafts em memória"]
    PLAN --> MEMORY
    DEC --> MEMORY
    MEMORY -.->|"futuro"| REPOSITORY["Artifact Repository<br/>ID + versão + timestamps"]
```

A specification de artifacts controla ordem, nomes, filenames, tipos, media types, bindings e rendering. O modelo não escolhe os artifacts. A fronteira com Repository permanece futura.

## Linhagem e hashes

```mermaid
flowchart LR
    POJSON["ProductOwnerSpecification<br/>JSON canônico"] --> SOURCEHASH["sourceSpecificationHash"]
    KNOWLEDGE["KnowledgeContext"] --> KNOWHASH["contextHash"]
    ASSETS3["assets versionados"] --> BUNDLEHASH["asset hashes + bundleHash"]
    PROMPT["payload renderizado"] --> PROMPTHASH["promptHash"]
    PROMPTHASH --> RESPONSEHASH["responseHash"]
    RESPONSEHASH --> VALIDATIONHASH["validationHash"]
    VALIDATIONHASH --> GENERATIONHASH["generationHash"]

    SOURCEHASH --> AUDIT["DeveloperAgentResult.metadata"]
    KNOWHASH --> AUDIT
    BUNDLEHASH --> AUDIT
    PROMPTHASH --> AUDIT
    GENERATIONHASH --> AUDIT
```

Hashes identificam conteúdo e decisões determinísticas; não são assinatura digital nem prova de qualidade. O resultado também preserva a readiness funcional de origem.

## Cancelamento, timeout e ausência de retry

```mermaid
sequenceDiagram
    participant C as Consumer
    participant D as DeveloperAgent
    participant K as Knowledge Loader
    participant R as Agent Runner
    participant AI as AI Provider

    C->>D: execute(request, signal)
    D->>D: checkpoint de cancelamento
    D->>K: load(DEVELOPER)
    Note over D,K: o contrato atual do Loader não aceita AbortSignal
    K-->>D: contexto ou erro
    D->>D: checkpoint de cancelamento
    D->>R: run(request, mesmo signal)
    R->>AI: generate(signal, timeoutMs)

    alt signal abortado
        AI-->>R: CANCELLED
        R-->>D: AgentRunError CANCELLED
        D-->>C: DeveloperAgentError CANCELLED
    else timeout do provider
        AI-->>R: TIMEOUT
        R-->>D: AgentRunError TIMEOUT
        D-->>C: DeveloperAgentError TIMEOUT
    else rejeição funcional
        R-->>D: AgentRunResult
        D-->>C: VALIDATION_REJECTED
    end
```

O Developer Agent não cria timer, `AbortController`, retry ou nova `AgentExecution`. Retries e continuidade serão decisões do Orchestrator.

## Resumo para onboarding

```text
ProductOwnerSpecification válida
                ↓
KnowledgeContext DEVELOPER dentro de 64 KiB por padrão
                ↓
Knowledge + specification em INPUT/UNTRUSTED
                ↓
Agent Runner — uma chamada
                ↓
Response Validator genérico
                ↓
Developer Business Validation
        ┌───────┴────────┐
        ↓                ↓
rejeição       cobertura integral dos AC
                         ↓
                 Artifact Generator
                         ↓
 architecture.md + implementation-plan.md
          + technical-decisions.json
                         ↓
               outcome=GENERATED
```

Ao depurar, verifique `agentExecutionId`, `sourceSpecificationHash`, `bundleHash`, `contextHash`, `promptHash`, `responseHash`, `validationHash`, readiness, códigos da Business Validation e `generationHash`. Não procure código gerado, estado persistido, retry, chamada ao QA Agent ou coordenação do Orchestrator: essas responsabilidades não pertencem à Sprint 10.
