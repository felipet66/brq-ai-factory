# QA Agent — fluxo e fronteiras

O QA Agent é uma fachada de tentativa única que transforma contratos funcionais e técnicos em uma especificação declarativa de qualidade. O [ADR-021](ADR/ADR-021-QA-AGENT-BOUNDARY.md) é a decisão normativa.

## Fronteira

```mermaid
flowchart LR
    PO["ProductOwnerSpecification"] --> QA["QA Agent"]
    TS["TechnicalSpecification"] --> QA
    QA --> SV["Source Validation"]
    SV --> KL["Knowledge Loader — QA"]
    KL --> CTX["3 contextos INPUT / UNTRUSTED"]
    CTX --> AR["Agent Runner"]
    AR --> RV["Response Validator"]
    RV --> BV["QA Business Validation"]
    BV --> AG["Artifact Generator"]
    AG --> RESULT["QAAgentResult"]
```

O Agent Runner encapsula Prompt Builder e AI Provider. A fachada não chama esses componentes diretamente e não chama outros agentes.

## Sequência de sucesso

```mermaid
sequenceDiagram
    participant C as Caller
    participant Q as QA Agent
    participant K as Knowledge Loader
    participant R as Agent Runner
    participant V as Response Validator
    participant B as QA Business Validation
    participant A as Artifact Generator

    C->>Q: execute(request)
    Q->>Q: validar request e par de fontes
    Q->>K: load(QA)
    K-->>Q: KnowledgeContext
    Q->>Q: projetar 3 contextos não confiáveis
    Q->>R: run(request)
    R-->>Q: AgentRunResult
    Q->>V: validate(result, contract)
    V-->>Q: ValidationResult válido
    Q->>B: validar QASpecification e fontes
    B-->>Q: cobertura e readiness válidos
    Q->>A: generate(validation, specification)
    A-->>Q: 3 drafts
    Q-->>C: GENERATED
```

## Rejeições

```mermaid
flowchart TD
    OUT["Resposta do modelo"] --> RV{"Response Validator válido?"}
    RV -- "não" --> RR["VALIDATION_REJECTED / RESPONSE_VALIDATION"]
    RV -- "sim" --> BV{"Business Validation válida?"}
    BV -- "não" --> BR["VALIDATION_REJECTED / BUSINESS_VALIDATION"]
    BV -- "sim" --> ART["Gerar drafts"]
```

Nenhum artifact é gerado nas duas rejeições. Request inválido, fontes incompatíveis e falhas de infraestrutura produzem erros classificados.

## Contextos

| Ordem | ID                                       | Kind        | Serialização | Trust       |
| ----- | ---------------------------------------- | ----------- | ------------ | ----------- |
| 1     | `context:qa-knowledge`                   | `KNOWLEDGE` | `TEXT`       | `UNTRUSTED` |
| 2     | `context:qa-product-owner-specification` | `ARTIFACT`  | `JSON`       | `UNTRUSTED` |
| 3     | `context:qa-technical-specification`     | `ARTIFACT`  | `JSON`       | `UNTRUSTED` |

## Cobertura obrigatória

```mermaid
flowchart LR
    AC["Acceptance Criteria — AC"] --> SC["Cenários"]
    BR["Business Rules — BR"] --> SC
    DEC["Technical Decisions — DEC"] --> SC
    DOD["Definition of Done — DOD"] --> SC
    SC --> MAP["Mapas de cobertura"]
    MAP --> MATRIX["Matriz de rastreabilidade"]
    MATRIX --> SUMMARY["Totais recalculados"]
```

Cada fonte obrigatória deve aparecer nas três projeções: cenário, mapa e matriz.

## Readiness

```mermaid
flowchart TD
    START["Duas fontes + QA Specification"] --> BLOCK{"Fonte requer esclarecimento, dúvida bloqueante ou blocker?"}
    BLOCK -- "sim" --> RC["REQUIRES_CLARIFICATION"]
    BLOCK -- "não" --> PART{"Fonte parcial, dúvida aberta ou premissa pendente?"}
    PART -- "sim" --> PR["PARTIALLY_READY"]
    PART -- "não" --> READY["READY"]
```

Readiness não é evidência de teste executado.

## Hashes e artifacts

Os hashes canônicos cobrem assets, bundle, prompt, resposta, validação, as duas fontes e a geração. Timestamps, duração e usage não participam dos hashes determinísticos.

Artifacts canônicos:

1. `test-plan.md`;
2. `traceability-matrix.json`;
3. `qa-specification.md`.

Não são produzidos código, Playwright, relatório de execução ou defeitos baseados em teste executado.
