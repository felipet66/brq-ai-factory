# Artifact Generator Flow

## Objetivo

Este documento apresenta visualmente o Artifact Generator implementado na Sprint 8.

Ele serve como material de onboarding. O [ADR-018](ADR/ADR-018-ARTIFACT-GENERATOR-BOUNDARY.md) é a decisão normativa; este documento explica como resultado validado, specification, bindings, modelo resolvido interno, rendering, drafts, hashes, limites e trust boundaries trabalham em conjunto.

---

# Fronteira do Módulo

```mermaid
flowchart LR
    CALLER["Consumer futuro"] -->|"ArtifactGenerationRequest"| GENERATOR["core/artifact-generator"]
    GENERATOR -->|"ArtifactGenerationResult imutável"| CALLER

    VALIDATION["ValidationResult<br/>valid: true"] --> GENERATOR
    SPECIFICATION["ArtifactSpecification<br/>server-side e declarativa"] --> GENERATOR

    VALIDATOR["Response Validator"] -.->|"somente contrato público"| VALIDATION
    RUNNER["Agent Runner"] -.->|"sem acesso"| GENERATOR
    PROVIDER["AI Provider"] -.->|"sem acesso"| GENERATOR
    AGENTS["Agentes concretos"] -.->|"specifications futuras"| CALLER
    ORCHESTRATOR["Orchestrator"] -.->|"consumer posterior"| GENERATOR
    REPOSITORY["ArtifactRepository / Prisma"] -.->|"sem acesso"| GENERATOR
    FILESYSTEM["Filesystem"] -.->|"sem acesso"| GENERATOR
```

O Generator recebe duas estruturas prontas. Ele não escolhe agente, specification, template ou destino e não busca dados externos. Seu resultado contém drafts em memória, não arquivos físicos nem registros versionados.

---

# Contratos Públicos

```text
ArtifactGenerationRequest
├── validation                    # ValidationResult aceito
└── specification                 # definição declarativa pronta

ArtifactSpecification
├── id
├── version
├── sourceContract
│   ├── id
│   ├── version
│   ├── format
│   └── contractHash
└── templates[]
    └── ArtifactTemplate
        ├── id
        ├── name
        ├── filename              # nome seguro, nunca caminho
        ├── type
        ├── mediaType
        └── formato
            ├── TEXT
            │   ├── bindings[]    # ArtifactBinding { id, path }
            │   └── fragments[]   # LITERAL ou BINDING { bindingId, serialization }
            └── JSON
                ├── bindings[]    # ArtifactBinding { id, path }
                └── rootBindingId # valor JSON completo

ArtifactGenerationResult
├── artifacts[]                   # GeneratedArtifacts imutáveis e ordenados
│   ├── draft                     # ArtifactDraft compartilhado
│   └── metadata                  # formato, mediaType, hashes e bytes
└── metadata
    ├── source
    │   ├── executionId + agentExecutionId
    │   ├── requestId? + traceId?
    │   ├── provider + model + finishReason
    │   ├── promptHash + outputContractHash + responseHash
    │   ├── contractId + contractVersion + contractFormat + contractHash
    │   └── validationHash + validatedValueHash
    ├── specificationId
    ├── specificationVersion
    ├── specificationHash
    ├── artifactCount
    ├── totalBytes
    └── generationHash
```

Esta árvore é conceitual: os schemas públicos são a definição executável dos campos e das variantes declarativas. `ResolvedArtifactModel` não integra o contrato público.

O source validado pode ter formato `TEXT` ou `JSON_SCHEMA`. O `sourceContract` da specification precisa corresponder exatamente a ID, versão, formato e `contractHash` registrados pelo Validator.

Specifications específicas de Product Owner, Developer e QA não pertencem ao módulo genérico e serão criadas somente nas Sprints dos respectivos agentes.

`mediaType` usa uma allowlist coerente com o formato: `TEXT` aceita `text/plain` ou `text/markdown`, e `JSON` exige `application/json`.

---

# Pipeline Completa

