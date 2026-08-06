# Response Validator Flow

## Objetivo

Este documento apresenta visualmente o Response Validator implementado na Sprint 7.

Ele serve como material de onboarding. O [ADR-017](ADR/ADR-017-RESPONSE-VALIDATOR-BOUNDARY.md) é a decisão normativa; este documento explica como request, contrato funcional, finish reason, conteúdo, JSON Schema, structured output, report interno e resultado público trabalham em conjunto.

---

# Fronteira do Módulo

```mermaid
flowchart LR
    CALLER["Consumer futuro"] -->|"ValidationRequest"| VALIDATOR["core/response-validator"]
    VALIDATOR -->|"ValidationResult imutável"| CALLER

    RUN_RESULT["AgentRunResult<br/>não confiável"] --> VALIDATOR
    CONTRACT["ValidationContract<br/>configuração server-side"] --> VALIDATOR

    RUNNER["Agent Runner"] -.->|"somente contrato público"| RUN_RESULT
    PROVIDER["AI Provider"] -.->|"sem acesso"| VALIDATOR
    PROMPT["Prompt Builder"] -.->|"sem acesso"| VALIDATOR
    ORCHESTRATOR["Orchestrator"] -.->|"consumer posterior"| VALIDATOR
    ARTIFACT["Artifact Generator"] -.->|"consumer posterior<br/>sem chamada reversa"| VALIDATOR
    DB["Persistence"] -.->|"sem acesso"| VALIDATOR
```

O Validator recebe o resultado público do Runner; ele não pode importar ou reconstruir o `ResponseEnvelope` interno. Também não chama o Runner nem qualquer provider.

Quando `valid: true`, um consumer futuro pode combinar este resultado com uma `ArtifactSpecification` e chamar o Artifact Generator. O Validator não seleciona essa specification e não chama o Generator. A integração visual entre as fronteiras está em [Artifact Generator Flow](30-ARTIFACT_GENERATOR_FLOW.md) e [Artifact Lifecycle](31-ARTIFACT_LIFECYCLE.md).

---

# Contratos Públicos

```text
ValidationRequest
├── runResult: AgentRunResult
└── contract: ValidationContract

ValidationContract
├── id
├── version
├── expectedOutputContractHash
├── format: TEXT | JSON_SCHEMA
├── dialect?                       # DRAFT_2020_12 em JSON_SCHEMA
└── schema?                        # somente JSON_SCHEMA

ValidationResult
├── valid
├── validatedOutput                # TEXT, JSON_SCHEMA ou null
├── issues[]
└── metadata
    ├── contract                   # identidade, formato e contractHash
    ├── source                     # IDs, provider, hashes e finishReason
    ├── contentHash
    ├── schemaHash?
    ├── validatedValueHash?
    ├── validationHash
    └── issuesTruncated
```

O contrato funcional não contém callbacks nem regras específicas de agente. Ele é declarativo, versionado, validável e auditável. `expectedOutputContractHash` vincula a validação ao contrato usado na construção do prompt. Product Owner, Developer e QA fornecem schemas próprios fora deste módulo.

---

# Pipeline Completa

```mermaid
flowchart TD
    REQUEST["ValidationRequest"] --> REQUEST_VALIDATION{"Request válida?"}
    REQUEST_VALIDATION -->|"não"| TECHNICAL_ERROR["ResponseValidatorError técnico"]
    REQUEST_VALIDATION -->|"sim"| CONTRACT["Validar coerência do contrato"]
    CONTRACT --> CONTRACT_MATCH{"Hash, identidade e formato correspondem ao AgentRunResult?"}
    CONTRACT_MATCH -->|"não"| TECHNICAL_ERROR
    CONTRACT_MATCH -->|"sim"| FINISH["Classificar finish reason"]
    FINISH --> FINISH_OK{"COMPLETED?"}
    FINISH_OK -->|"não"| REPORT["ValidationReport interno"]
    FINISH_OK -->|"sim"| CONTENT["Validar presença do conteúdo"]
    CONTENT --> FORMAT{"Formato esperado"}
    FORMAT -->|"TEXT"| TEXT["Validar texto sem modificá-lo"]
    FORMAT -->|"JSON_SCHEMA"| JSON["Interpretar JSON novamente"]
    JSON --> SCHEMA["Validar valor contra o schema"]
    SCHEMA --> STRUCTURED["Verificar structuredData"]
    TEXT --> REPORT
    STRUCTURED --> REPORT
    REPORT --> PROJECT["Projetar resultado público"]
    PROJECT --> RESULT["ValidationResult imutável"]
```

A pipeline não corrige conteúdo e não tenta caminhos alternativos para transformar uma falha em sucesso. Findings são acumulados em ordem estável e projetados uma única vez.

