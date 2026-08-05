# Prompt Builder Flow

## Objetivo

Este documento apresenta visualmente o fluxo determinístico do Prompt Builder implementado na Sprint 5.

Ele serve como material de onboarding. O [ADR-015](ADR/ADR-015-PROMPT-BUILDER-BOUNDARY.md) continua sendo a decisão arquitetural normativa, enquanto este documento explica como contratos, resolução, AST, hashes, orçamento, rendering, comparação e trust boundaries trabalham em conjunto.

---

# Visão Geral

O Prompt Builder recebe estruturas prontas, resolve uma AST tipada e produz um `PromptResult` imutável. Ele não carrega documentos, não monta contexto a partir do filesystem, não chama IA e não persiste dados.

```mermaid
flowchart TD
    A["PromptBuildInput + PromptBuildOptions"]

    subgraph GUARD["1. Guardas de entrada"]
        B["Validar options<br/>e calcular maxBytes efetivo"]
        C1["Cap estrutural no input bruto<br/>contar references sem cloná-las"]
        C2["Preflight no input bruto<br/>lower-bound do payload"]
        D["Zod parse e clone<br/>PromptBuildInput"]
        E["deepFreeze do input validado"]
    end

    subgraph RESOLUTION["2. Estrutura e resolução"]
        F["parsePromptTemplate<br/>validar + calcular templateHash"]
        G["assemblePromptDocument<br/>resolver slots e proveniência"]
        H["ResolvedPromptDocument<br/>imutável"]
    end

    subgraph OUTPUT["3. Rendering e integridade"]
        I["renderPromptDocument<br/>instructions + input"]
        J["Medição final exata<br/>instructionsBytes + inputBytes + outputContractBytes"]
        K{"usedBytes ≤ maxBytes?"}
        L["Calcular hashes<br/>e metadados"]
        M["promptResultSchema<br/>validação cruzada integral"]
        N["deepFreeze e retorno<br/>PromptResult"]
    end

    V["prompt.validation.failed"]
    X["prompt.budget.exceeded"]
    Y["prompt.build.failed"]

    A --> B --> C1 --> C2 --> D --> E --> F --> G --> H --> I --> J --> K
    K -->|sim| L --> M --> N
    K -->|não| X
    B -.->|options inválidas| V
    C1 -.->|limite excedido| V
    C2 -.->|lower-bound excedido| X
    D -.->|schema inválido| V
    G -.->|resolução inválida| Y
    M -.->|incoerência| Y
```

Ordem importante:

1. o preflight opera sobre o input bruto antes do clone do Zod;
2. a validação completa produz uma cópia tipada e congelada;
3. a AST é resolvida antes do rendering;
4. o orçamento final é medido sobre os outputs exatos;
5. o `PromptResult` inteiro é revalidado antes do retorno.

---

# Contratos de Entrada e Saída

## PromptBuildInput

```text
PromptBuildInput
├── template: PromptTemplate
├── ruleSets: PromptRuleSet[]
├── contexts: PromptContextInput[]
├── variables: PromptVariable[]
├── constraints: PromptConstraint[]
└── outputContract: PromptOutputContract
```

As estruturas já devem estar selecionadas, autorizadas e prontas. O Prompt Builder não conhece a origem física delas.

## PromptResult

| Campo            | Responsabilidade                                                          |
| ---------------- | ------------------------------------------------------------------------- |
| `document`       | AST resolvida, seções ordenadas e proveniência                            |
| `rendered`       | Strings finais e separadas `instructions` e `input`                       |
| `metadata`       | Identidade, versões, hashes de payload, seções e fontes                   |
| `budget`         | Limite efetivo e bytes exatos por canal e output contract                 |
| `outputContract` | Contrato provider-neutral, coerente com o fragmento correspondente da AST |

O resultado não contém timestamps. O mesmo input válido produz a mesma estrutura, os mesmos textos e os mesmos hashes.

---

# AST do Prompt

A hierarquia conceitual possui quatro níveis. Concretamente, `PromptTemplate` representa o estado anterior à resolução e `ResolvedPromptDocument` representa o documento posterior à resolução.