```mermaid
flowchart TD
    REQUEST["ArtifactGenerationRequest"] --> REQUEST_SCHEMA{"Request válida?"}
    REQUEST_SCHEMA -->|"não"| CANONICAL_ERROR["ArtifactGeneratorError canônico"]
    REQUEST_SCHEMA -->|"sim"| ELIGIBLE{"ValidationResult aceito<br/>e output presente?"}
    ELIGIBLE -->|"não"| CANONICAL_ERROR
    ELIGIBLE -->|"sim"| SPECIFICATION["Validar specification e limites estruturais"]
    SPECIFICATION --> CONTRACT{"sourceContract corresponde<br/>à validação?"}
    CONTRACT -->|"não"| CANONICAL_ERROR
    CONTRACT -->|"sim"| COLLISION{"IDs e filenames únicos?<br/>Filenames seguros?"}
    COLLISION -->|"não"| CANONICAL_ERROR
    COLLISION -->|"sim"| BINDINGS["Binding Resolution"]
    BINDINGS --> RESOLVED["ResolvedArtifactModel interno"]
    RESOLVED --> RENDER["Rendering determinístico"]
    RENDER --> BUDGET{"Bytes por artifact<br/>e total permitidos?"}
    BUDGET -->|"não"| CANONICAL_ERROR
    BUDGET -->|"sim"| DRAFTS["ArtifactDrafts"]
    DRAFTS --> HASHES["Calcular hashes estruturais e de conteúdo"]
    HASHES --> PROJECT["Projetar e congelar resultado público"]
    PROJECT --> RESULT["ArtifactGenerationResult"]
```

Não existe fallback ou saída parcial. Uma falha em qualquer template encerra a chamada inteira; o módulo não omite drafts, trunca conteúdo nem corrige bindings silenciosamente.

---

# Sequência Completa

```mermaid
sequenceDiagram
    autonumber
    participant C as Consumer futuro
    participant AG as Artifact Generator
    participant S as Schemas de fronteira
    participant BR as Binding Resolver
    participant RM as ResolvedArtifactModel interno
    participant R as Renderer
    participant H as Hashing

    C->>AG: generate(ArtifactGenerationRequest)
    AG->>S: validar request, resultado e specification
    S-->>AG: estruturas clonadas e normalizadas
    AG->>AG: registrar artifact.generation.started

    loop templates na ordem declarada
        AG->>H: calcular templateHash
        H-->>AG: identidade estrutural do template
        AG->>BR: resolver ArtifactBindings
        BR->>RM: montar modelo sem referências pendentes
        RM-->>BR: modelo interno imutável
        BR-->>AG: ResolvedArtifactModel
        AG->>R: renderizar fragments
        R-->>AG: conteúdo textual e bytes UTF-8
        AG->>H: calcular contentHash e draftHash
        H-->>AG: metadados do draft
    end

    AG->>AG: verificar orçamento total
    AG->>H: calcular specificationHash e generationHash
    H-->>AG: hashes finais
    AG->>AG: projetar e congelar ArtifactGenerationResult
    AG->>AG: registrar artifact.generation.completed
    AG-->>C: ArtifactGenerationResult

    Note over AG: Em falha, registra somente metadados sanitizados<br/>e lança ArtifactGeneratorError; não retorna drafts parciais.
```

---

# Fluxo de Resolução de Bindings

```mermaid
flowchart TD
    REFERENCE["bindingId declarado no template"] --> LOOKUP{"ArtifactBinding local existe?"}
    LOOKUP -->|"não"| REFERENCE_ERROR["Falha de specification"]
    LOOKUP -->|"sim"| BINDING["ArtifactBinding { id, path }"]
    BINDING --> PATH["Validar path e limite de segmentos"]
    PATH --> SOURCE["Percorrer somente validatedOutput"]
    SOURCE --> FOUND{"Valor encontrado?"}
    FOUND -->|"não"| ERROR["BINDING_NOT_FOUND"]
    FOUND -->|"sim"| VALUE["Valor resolvido"]
    VALUE --> OPAQUE["Tratar como dado opaco"]
    OPAQUE --> MODEL["ResolvedArtifactModel"]
```

Bindings são locais a cada template. IDs devem ser únicos, toda referência precisa existir e bindings não utilizados são rejeitados, evitando configuração morta ou acoplamento implícito entre artifacts.

O path é um array de segmentos `string | number`; o array vazio seleciona a raiz. Segmentos string acessam somente propriedades próprias de objetos, e segmentos numéricos acessam índices existentes de arrays. Os segmentos `__proto__`, `prototype` e `constructor` são proibidos. Não existe JSON Pointer, JSONPath, expressão, callback ou consulta externa. A resolução não permite que um valor proveniente da resposta altere o path, crie fragments ou escolha o template seguinte.

O `validatedValueHash` recebido é verificado contra o valor aceito antes da geração. Essa verificação preserva a ligação entre a decisão do Validator e os valores lidos pelos bindings.

