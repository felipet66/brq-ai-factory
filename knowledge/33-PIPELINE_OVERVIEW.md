# Pipeline Overview

## Objetivo

Este documento apresenta a visão integrada do pipeline do BRQ AI Factory após a introdução do primeiro agente concreto. Ele mostra o que já existe, como o Product Owner Agent reutiliza componentes genéricos e onde entram Developer Agent, QA Agent e Orchestrator nas Sprints futuras.

As decisões normativas permanecem nos ADRs de cada componente. Para a fronteira específica do primeiro agente, consulte o [ADR-019](ADR/ADR-019-PRODUCT-OWNER-AGENT-BOUNDARY.md) e o [fluxo detalhado do Product Owner Agent](32-PRODUCT_OWNER_AGENT_FLOW.md).

## Visão macro por estágio

```mermaid
flowchart LR
    DEMAND["Demanda"] --> PO["Product Owner Agent<br/>Sprint 9"]
    PO --> POOUT["Especificação funcional<br/>+ drafts"]

    POOUT -.-> DEV["Developer Agent<br/>Sprint 10 — futuro"]
    DEV -.-> DEVOUT["Plano técnico<br/>+ implementação"]
    DEVOUT -.-> QA["QA Agent<br/>Sprint 11 — futuro"]
    QA -.-> QAOUT["Plano de testes<br/>+ relatório"]

    ORCH["Orchestrator<br/>Sprint 12 — futuro"] -.-> PO
    ORCH -.-> DEV
    ORCH -.-> QA
    ORCH -.-> PERSIST["Estados, retries<br/>e persistência"]

    classDef current fill:#d9f2e6,stroke:#1b7f4d,color:#103d29
    classDef future fill:#f2f2f2,stroke:#777,color:#333,stroke-dasharray: 5 5
    class PO,POOUT current
    class DEV,DEVOUT,QA,QAOUT,ORCH,PERSIST future
```

As setas contínuas representam a capacidade entregue pelo primeiro agente. Setas tracejadas representam integração futura; não indicam chamadas existentes na Sprint 9.

## Pipeline reutilizável de uma tentativa

Cada agente concreto reutilizará o mesmo esqueleto, mantendo assets, contratos e Business Validation próprios.

```mermaid
flowchart TD
    ASSETS["Assets confiáveis<br/>e versionados"] --> ASSET_VALIDATION["Factory: validação e hashes"]
    ASSET_VALIDATION --> FACADE["Fachada pronta"]
    REQUEST["Request do agente"] --> REQUEST_VALIDATION["Validação da fronteira"]
    FACADE --> REQUEST_VALIDATION
    REQUEST_VALIDATION --> KNOWLEDGE["Knowledge Loader<br/>contexto lógico do agente"]
    KNOWLEDGE --> CONTEXT["Projetar PromptContextInput<br/>UNTRUSTED"]
    CONTEXT --> PREPARE
    PREPARE --> RUNNER_IN["Agent Runner<br/>recebe AgentRunRequest"]
    RUNNER_IN --> PROMPT_BUILDER["Prompt Builder<br/>injetado no Runner"]
    PROMPT_BUILDER --> RUNNER_CALL["Agent Runner<br/>mapeia AIRequest"]
    RUNNER_CALL --> PROVIDER["AI Provider abstrato"]
    PROVIDER --> RUNRESULT["AgentRunResult"]
    RUNRESULT --> VALIDATOR["Response Validator genérico"]
    VALIDATOR --> DECISION{"valid?"}
    DECISION -->|"não"| REJECTED["VALIDATION_REJECTED"]
    DECISION -->|"sim"| ACCEPTED["ValidationResult aceito"]
    ACCEPTED --> BUSINESS["Business Validation<br/>específica do agente"]
    BUSINESS --> BUSINESS_DECISION{"valid?"}
    BUSINESS_DECISION -->|"não"| BUSINESS_REJECTED["VALIDATION_REJECTED<br/>rejectedAt BUSINESS_VALIDATION"]
    BUSINESS_DECISION -->|"sim"| GENERATOR["Artifact Generator"]
    ACCEPTED --> GENERATOR
    ARTIFACT_SPEC["ArtifactSpecification confiável"] --> GENERATOR
    GENERATOR --> DRAFTS["3 ArtifactDrafts em memória"]
    DRAFTS --> RESULT["Resultado imutável da tentativa"]
```