```mermaid
classDiagram
    direction LR

    class PromptTemplate {
        id
        agent
        version
        schemaVersion
        sections
    }

    class PromptTemplateSection {
        id
        kind
        channel
        trust
        blocks
    }

    class PromptTemplateBlock {
        id
        kind
        fragments
    }

    class PromptTemplateFragment {
        id
        type
        typedSlotData
    }

    class ResolvedPromptDocument {
        promptId
        agent
        version
        schemaVersion
        sections
        sources
    }

    class ResolvedPromptSection {
        id
        kind
        channel
        trust
        hash
        sizeBytes
        blocks
    }

    class ResolvedPromptBlock {
        id
        kind
        hash
        sizeBytes
        fragments
    }

    class ResolvedPromptFragment {
        id
        type
        sourceId
        sourceItemId
        content
        hash
        sizeBytes
    }

    class PromptSources {
        ruleSets
        contexts
    }

    PromptTemplate *-- PromptTemplateSection
    PromptTemplateSection *-- PromptTemplateBlock
    PromptTemplateBlock *-- PromptTemplateFragment

    PromptTemplate ..> ResolvedPromptDocument : resolução

    ResolvedPromptDocument *-- ResolvedPromptSection
    ResolvedPromptSection *-- ResolvedPromptBlock
    ResolvedPromptBlock *-- ResolvedPromptFragment
    ResolvedPromptDocument *-- PromptSources
```

## Invariantes estruturais

- A posição nos arrays define a ordem canônica; não existe campo `order`.
- IDs são únicos no escopo correspondente.
- Section kind, block kind e fragment type precisam ser semanticamente compatíveis.
- Hashes e `sizeBytes` são recalculáveis a partir dos filhos.
- A AST resolvida reaplica as regras de canal e confiança; não confia apenas no template original.
- `ResolvedPromptDocument.sources` possui ordenação canônica independente da ordem de entrada.

---

# Fluxo de Resolução

Não existe interpolação textual por `{{placeholder}}`. Slots são nós tipados e cada valor é resolvido uma única vez.

```mermaid
flowchart LR
    subgraph TEMPLATE["PromptTemplateFragment"]
        T1["TEXT"]
        T2["VARIABLE_SLOT"]
        T3["CONTEXT_SLOT"]
        T4["RULE_SET_SLOT"]
        T5["CONSTRAINTS_SLOT"]
        T6["OUTPUT_CONTRACT_SLOT"]
    end

    V2["Validar variável<br/>e serializar"]
    V3["Validar contexto<br/>e kind da seção"]
    V4["Serializar contexto<br/>como TEXT ou JSON"]
    V5["Verificar contentHash"]
    V6["Validar rule set<br/>scope e agente"]
    V7["Validar e serializar<br/>constraints"]
    V8["Canonicalizar<br/>output contract"]

    subgraph RESOLVED["ResolvedPromptFragment"]
        R1["STATIC_TEXT"]
        R2["VARIABLE"]
        R3["CONTEXT"]
        R4["1..N RULE"]
        R5["1..N CONSTRAINT"]
        R6["OUTPUT_CONTRACT"]
    end

    T1 --> R1
    T2 --> V2 --> R2
    T3 --> V3 --> V4 --> V5 --> R3
    T4 --> V6 --> R4
    T5 --> V7 --> R5
    T6 --> V8 --> R6

    R1 --> B["ResolvedPromptBlock"]
    R2 --> B
    R3 --> B
    R4 --> B
    R5 --> B
    R6 --> B
    B --> S["ResolvedPromptSection"]
    S --> D["ResolvedPromptDocument"]
```

## Mapeamento de slots

| Slot                   | Fragmento resolvido | Origem                                            |
| ---------------------- | ------------------- | ------------------------------------------------- |
| `TEXT`                 | `STATIC_TEXT`       | Sem origem dinâmica                               |
| `VARIABLE_SLOT`        | `VARIABLE`          | `sourceId = variable.name`                        |
| `CONTEXT_SLOT`         | `CONTEXT`           | `sourceId = context.id`                           |
| `RULE_SET_SLOT`        | `RULE`              | `sourceId = ruleSet.id`, `sourceItemId = rule.id` |
| `CONSTRAINTS_SLOT`     | `CONSTRAINT`        | Um fragmento por constraint                       |
| `OUTPUT_CONTRACT_SLOT` | `OUTPUT_CONTRACT`   | `sourceId = outputContract.id`                    |