Templates `TEXT` aceitam fragments `LITERAL` e `BINDING`. O fragment de binding referencia `bindingId` e declara a serialização `TEXT`, `JSON_COMPACT` ou `JSON_PRETTY`; `TEXT` exige que o valor resolvido seja string. Templates `JSON` referenciam um único `rootBindingId` e renderizam o valor inteiro como JSON canônico, indentado e terminado por uma única newline, sem concatenação.

---

# ResolvedArtifactModel Interno

```mermaid
flowchart LR
    TEMPLATE["ArtifactTemplate validado"] --> RESOLUTION["Binding Resolution"]
    VALUES["Valores resolvidos"] --> RESOLUTION
    RESOLUTION --> MODEL["ResolvedArtifactModel<br/>interno e imutável"]
    MODEL --> RENDERER["Renderer"]

    MODEL -.->|"não exportado"| CONSUMER["Consumer"]
    MODEL -.->|"não aceito como input"| PUBLIC_API["API pública"]
```

O modelo interno marca a separação entre localizar dados e produzir texto. O renderer recebe apenas fragments já resolvidos; portanto, não conhece JSON paths nem volta a consultar `ValidationResult`.

---

# Rendering

```mermaid
flowchart LR
    MODEL["ResolvedArtifactModel"] --> FORMAT{"Formato"}
    FORMAT -->|"TEXT"| FRAGMENTS["Concatenar fragments resolvidos<br/>na ordem declarada"]
    FORMAT -->|"JSON"| JSON["Serializar valor como JSON canônico<br/>indentado + newline final"]
    FRAGMENTS --> RENDER["Conteúdo determinístico"]
    JSON --> RENDER
    RENDER --> CONTENT["content exato"]
    CONTENT --> MEASURE["Medir bytes UTF-8"]
    MEASURE --> LIMIT{"Dentro dos limites?"}
    LIMIT -->|"sim"| DRAFT["ArtifactDraft"]
    LIMIT -->|"não"| ERROR["Erro de orçamento"]
```

Rendering é uma transformação textual local. Não há Markdown engine, execução de código, template recursivo, escape específico de UI, escrita de arquivo, resumo ou correção semântica. Escaping de apresentação continua responsabilidade do consumer conforme o destino.

Conteúdo vazio — inclusive apenas whitespace — é rejeitado. O Generator não publica um draft vazio nem tenta preenchê-lo automaticamente.

---

# Hashes

```mermaid
flowchart TD
    VALIDATED["Valor aceito pelo Validator"] --> VALIDATED_HASH["validatedValueHash<br/>preservado e verificado"]
    SPEC["Specification canônica"] --> SPEC_HASH["specificationHash"]
    TEMPLATE["Template canônico"] --> TEMPLATE_HASH["templateHash"]
    CONTENT["Conteúdo renderizado exato"] --> CONTENT_HASH["contentHash"]

    DRAFT["ArtifactDraft canônico<br/>name + filename + type + content"] --> DRAFT_HASH["draftHash"]

    VALIDATION_HASH["validationHash da etapa anterior"] --> GENERATION_PAYLOAD["Resultado ordenado canônico"]
    VALIDATED_HASH --> GENERATION_PAYLOAD
    SPEC_HASH --> GENERATION_PAYLOAD
    TEMPLATE_HASH --> GENERATION_PAYLOAD
    CONTENT_HASH --> GENERATION_PAYLOAD
    DRAFT_HASH --> GENERATION_PAYLOAD
    BYTES["byteLength"] --> GENERATION_PAYLOAD
    GENERATION_PAYLOAD --> GENERATION_HASH["generationHash"]
```

| Hash                 | Classe             | Identifica                                                    |
| -------------------- | ------------------ | ------------------------------------------------------------- |
| `validatedValueHash` | conteúdo de origem | valor aceito pelo Response Validator; preservado e verificado |
| `specificationHash`  | estrutural         | specification canônica e versionada                           |
| `templateHash`       | estrutural         | definição canônica de um template                             |
| `contentHash`        | conteúdo           | bytes UTF-8 exatos do conteúdo renderizado                    |
| `draftHash`          | estrutural         | `ArtifactDraft` completo em JSON canônico                     |
| `generationHash`     | estrutural         | resultado ordenado da geração completa                        |

Duração, timestamps e conteúdo bruto não entram no `generationHash`. Trocar a ordem dos templates altera a identidade da geração mesmo que o conjunto de drafts seja igual.

---

# Orçamento e Limites