O Response Validator não recebe regras específicas de Product Owner, Developer ou QA. A Business Validation existe depois da validação genérica para verificar invariantes de domínio e derivar classificações como readiness, sem corrigir a resposta. Sua rejeição também é funcional: produz `VALIDATION_REJECTED` com `rejectedAt: BUSINESS_VALIDATION`, não exception técnica.

## Implementação atual do Product Owner

```mermaid
sequenceDiagram
    autonumber
    participant C as Consumer futuro
    participant PO as ProductOwnerAgent
    participant K as Knowledge Loader
    participant R as Agent Runner
    participant P as Prompt Builder interno
    participant AI as AI Provider
    participant V as Response Validator
    participant B as Business Validation PO
    participant A as Artifact Generator

    C->>PO: createProductOwnerAgent(dependências, assets)
    PO->>PO: validar dependências, IDs, versões e hashes
    PO-->>C: fachada pronta
    C->>PO: executar uma tentativa
    PO->>K: contexto PRODUCT_OWNER
    K-->>PO: KnowledgeContext
    PO->>R: AgentRunRequest + signal
    R->>P: build interno
    P-->>R: PromptResult
    R->>AI: uma chamada abstrata
    AI-->>R: resposta normalizada
    R-->>PO: AgentRunResult
    PO->>V: contrato funcional confiável
    V-->>PO: ValidationResult

    alt resposta rejeitada
        PO-->>C: VALIDATION_REJECTED
    else resposta aceita
        PO->>B: validar domínio e derivar readiness
        B-->>PO: valid + expectedReadiness + issues + issuesTruncated
        alt regra de negócio rejeitada
            PO-->>C: VALIDATION_REJECTED (BUSINESS_VALIDATION)
        else regra de negócio aceita
            PO->>A: ValidationResult aceito + ArtifactSpecification
            A-->>PO: story.md + acceptance.md + backlog.json
            PO-->>C: GENERATED
        end
    end
```

O Agent Runner mantém a única chamada ao provider e encapsula o Prompt Builder. A fachada não chama `PromptBuilder.build`, embora possa usar tipos, schemas e hashing canônico exportados pelo entrypoint público do Builder para validar assets.

O JSON Schema inicial evita `$schema` e `uniqueItems` para permanecer no subconjunto de Structured Outputs visado pelos modelos-base suportados pelo adapter. A compatibilidade de modelos fine-tuned deve ser verificada explicitamente e permanece um risco conhecido.

## Componentes e ownership

| Componente                | Responsabilidade atual                                                 | Não faz                                                  |
| ------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Knowledge Loader          | autoriza, seleciona, carrega e verifica documentos                     | não monta prompt                                         |
| Prompt Builder            | resolve AST, canais, orçamento, rendering e hashes                     | não conhece agente nem chama provider                    |
| Agent Runner              | constrói prompt via Builder e executa uma chamada ao provider          | não valida função, não retenta e não persiste            |
| AI Provider               | chama modelo e normaliza resposta                                      | não conhece workflow                                     |
| Response Validator        | valida finish reason, JSON, schema e structured output                 | não contém regras específicas do agente                  |
| Business Validation       | valida invariantes do domínio do agente e deriva readiness             | não corrige resposta nem muda estado                     |
| Artifact Generator        | resolve bindings e produz drafts determinísticos                       | não escolhe specification, não grava e não versiona      |
| Product Owner Agent       | compõe uma tentativa usando APIs públicas e assets PO                  | não coordena outro agente, retry, estado ou persistência |
| Developer Agent — futuro  | transformará especificação funcional em resultado técnico              | não existe na Sprint 9                                   |
| QA Agent — futuro         | avaliará especificação e implementação                                 | não existe na Sprint 9                                   |
| Orchestrator — futuro     | coordenará ordem, estados, retries, revisão, provenance e persistência | não está antecipado pelo Product Owner Agent             |
| Execution Engine — futuro | iniciará, acompanhará e encerrará uma Execution completa               | não chama IA diretamente                                 |

## Contratos entre fronteiras