Os estágios técnicos são `REQUEST`, `CONTRACT`, `CONTENT`, `SCHEMA`, `STRUCTURED_OUTPUT` e `RESULT`. Somente configuração, request, contrato ou falha interna inválidos lançam `ResponseValidatorError`, com os códigos `RESPONSE_VALIDATOR_INVALID_CONFIGURATION`, `RESPONSE_VALIDATOR_INVALID_REQUEST`, `RESPONSE_VALIDATOR_INVALID_CONTRACT` ou `RESPONSE_VALIDATOR_INTERNAL_ERROR`.

---

# Sequência Completa

```mermaid
sequenceDiagram
    autonumber
    participant C as Consumer futuro
    participant RV as Response Validator
    participant VS as Schemas do Validator
    participant VP as ValidationPipeline
    participant JS as JSON Schema Validator
    participant VR as ValidationReport interno

    C->>RV: validate(ValidationRequest)
    RV->>VS: validar request e contrato
    VS-->>RV: contratos normalizados
    RV->>RV: registrar response.validation.started
    RV->>VP: executar validação determinística
    VP->>VP: verificar coerência do contrato
    VP->>VP: classificar finish reason
    VP->>VP: verificar conteúdo e formato

    alt formato TEXT e COMPLETED
        VP->>VP: preservar texto exato
    else formato JSON_SCHEMA e COMPLETED
        VP->>VP: JSON.parse do conteúdo original
        VP->>JS: validar valor reinterpretado
        JS-->>VP: findings de schema sanitizados
        VP->>VP: comparar com structuredData
    else finish reason não concluído
        VP->>VP: registrar issue terminal
    end

    VP->>VR: consolidar findings e hashes
    VR-->>RV: report interno
    RV->>RV: projetar e congelar ValidationResult
    RV->>RV: registrar accepted ou rejected
    RV-->>C: ValidationResult
```

`ValidationReport` existe somente dentro do módulo. Ele permite separar coleta de findings da API pública e prepara a evolução da pipeline sem expor detalhes internos.

---

# Finish Reasons

```mermaid
flowchart TD
    FINISH["finishReason"] --> KIND{"Valor"}
    KIND -->|"COMPLETED"| CONTINUE["Continuar para conteúdo"]
    KIND -->|"MAX_OUTPUT_TOKENS"| TRUNCATED["ERROR: saída truncada"]
    KIND -->|"CONTENT_FILTER"| FILTERED["ERROR: conteúdo filtrado"]
    KIND -->|"REFUSAL"| REFUSAL["ERROR: recusa do modelo"]

    TRUNCATED --> REPORT["ValidationReport"]
    FILTERED --> REPORT
    REFUSAL --> REPORT
```

Conteúdo associado a uma saída truncada, filtrada ou recusada é preservado no `AgentRunResult`, mas não é interpretado como candidato válido. O Validator não decide se alguma dessas classificações deve gerar retry ou revisão.

---

# Fluxo TEXT

```mermaid
flowchart LR
    CONTENT["output.content"] --> PRESENT{"Conteúdo presente?"}
    PRESENT -->|"não"| ISSUE["CONTENT_MISSING"]
    PRESENT -->|"sim"| VALUE["Valor textual exato"]
    VALUE --> HASH["validatedValueHash"]
    HASH --> REPORT["ValidationReport"]
    ISSUE --> REPORT
```

O trim pode ser utilizado somente para decidir se existe conteúdo significativo. O texto aceito e seu hash usam a string original, sem normalização.

No formato `TEXT`, `structuredData` não integra o contrato funcional e é ignorado.

---

# Fluxo JSON_SCHEMA

```mermaid
flowchart TD
    RAW["output.content original"] --> PARSE{"JSON.parse"}
    PARSE -->|"falha"| MALFORMED["MALFORMED_JSON"]
    PARSE -->|"sucesso"| VALUE["Valor JSON reinterpretado"]
    VALUE --> SCHEMA{"Draft 2020-12 válido?"}
    SCHEMA -->|"não"| MISMATCH["SCHEMA_MISMATCH"]
    SCHEMA -->|"sim"| STRUCTURED{"structuredData presente?"}
    STRUCTURED -->|"não"| NULL_VALUE{"Valor reinterpretado é null?"}
    NULL_VALUE -->|"sim"| CANDIDATE["Preservar valor reinterpretado como candidato"]
    NULL_VALUE -->|"não"| UNAVAILABLE["WARNING: STRUCTURED_DATA_UNAVAILABLE"]
    UNAVAILABLE --> CANDIDATE
    STRUCTURED -->|"sim"| STRUCTURED_SCHEMA["Revalidar structuredData e acumular issue se necessário"]
    STRUCTURED_SCHEMA --> EQUAL{"Coerente com o valor reinterpretado?"}
    EQUAL -->|"não"| DIFFERENT["STRUCTURED_DATA_MISMATCH"]
    EQUAL -->|"sim"| CANDIDATE

    MALFORMED --> REPORT["ValidationReport"]
    MISMATCH --> REPORT
    DIFFERENT --> REPORT
    CANDIDATE --> REPORT
```