Para itens expandidos, como rules e constraints, o ID derivado usa hash canônico de `slotId` e `itemId`. Isso evita identidades ambíguas por concatenação de strings.

## Falhas de resolução

A montagem falha quando:

- um slot obrigatório não possui valor;
- um valor foi fornecido, mas não é referenciado pelo template;
- um rule set não corresponde ao scope da seção ou ao agente;
- um contexto não corresponde ao kind da seção;
- o `contentHash` não corresponde ao conteúdo serializado;
- constraints foram fornecidas sem um slot correspondente;
- existe `CONSTRAINTS_SLOT`, mas nenhuma constraint foi fornecida;
- o template não possui exatamente um `OUTPUT_CONTRACT_SLOT`.

Nenhum valor resolvido é reinterpretado como template.

---

# Trust Boundaries

O limite de confiança é expresso na própria AST e revalidado depois da resolução.

```mermaid
flowchart LR
    subgraph TRUSTED["INSTRUCTIONS / TRUSTED"]
        T1["GLOBAL_RULES"]
        T2["SECURITY_RULES"]
        T3["AGENT_IDENTITY"]
        T4["AGENT_RULES"]
        T5["OBJECTIVE / RESPONSIBILITIES / PROCESS"]
        T6["OUTPUT_CONTRACT"]
        T7["FINAL_INSTRUCTION"]
    end

    subgraph UNTRUSTED["INPUT / UNTRUSTED"]
        U1["CONSTRAINTS"]
        U2["KNOWLEDGE_CONTEXT"]
        U3["EXECUTION_CONTEXT"]
        U4["USER_INPUT"]
    end

    VT["Schemas do lane confiável<br/>slot → block → section → fragment"]
    VU["Schemas do lane não confiável<br/>slot → block → section → fragment"]
    RI["rendered.instructions"]
    RU["rendered.input"]
    PR["PromptResult"]

    TRUSTED --> VT --> RI --> PR
    UNTRUSTED --> VU --> RU --> PR
```

| Canal          | Tipos dinâmicos permitidos                            |
| -------------- | ----------------------------------------------------- |
| `INSTRUCTIONS` | `RULE`, `OUTPUT_CONTRACT` e texto estático compatível |
| `INPUT`        | `VARIABLE`, `CONTEXT`, `CONSTRAINT` e texto estático  |

Regras importantes:

- Knowledge context continua sendo dado não confiável, mesmo quando veio de documentação interna.
- Conteúdo dinâmico não pode ser promovido para `INSTRUCTIONS` alterando apenas a AST resolvida.
- Regras e output contracts não podem ser movidos para `INPUT`.
- Delimitadores tornam limites explícitos, mas não substituem a preservação dos canais pelo consumer futuro.
- Logs nunca registram conteúdo de fragmentos, variáveis, contexto, entrada do usuário ou JSON Schema completo.

---

# Cálculo de Hashes

O módulo usa SHA-256. Hashes internos são 64 caracteres hexadecimais; `contentHash` de contexto usa o prefixo `sha256:`.

```mermaid
flowchart TD
    FC["Fragment canonical JSON<br/>{id, type, sourceId, sourceItemId, content}"] --> FH["fragment.hash"]
    FH --> BC["Block canonical JSON<br/>{id, kind, fragments: [{id, hash}]}"]
    BC --> BH["block.hash"]
    BH --> SC["Section canonical JSON<br/>{id, kind, channel, trust, blocks: [{id, hash}]}"]
    SC --> SH["section.hash"]

    TT["PromptTemplate<br/>JSON canônico completo"] --> TH["templateHash"]
    IT["rendered.instructions<br/>texto exato"] --> IH["instructionsHash"]
    UT["rendered.input<br/>texto exato"] --> UH["inputHash"]
    OC["outputContract<br/>JSON canônico"] --> OH["outputContractHash"]

    ID["promptId + agent + versions"] --> PC["JSON canônico do payload"]
    IT --> PC
    UT --> PC
    OC --> PC
    PC --> PH["promptHash"]

    RS["RuleSet<br/>JSON canônico"] --> RSH["ruleSet hash"]
    RSH --> RSP["RuleSet provenance<br/>id + version + scope + agent + hash"]
    RSP --> RSS["document.sources.ruleSets"]
    RSS --> META["metadata.ruleSetHashes"]

    CC["Context content<br/>serializado"] --> CH["contentHash"]
    CH --> CD["Context descriptor<br/>id + kind + serialization + contentHash + references"]
    CD --> DH["descriptorHash"]
    DH --> CP["Context provenance object"]
    CP --> CS["document.sources.contexts"]
    CS --> META2["metadata.contextHashes"]

    RSS --> PN["Objetos completos de proveniência<br/>não entram diretamente no promptHash"]
    CS --> PN
```