```mermaid
flowchart LR
    K["KnowledgeContext"] --> PC["PromptContextInput"]
    PC --> ARR["AgentRunRequest"]
    ARR --> ARR2["AgentRunResult"]
    ARR2 --> VR["ValidationResult"]
    VR --> BVR["BusinessValidationResult<br/>issues + issuesTruncated"]
    BVR --> PS["Specification funcional tipada"]
    VR -->|"aceito após gate de negócio"| AGR["ArtifactGenerationResult"]
    ASPEC2["ArtifactSpecification"] --> AGR
    PS --> PAD["ProductOwnerAgentResult"]
    AGR --> PAD

    PAD -.->|"futuro"| CREATE["ArtifactCreateInput"]
    CREATE -.->|"futuro"| ARTIFACT["Artifact persistido"]
```

Cada seta representa uma transformação explícita e validada. Nenhum componente compartilha objetos internos para contornar a API pública da etapa anterior.

## Trust boundaries do pipeline

```mermaid
flowchart TB
    subgraph TRUSTED["Configuração confiável, ainda validada"]
        ASSETS["assets versionados"]
        RULES["regras"]
        CONTRACTS["output + validation contracts"]
        ARTIFACTSPEC["artifact specification"]
    end

    subgraph UNTRUSTED["Conteúdo não confiável"]
        DEMAND2["demanda"]
        KNOWLEDGE2["knowledge content"]
        RESPONSE2["resposta do modelo"]
        DRAFT2["conteúdo dos drafts"]
    end

    ASSETS --> INSTRUCTIONS["INSTRUCTIONS"]
    RULES --> INSTRUCTIONS
    CONTRACTS --> INSTRUCTIONS
    DEMAND2 --> INPUT["INPUT"]
    KNOWLEDGE2 --> INPUT
    INSTRUCTIONS --> MODEL["modelo"]
    INPUT --> MODEL
    MODEL --> RESPONSE2
    RESPONSE2 --> RESPONSE_VALIDATION["Response Validation"]
    RESPONSE_VALIDATION --> BUSINESS_VALIDATION["Business Validation"]
    ARTIFACTSPEC --> GENERATION["geração determinística"]
    RESPONSE_VALIDATION -->|"ValidationResult aceito"| GENERATION
    BUSINESS_VALIDATION -->|"gate válido"| GENERATION
    GENERATION --> DRAFT2

    DRAFT2 -.->|"futuro: escape do destino"| UI["apresentação"]
    DRAFT2 -.->|"não permitido no MVP"| EXECUTION["execução automática"]
```

`valid: true` significa aderência aos contratos configurados, não segurança universal. Conteúdo validado continua sujeito a escape de apresentação, revisão humana e políticas do destino.

## Linhagem e auditoria

```mermaid
flowchart LR
    PAYLOAD["instructions + input renderizados<br/>+ output contract"] --> PROMPTHASH["promptHash"]
    ASSETHASH["asset hashes + bundleHash"] --> AUDIT["metadados de auditoria"]
    KNOWHASH["contextHash"] --> AUDIT
    PROMPTHASH --> RESPONSEHASH["responseHash"]
    RESPONSEHASH --> VALIDATIONHASH["validationHash"]
    VALIDATIONHASH --> GENERATIONHASH["generationHash"]
    PROMPTHASH --> AUDIT
    GENERATIONHASH --> AUDIT
    GENERATIONHASH -.->|"futuro"| PROVENANCE["provenance persistida"]
```

Metadados da tentativa preservam as identidades e versões do agente, assets, prompt e contratos, além dos hashes produzidos por cada fronteira. `bundleHash` e hashes de assets pertencem à trilha de auditoria; eles não são concatenados diretamente no cálculo de `promptHash`, que identifica o payload efetivo. A política exata para persistir hashes de geração continua uma decisão futura já registrada como questão aberta.

## Outcomes, readiness e estados

```mermaid
flowchart TD
    ATTEMPT["Tentativa PO"] --> VALID{"ValidationResult.valid"}
    VALID -->|"false"| REJECT["outcome=VALIDATION_REJECTED"]
    VALID -->|"true"| BUSINESS_VALID{"Business Validation valid"}
    BUSINESS_VALID -->|"false"| BUSINESS_REJECT["outcome=VALIDATION_REJECTED<br/>rejectedAt=BUSINESS_VALIDATION"]
    BUSINESS_VALID -->|"true"| QUESTIONS{"Pergunta BLOCKING?"}
    QUESTIONS -->|"sim"| CLARIFY2["readiness=REQUIRES_CLARIFICATION"]
    QUESTIONS -->|"não"| PENDING{"Pergunta NON_BLOCKING<br/>ou premissa pendente?"}
    PENDING -->|"sim"| PARTIAL2["readiness=PARTIALLY_READY"]
    PENDING -->|"não"| READY2["readiness=READY"]
    READY2 --> GENERATED["outcome=GENERATED"]
    PARTIAL2 --> GENERATED
    CLARIFY2 --> GENERATED

    REJECT -.-> ORCHDECISION["Orchestrator futuro decide estado/retry"]
    BUSINESS_REJECT -.-> ORCHDECISION
    GENERATED -.-> ORCHDECISION
```