O conteúdo textual é sempre reinterpretado. `structuredData` é uma evidência adicional da normalização do provider, nunca a fonte única da decisão. Quando está ausente, um conteúdo reinterpretado e validado continua suficiente; quando está presente, ele também é revalidado e comparado canonicamente. O schema usa o dialect literal `DRAFT_2020_12` e Ajv 8 em modo estrito; ele não pode aplicar defaults, converter tipos, remover propriedades, resolver referências remotas ou alterar o valor.

---

# Findings, Severidade e Validade

```text
ValidationIssue
├── code
├── category
├── severity: INFO | WARNING | ERROR
├── message segura
├── instancePath?
├── schemaPath?
└── keyword?
```

```mermaid
flowchart LR
    FINDINGS["Findings ordenados"] --> ERRORS["Contar ERROR"]
    FINDINGS --> WARNINGS["Contar WARNING"]
    FINDINGS --> INFO["INFO reservado"]
    ERRORS --> VALID{"errors = 0?"}
    VALID -->|"sim"| ACCEPTED["valid = true"]
    VALID -->|"não"| REJECTED["valid = false"]
```

O enum reserva `INFO` para evolução compatível, mas a pipeline de produção da Sprint 7 emite somente `ERROR` e `WARNING`. Mensagens são controladas pelo módulo; erros crus do engine de JSON Schema e valores do payload não atravessam o contrato.

| Categoria       | Códigos de produção                                                                               | Severidade |
| --------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| `FINISH_REASON` | `FINISH_REASON_MAX_OUTPUT_TOKENS`, `FINISH_REASON_CONTENT_FILTER`, `FINISH_REASON_REFUSAL`        | `ERROR`    |
| `CONTENT`       | `CONTENT_MISSING`, `CONTENT_TOO_LARGE`, `CONTENT_NESTING_TOO_DEEP`                                | `ERROR`    |
| `JSON_SYNTAX`   | `MALFORMED_JSON`                                                                                  | `ERROR`    |
| `SCHEMA`        | `SCHEMA_MISMATCH`                                                                                 | `ERROR`    |
| `INTEGRITY`     | `STRUCTURED_DATA_NESTING_TOO_DEEP`, `STRUCTURED_DATA_SCHEMA_MISMATCH`, `STRUCTURED_DATA_MISMATCH` | `ERROR`    |
| `INTEGRITY`     | `STRUCTURED_DATA_UNAVAILABLE`                                                                     | `WARNING`  |

---

# Limites de Validação

```text
Configuração por instância
├── maxContentBytes    # default 1 MiB
├── maxSchemaBytes     # default 128 KiB
├── maxNestingDepth    # default 100
└── maxIssues          # default 50
```

Cada valor possui também um teto absoluto de schema. Conteúdo excessivo e nesting excessivo produzem issues funcionais. Schema excessivo ou configuração inválida produzem erro técnico. Ao atingir `maxIssues`, a pipeline interrompe a expansão da lista e marca `metadata.issuesTruncated`.

---

# ValidationReport Interno

```mermaid
flowchart LR
    FINISH["Finding de finish reason"] --> REPORT["ValidationReport"]
    CONTENT["Finding de conteúdo"] --> REPORT
    JSON["Finding de JSON"] --> REPORT
    SCHEMA["Findings de schema"] --> REPORT
    STRUCTURED["Finding de consistência"] --> REPORT
    VALUE["Valor validado opcional"] --> REPORT
    HASHES["Hashes calculados"] --> REPORT

    REPORT --> PUBLIC["Projeção"]
    PUBLIC --> RESULT["ValidationResult"]
    REPORT -.->|"não exportado"| CALLER["Consumer"]
```

O report pode carregar detalhes necessários à pipeline sem expandir permanentemente a API pública. A projeção remove dados internos, valida o contrato final e aplica imutabilidade profunda.

---

# Hashes