## Fórmulas canônicas

| Hash                 | Entrada                                                        |
| -------------------- | -------------------------------------------------------------- |
| `fragment.hash`      | `{ id, type, sourceId, sourceItemId, content }`                |
| `block.hash`         | `{ id, kind, fragments: [{ id, hash }] }`                      |
| `section.hash`       | `{ id, kind, channel, trust, blocks: [{ id, hash }] }`         |
| `templateHash`       | `PromptTemplate` completo em JSON canônico                     |
| `instructionsHash`   | String exata de `rendered.instructions`                        |
| `inputHash`          | String exata de `rendered.input`                               |
| `outputContractHash` | Output contract em JSON canônico                               |
| `promptHash`         | Identidade, versões, canais renderizados e output contract     |
| `ruleSet.hash`       | Rule set completo em JSON canônico                             |
| `contentHash`        | Conteúdo do contexto após serialização                         |
| `descriptorHash`     | ID, kind, serialização, `contentHash` e references do contexto |

`promptHash` não inclui diretamente os objetos completos de proveniência de `document.sources` e dos metadados. Entretanto, ID, type, `sourceId`, `sourceItemId` e hash dos fragments aparecem no rendering; mudanças que alterem a AST resolvida podem, portanto, alterar o `promptHash`. Somente mudanças restritas a metadados de fonte não renderizados — por exemplo `ruleSet.version` ou references de contexto sem mudança de conteúdo — podem preservar o payload e manter o mesmo `promptHash`. A auditoria deve consultar também `ruleSetHashes` e `contextHashes`.

---

# Orçamento

Existem duas proteções independentes: orçamento do payload e limite estrutural da proveniência.

```mermaid
flowchart TD
    RAW["Input bruto"] --> REF["Contar references sem cloná-las"]
    REF --> ROK{"total ≤ maxContextReferences?"}
    ROK -->|não| IE["INVALID_INPUT"]
    ROK -->|sim| PRE["Preflight lower-bound do payload"]
    PRE --> POK{"lower-bound ≤ maxBytes?"}
    POK -->|não| BE["BUDGET_EXCEEDED"]
    POK -->|sim| BUILD["Resolver e renderizar"]

    BUILD --> IB["Buffer.byteLength(instructions, utf8)"]
    BUILD --> UB["Buffer.byteLength(input, utf8)"]
    BUILD --> OB["Buffer.byteLength(canonical outputContract, utf8)"]

    IB --> SUM["usedBytes = instructionsBytes + inputBytes + outputContractBytes"]
    UB --> SUM
    OB --> SUM

    SUM --> FINAL{"usedBytes ≤ maxBytes?"}
    FINAL -->|sim| RESULT["PromptResult"]
    FINAL -->|não| BE
```

## Regras do orçamento

- `DEFAULT_PROMPT_MAX_BYTES = 128 KiB`.
- `maxBytes` é configurado na instância.
- Uma chamada pode apenas reduzir o limite da instância.
- O preflight é um lower-bound barato; passar nele não garante aprovação da medição final.
- A medição final inclui delimitadores e metadados textuais renderizados.
- O output contract é contado separadamente porque permanece um campo próprio do `PromptResult`.
- Não existe truncamento, resumo ou omissão silenciosa.
- References não consomem o orçamento do payload.
- `maxContextReferences` possui default 256 por instância.
- O schema impõe teto absoluto total de 4096 references.