```mermaid
flowchart TD
    CONFIG["Configuração da instância"] --> STRUCTURAL["Limites estruturais"]
    CONFIG --> CONTENT["Limites de conteúdo"]

    STRUCTURAL --> ARTIFACTS["quantidade de artifacts"]
    STRUCTURAL --> SPEC_BYTES["bytes da specification"]
    STRUCTURAL --> FRAGMENTS["fragments por template"]
    STRUCTURAL --> PATH["segmentos por binding path"]

    CONTENT --> PER_ARTIFACT["bytes por artifact"]
    CONTENT --> TOTAL["bytes totais"]

    ARTIFACTS --> REJECT["Rejeição explícita"]
    SPEC_BYTES --> REJECT
    FRAGMENTS --> REJECT
    PATH --> REJECT
    PER_ARTIFACT --> REJECT
    TOTAL --> REJECT
```

Defaults permanecem centralizados na configuração do módulo e cada campo possui teto absoluto. Cada instância pode configurar limites dentro desses tetos. A medição de conteúdo usa bytes UTF-8, não quantidade de caracteres.

Para templates `TEXT`, o Binding Resolver acumula bytes a cada fragmento e reutiliza a serialização de referências repetidas ao mesmo par `bindingId + serialization`. Se o limite por artifact for ultrapassado, a resolução para antes do `join`; o Renderer ainda confirma o tamanho exato antes de criar o draft. Isso evita que repetições declarativas materializem primeiro uma string muito maior que o orçamento.

| Configuração              | Default |
| ------------------------- | ------- |
| `maxArtifacts`            | 16      |
| `maxFragmentsPerArtifact` | 256     |
| `maxBindingsPerArtifact`  | 64      |
| `maxBindingPathDepth`     | 32      |
| `maxSpecificationBytes`   | 256 KiB |
| `maxArtifactBytes`        | 1 MiB   |
| `maxTotalBytes`           | 4 MiB   |
| `maxNestingDepth`         | 100     |

Não existe truncamento silencioso. Limite excedido produz erro canônico rastreável e nenhum resultado parcial é publicado.

---

# Imutabilidade

```mermaid
flowchart LR
    INPUT["Objetos do caller"] --> CLONE["Validação e clone por schema"]
    CLONE --> PIPELINE["Pipeline local"]
    PIPELINE --> FREEZE["Deep freeze"]
    FREEZE --> RESULT["ArtifactGenerationResult"]

    PIPELINE -.->|"não muta"| INPUT
    RESULT -.->|"não expõe"| INTERNAL["ResolvedArtifactModel"]
```

O Generator não congela nem modifica os objetos pertencentes ao caller. Ele trabalha sobre valores validados e clonados e congela profundamente apenas sua saída pública.

---

# Trust Boundaries

```mermaid
flowchart LR
    subgraph UNTRUSTED["Conteúdo não confiável"]
        RESULT["ValidationResult"]
        VALUE["validatedOutput"]
    end

    subgraph TRUSTED_CONFIG["Configuração server-side"]
        SPEC["ArtifactSpecification declarativa"]
        LIMITS["Limites da instância"]
    end

    subgraph GENERATION["core/artifact-generator"]
        SCHEMAS["Schemas de fronteira"]
        BINDINGS["Binding Resolution"]
        MODEL["ResolvedArtifactModel"]
        RENDER["Rendering"]
    end

    subgraph CONTROLLED["Saídas controladas"]
        DRAFTS["ArtifactDrafts imutáveis"]
        LOGS["Logs sanitizados"]
    end

    RESULT --> SCHEMAS
    VALUE --> BINDINGS
    SPEC --> SCHEMAS
    LIMITS --> SCHEMAS
    SCHEMAS --> BINDINGS
    BINDINGS --> MODEL
    MODEL --> RENDER
    RENDER --> DRAFTS
    RENDER --> LOGS

    DRAFTS -.->|"não autoriza"| FS["Filesystem / execução"]
    DRAFTS -.->|"exige etapa posterior"| DB["Persistência"]
```

`valid: true` significa aderência ao contrato funcional configurado; não transforma o conteúdo em código seguro, HTML seguro ou dado confiável para qualquer destino. A fronteira impede I/O e preserva a necessidade de escaping, revisão e políticas posteriores.

---

# Logging

```text
artifact.generation.started
artifact.generation.completed
artifact.generation.failed
```

Os eventos podem conter somente:

- executionId, agentExecutionId, requestId e traceId quando disponíveis;
- ID e versão da specification;
- `sourceValidationHash` e `sourceValidatedValueHash`;
- `specificationHash`, hashes dos templates, drafts e conteúdos e `generationHash`;
- quantidade de templates e artifacts;
- bytes renderizados e duração;
- estágio, classificação e código de erro canônico.