```mermaid
flowchart TD
    RUNNER["AgentRunResult.output.responseHash"] --> RESPONSE_HASH["responseHash preservado"]
    CONTENT["output.content exato"] --> CONTENT_HASH["SHA-256 contentHash"]
    CONTRACT["ValidationContract canônico"] --> CONTRACT_HASH["SHA-256 contractHash"]
    SCHEMA["JSON Schema canônico"] --> SCHEMA_HASH["SHA-256 schemaHash"]
    VALUE["Valor validado canônico"] --> OUTPUT_HASH["SHA-256 validatedValueHash"]

    RESPONSE_HASH --> DECISION["Payload canônico da decisão"]
    CONTENT_HASH --> DECISION
    CONTRACT_HASH --> DECISION
    SCHEMA_HASH --> DECISION
    OUTPUT_HASH --> DECISION
    ISSUES["Issues públicas ordenadas"] --> DECISION
    DECISION --> VALIDATION_HASH["SHA-256 validationHash"]
```

Os hashes não são intercambiáveis:

- `responseHash` identifica a resposta normalizada pelo Runner e não é recalculado pelo Validator;
- `contentHash` identifica exatamente o texto avaliado;
- `contractHash` identifica as regras funcionais declarativas;
- `schemaHash` identifica separadamente o schema quando o formato é `JSON_SCHEMA`;
- `validatedValueHash` existe somente quando há valor aceito;
- `validationHash` identifica a decisão determinística e não inclui duração, timestamp ou conteúdo bruto.

---

# Trust Boundaries

```mermaid
flowchart LR
    subgraph UNTRUSTED["Zona não confiável"]
        RESULT["AgentRunResult"]
        CONTENT["content"]
        STRUCTURED["structuredData"]
    end

    subgraph TRUSTED_CONFIG["Configuração confiável e validada"]
        CONTRACT["ValidationContract"]
        SCHEMA["JSON Schema local"]
    end

    subgraph VALIDATION["core/response-validator"]
        BOUNDARY["Schemas de fronteira"]
        PIPELINE["ValidationPipeline"]
        REPORT["ValidationReport interno"]
    end

    subgraph OUTPUTS["Saídas controladas"]
        PUBLIC["ValidationResult imutável"]
        LOGS["Logs sanitizados"]
    end

    RESULT --> BOUNDARY
    CONTENT --> PIPELINE
    STRUCTURED --> PIPELINE
    CONTRACT --> BOUNDARY
    SCHEMA --> PIPELINE
    BOUNDARY --> PIPELINE
    PIPELINE --> REPORT
    REPORT --> PUBLIC
    REPORT --> LOGS
```

Mesmo o contrato vindo de configuração server-side é validado antes do uso. Schemas remotos, código, callbacks e extensões mutáveis não atravessam a fronteira.

---

# Logging

```text
response.validation.started
response.validation.accepted
response.validation.rejected
response.validation.failed
```

Os eventos podem conter somente:

- executionId e agentExecutionId;
- requestId e traceId;
- provider e modelo respondido;
- ID, versão, formato e hash do contrato;
- responseHash, contentHash, validatedValueHash e validationHash;
- finish reason, validade, duração e quantidade de issues;
- códigos de issues e indicador de truncamento;
- código de erro técnico.

Nunca podem conter:

- conteúdo ou `structuredData`;
- JSON Schema completo;
- valor validado ou rejeitado;
- mensagens e parâmetros crus do engine de schema;
- prompt, contexto ou regras;
- API keys, authorization headers, cookies ou segredos.

---

# Dependências

```mermaid
flowchart TD
    VALIDATOR["@brq/response-validator"] --> RUNNER["@brq/agent-runner<br/>API pública"]
    VALIDATOR --> SHARED["@brq/shared<br/>tipos e logger"]
    VALIDATOR --> ENGINE["JSON Schema validator"]

    VALIDATOR -.->|"proibido"| RUNNER_INTERNAL["Agent Runner internals"]
    VALIDATOR -.->|"proibido"| PROVIDER["AI Provider / OpenAI"]
    VALIDATOR -.->|"proibido"| PROMPT["Prompt Builder"]
    VALIDATOR -.->|"proibido"| AGENTS["agents/"]
    VALIDATOR -.->|"proibido"| ORCHESTRATOR["Orchestrator"]
    VALIDATOR -.->|"proibido"| ARTIFACT["Artifact Generator"]
    VALIDATOR -.->|"proibido"| PRISMA["Prisma"]
    VALIDATOR -.->|"proibido"| APPS["apps/"]
```

---

# Resumo para Onboarding

```text
ValidationRequest validado
        ↓
Contrato funcional coerente com a execução
        ↓
Finish reason classificado
        ↓
Conteúdo presente
        ↓
TEXT preservado ou JSON reinterpretado
        ↓
Schema e structured output verificados
        ↓
ValidationReport interno
        ↓
ValidationResult público, imutável e rastreável
```

Ao depurar o módulo, verifique primeiro `agentExecutionId`, `finishReason`, o formato do contrato e os códigos das issues. O Validator classifica uma única resposta; ele não corrige, não retenta e não coordena o pipeline.