Outcome e readiness não alteram `ExecutionStatus` ou `AgentExecutionStatus`. Uma `AgentExecution` e seu número de tentativa serão criados e persistidos pelo fluxo futuro, não pela fachada do agente.

## Pipeline futuro com três agentes

```mermaid
sequenceDiagram
    participant E as Execution Engine futuro
    participant O as Orchestrator futuro
    participant PO as Product Owner Agent
    participant D as Developer Agent futuro
    participant Q as QA Agent futuro
    participant DB as Persistence

    E->>O: iniciar Execution
    O->>O: criar tentativa PO e marcar estado
    O->>PO: executar request PO
    PO-->>O: resultado PO
    O->>O: decidir revisão, falha ou continuidade
    O->>DB: enriquecer e persistir artifacts PO

    alt PO apto a continuar
        O->>O: construir input Developer a partir de dados validados
        O->>D: executar request Developer
        D-->>O: resultado Developer
        O->>DB: persistir artifacts Developer
    else revisão ou falha
        O->>O: interromper pipeline
    end

    alt Developer apto a continuar
        O->>O: construir input QA a partir de dados validados
        O->>Q: executar request QA
        Q-->>O: resultado QA
        O->>DB: persistir artifacts QA
    else revisão ou falha
        O->>O: interromper pipeline
    end

    O-->>E: estado final
```

Esse diagrama é deliberadamente futuro. Na Sprint 9 não existem chamadas a Developer, QA, Orchestrator, Execution Engine ou Persistence.

## Retry e revisão humana futuros

```mermaid
flowchart LR
    RESULT3["Resultado de uma tentativa"] --> POLICY["Orchestrator futuro"]
    POLICY -->|"sucesso"| NEXTAGENT["próximo agente"]
    POLICY -->|"falha retryable"| NEWATTEMPT["nova AgentExecution<br/>attempt + 1"]
    POLICY -->|"ambiguidade/risco"| REVIEW["REQUIRES_REVIEW<br/>resolução humana auditável"]
    POLICY -->|"falha terminal"| STOP["encerrar Execution"]

    NEWATTEMPT -.->|"nunca reutiliza"| OLD["tentativa encerrada"]
```

Agentes e componentes genéricos apenas reportam resultados ou erros. Eles não aplicam essa política.

## Observabilidade por nível

```text
Componente genérico
├── knowledge.context.*
├── prompt.build.*
├── ai.request.*
├── agent.run.*
├── response.validation.*
└── artifact.generation.*

Fachada do agente
└── product_owner.*

Workflow futuro
├── execution.*
├── agent.execution.*
├── artifact.created
└── artifact.versioned
```

Os níveis não são equivalentes. `product_owner.agent.completed` informa apenas que a tentativa em memória terminou. Não afirma que um estado foi persistido ou que artifacts foram versionados.

## O que não existe na Sprint 9

- Developer Agent e QA Agent;
- sequência multiagente;
- criação ou transição de estados;
- retry funcional;
- revisão humana auditável;
- enriquecimento como `ArtifactCreateInput`;
- persistência ou versionamento de artifacts;
- API, frontend ou deploy;
- execução de código ou exportação de arquivos;
- seleção dinâmica, registry global ou hot reload de prompts;
- avaliação semântica por outro modelo.

## Resumo para onboarding

```text
Componentes genéricos e independentes
                ↓
Product Owner Agent compõe uma tentativa
                ↓
Specification funcional + 3 drafts em memória
                ↓
Developer e QA ainda futuros
                ↓
Orchestrator futuro controla workflow, estado, retry e persistência
```

Ao diagnosticar o pipeline, identifique primeiro o nível do evento e o contrato em mãos. Um `ProductOwnerAgentResult` ainda não é uma Execution concluída, um artifact persistido nem autorização para iniciar automaticamente o próximo agente.