Nunca podem conter:

- conteúdo validado ou renderizado;
- valores resolvidos por bindings;
- templates, fragments ou specification completa;
- prompt, contexto, regras ou schemas completos;
- paths externos, API keys, authorization headers, cookies ou segredos.

Os estágios públicos são `REQUEST_VALIDATION`, `SPECIFICATION_VALIDATION`, `SOURCE_INTEGRITY_VALIDATION`, `BINDING_RESOLUTION`, `RENDERING`, `DRAFT_VALIDATION`, `BUDGET_VALIDATION` e `FINALIZATION`.

Erros possuem classificação `TECHNICAL` ou `GENERATION`. Os códigos canônicos distinguem configuração ou request inválido, validação fonte rejeitada, integridade ou contrato fonte divergente, limite de specification, binding ausente ou incompatível, limite ou vazio de conteúdo, draft inválido e falha interna. Todos usam o prefixo `ARTIFACT_GENERATOR_`.

| Código sem o prefixo `ARTIFACT_GENERATOR_` | Classificação | Estágio típico                 |
| ------------------------------------------ | ------------- | ------------------------------ |
| `INVALID_CONFIGURATION`                    | `TECHNICAL`   | `REQUEST_VALIDATION`           |
| `INVALID_REQUEST`                          | `TECHNICAL`   | `REQUEST_VALIDATION`           |
| `SOURCE_VALIDATION_REJECTED`               | `GENERATION`  | `REQUEST_VALIDATION`           |
| `SOURCE_INTEGRITY_MISMATCH`                | `GENERATION`  | `SOURCE_INTEGRITY_VALIDATION`  |
| `SOURCE_CONTRACT_MISMATCH`                 | `GENERATION`  | `SPECIFICATION_VALIDATION`     |
| `SPECIFICATION_LIMIT_EXCEEDED`             | `GENERATION`  | `SPECIFICATION_VALIDATION`     |
| `BINDING_NOT_FOUND`                        | `GENERATION`  | `BINDING_RESOLUTION`           |
| `BINDING_TYPE_MISMATCH`                    | `GENERATION`  | `BINDING_RESOLUTION`           |
| `CONTENT_LIMIT_EXCEEDED`                   | `GENERATION`  | `BUDGET_VALIDATION`            |
| `EMPTY_CONTENT`                            | `GENERATION`  | `RENDERING`                    |
| `INVALID_ARTIFACT_DRAFT`                   | `GENERATION`  | `DRAFT_VALIDATION`             |
| `INTERNAL_ERROR`                           | `TECHNICAL`   | estágio em que a falha ocorreu |

---

# Dependências

```mermaid
flowchart TD
    GENERATOR["@brq/artifact-generator"] --> VALIDATOR["@brq/response-validator<br/>API pública"]
    GENERATOR --> SHARED["@brq/shared<br/>ArtifactDraft + logger"]

    GENERATOR -.->|"proibido"| VALIDATOR_INTERNAL["Response Validator internals"]
    GENERATOR -.->|"proibido"| RUNNER["Agent Runner"]
    GENERATOR -.->|"proibido"| PROVIDER["AI Provider / OpenAI"]
    GENERATOR -.->|"proibido"| PROMPT["Prompt Builder"]
    GENERATOR -.->|"proibido"| KNOWLEDGE["Knowledge Loader"]
    GENERATOR -.->|"proibido"| AGENTS["agents/"]
    GENERATOR -.->|"proibido"| ORCHESTRATOR["Orchestrator"]
    GENERATOR -.->|"proibido"| PRISMA["Prisma / repositories"]
    GENERATOR -.->|"proibido"| APPS["apps/"]
    GENERATOR -.->|"proibido"| FILESYSTEM["Filesystem"]
```

---

# Resumo para Onboarding

```text
ValidationResult aceito + ArtifactSpecification pronta
                         ↓
            validação de fronteira e limites
                         ↓
                 Binding Resolution
                         ↓
            ResolvedArtifactModel interno
                         ↓
              Rendering determinístico
                         ↓
      ArtifactDrafts + metadados + hashes
                         ↓
        ArtifactGenerationResult imutável
```

Ao depurar o módulo, verifique primeiro `validationHash`, `validatedValueHash`, ID e versão da specification, estágio, código de erro e limites. Não procure arquivos ou registros no banco: a fronteira da Sprint 8 termina no resultado em memória.