`fragment.sizeBytes`, `block.sizeBytes` e `section.sizeBytes` medem apenas conteúdo estrutural. Eles não substituem o orçamento final, que mede as strings efetivamente renderizadas.

---

# Rendering

O renderer é a única etapa que converte a AST em texto. Ele não altera nem resume o conteúdo dos fragments.

```mermaid
sequenceDiagram
    participant B as PromptBuilder
    participant R as PromptRenderer

    B->>R: ResolvedPromptDocument
    R->>R: selecionar sections INSTRUCTIONS
    R->>R: renderizar Section → Block → Fragment
    R->>R: selecionar sections INPUT
    R->>R: renderizar Section → Block → Fragment
    R-->>B: { instructions, input }
    B->>B: medir bytes e calcular hashes
    B->>B: validar rendering contra a AST
```

Cada nível recebe delimitadores que carregam ID e hash. Exemplo simplificado:

```text
<<<BEGIN_PROMPT_SECTION:section-id:section-hash>>>
id: section-id
kind: USER_INPUT
channel: INPUT
trust: UNTRUSTED

<<<BEGIN_PROMPT_BLOCK:block-id:block-hash>>>
<<<BEGIN_PROMPT_FRAGMENT:fragment-id:fragment-hash>>>
sourceId: USER_INPUT
sourceItemId: NONE
<<<BEGIN_PROMPT_FRAGMENT_CONTENT:fragment-id:fragment-hash>>>
conteúdo preservado exatamente
<<<END_PROMPT_FRAGMENT_CONTENT:fragment-id:fragment-hash>>>
<<<END_PROMPT_FRAGMENT:fragment-id:fragment-hash>>>
<<<END_PROMPT_BLOCK:block-id:block-hash>>>

<<<END_PROMPT_SECTION:section-id:section-hash>>>
```

O schema final chama o renderer novamente e exige igualdade exata entre o texto derivado da AST e `PromptResult.rendered`.

---

# Prompt Comparator

O comparator atual é estrutural e opera em sections. A infraestrutura interna permite adicionar navigators de blocks e fragments futuramente.

```mermaid
flowchart TD
    BEFORE["PromptResult before"] --> NB["SECTION_NAVIGATOR"]
    AFTER["PromptResult after"] --> NA["SECTION_NAVIGATOR"]

    NB --> IB["Indexar por path canônico"]
    NA --> IA["Indexar por path canônico"]

    IB --> DIFF["Comparar paths, hashes e posições"]
    IA --> DIFF

    DIFF --> ADD["added"]
    DIFF --> REMOVE["removed"]
    DIFF --> CHANGE["changed"]
    DIFF --> REORDER["reordered"]

    BEFORE --> PHC["promptHashChanged"]
    AFTER --> PHC

    ADD --> EQ["equal"]
    REMOVE --> EQ
    CHANGE --> EQ
    REORDER --> EQ
    PHC --> EQ
```

`PromptNodeReference` expõe:

- `id`;
- `hash`;
- `index`;
- `nodeType`;
- `path` imutável.

`equal` é verdadeiro somente quando não há adição, remoção, alteração, reordenação ou mudança de `promptHash`.

O comparator não:

- compara significado;
- usa IA;
- classifica qualidade;
- detecta equivalência semântica;
- compara recursivamente blocks e fragments nesta Sprint.

Uma mudança exclusiva de proveniência não renderizada pode manter `PromptComparison.equal`, pois esses metadados não pertencem ao payload efetivo.

---

# Validação Integral do PromptResult

Antes do retorno, o schema verifica de forma cruzada:

```mermaid
flowchart LR
    AST["Resolved AST"] --> CHECK["promptResultSchema"]
    RENDERED["Rendered channels"] --> CHECK
    HASHES["Hashes e sectionHashes"] --> CHECK
    SOURCES["RuleSet e context provenance"] --> CHECK
    BUDGET["Bytes e limites"] --> CHECK
    CONTRACT["Output contract"] --> CHECK

    CHECK --> OK["PromptResult coerente"]
```

As principais garantias são:

- hashes e tamanhos da AST resolvida, do payload e da proveniência podem ser recalculados a partir do resultado;
- `templateHash` é produzido durante o parsing do template e não é recalculável somente a partir do `PromptResult`, que não carrega o template original;
- o rendering deriva exatamente da AST;
- o output contract externo corresponde ao único fragmento de contrato;
- rule sets correspondem aos fragments de regra, incluindo scope e agente;
- contextos correspondem aos fragments e ao kind da seção;
- proveniência em `document.sources` e `metadata` é idêntica;
- bytes declarados correspondem aos textos exatos;
- `usedBytes` não excede `maxBytes`;
- trust boundaries continuam válidas após a resolução.

---

# Observabilidade e Erros

Eventos emitidos:

- `prompt.build.started`;
- `prompt.build.completed`;
- `prompt.build.failed`;
- `prompt.validation.failed`;
- `prompt.budget.exceeded`.

Os logs podem conter IDs, agente, versões, hashes, contagens, limites, bytes, duração e IDs de correlação. Eles nunca contêm prompts, respostas, conteúdo de contexto, variáveis, entrada do usuário, segredos ou JSON Schemas completos.

Erros são traduzidos para `PromptBuilderError` com códigos canônicos. O módulo não executa retries.

---

# Fronteiras Arquiteturais

```mermaid
flowchart LR
    READY["Estruturas prontas"] --> PB["core/prompt-builder"] --> RESULT["PromptResult"]

    KL["Knowledge Loader"] -.->|não importado| PB
    AP["AI Provider"] -.->|não importado| PB
    AR["Agent Runner"] -.->|não importado| PB
    ORC["Orchestrator"] -.->|não importado| PB
    DB["Prisma / Persistence"] -.->|não importado| PB
    FS["Filesystem / Network"] -.->|sem acesso| PB
```

O Prompt Builder não:

- seleciona ou carrega conhecimento;
- lê `knowledge/`, `agents/` ou `prompts/`;
- conhece OpenAI, Responses API ou `AIProvider`;
- chama modelos;
- valida respostas de IA;
- cria ou persiste artifacts;
- controla agentes, retries ou execução;
- seleciona versões de templates;
- implementa Prompt Manifest ou registry.

O logger estruturado injetável é sua única saída lateral.

---

# Mapa do Código

| Responsabilidade             | Arquivo principal                          |
| ---------------------------- | ------------------------------------------ |
| Facade e ciclo completo      | `core/prompt-builder/prompt-builder.ts`    |
| Contratos públicos           | `core/prompt-builder/contracts.ts`         |
| Schemas e coerência integral | `core/prompt-builder/schemas.ts`           |
| Parsing de template          | `core/prompt-builder/prompt-template.ts`   |
| Resolução e montagem da AST  | `core/prompt-builder/prompt-assembler.ts`  |
| Verificação de contexto      | `core/prompt-builder/context-injector.ts`  |
| Variáveis e serialização     | `core/prompt-builder/variable-resolver.ts` |
| Rendering final              | `core/prompt-builder/prompt-renderer.ts`   |
| Orçamento e preflight        | `core/prompt-builder/prompt-budget.ts`     |
| Limites centralizados        | `core/prompt-builder/limits.ts`            |
| Hashes                       | `core/prompt-builder/hashing.ts`           |
| JSON canônico                | `core/prompt-builder/canonical-json.ts`    |
| Comparação estrutural        | `core/prompt-builder/prompt-comparator.ts` |
| Erros canônicos              | `core/prompt-builder/errors.ts`            |

---

# Resumo para Onboarding

```text
Estruturas prontas
        ↓
Preflight antes do clone
        ↓
Validação Zod + imutabilidade
        ↓
Template AST com slots tipados
        ↓
Resolved AST com conteúdo, hashes e proveniência
        ↓
Rendering separado por trust boundary
        ↓
Medição exata + hashes finais
        ↓
Validação cruzada integral
        ↓
PromptResult determinístico e imutável
```

Ao depurar o módulo, a pergunta principal deve ser: cada informação pertence ao template, ao payload efetivo ou à proveniência? Essa separação determina canal, hash, orçamento e comportamento do comparator.
