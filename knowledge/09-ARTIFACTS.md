# Artifacts

## Objetivo

Padronizar os drafts gerados a partir de saídas de agentes e os artefatos posteriormente enriquecidos e persistidos pela plataforma.

Agentes devem produzir saídas estruturadas. Após validação funcional, o Artifact Generator aplica uma specification declarativa e produz `ArtifactDrafts`; ele não cria registros persistidos.

---

# Product Owner

Arquivos previstos para a Sprint do agente; esta lista não é um manifesto do Artifact Generator:

story.md

acceptance.md

backlog.json

---

# Developer

Drafts canônicos da Sprint 10, na ordem declarada pela Artifact Specification:

architecture.md

implementation-plan.md

technical-decisions.json

Esses drafts documentam a proposta técnica. Não representam código-fonte, testes, arquivos gravados ou uma implementação executada.

---

# QA

Arquivos previstos para a Sprint do agente; esta lista não é um manifesto do Artifact Generator:

test-plan.md

playwright.spec.ts

quality-report.md

---

# ArtifactDraft

O Artifact Generator produz um draft antes do enriquecimento pela plataforma:

- name
- filename
- type
- content

`filename` deve conter somente um nome de arquivo seguro. Caminhos absolutos, `../`, separadores de diretório e nomes vazios são inválidos.

O draft é um valor em memória. Seu `filename` é somente um nome lógico e não autoriza criação de arquivo, resolução de diretório ou qualquer acesso ao filesystem.

# Geração

Uma `ArtifactGenerationRequest` contém:

- um `ValidationResult` com `valid: true`;
- uma `ArtifactSpecification` declarativa, versionada e validada.

A transformação segue a fronteira:

```text
Binding Resolution
        ↓
ResolvedArtifactModel interno
        ↓
Rendering
        ↓
ArtifactDraft
        ↓
ArtifactGenerationResult
```

O Generator não seleciona uma specification por agente e não avalia regras de Product Owner, Developer ou QA. Ele recalcula o hash do valor validado, exige vínculo exato com o contrato fonte e usa bindings locais por ID. Conteúdo validado continua não confiável: bindings apenas selecionam valores, e o rendering não executa, corrige nem reinterpreta esses valores como template.

Hashes estruturais identificam specification, templates, drafts e a decisão total de geração. `contentHash` identifica os bytes UTF-8 exatos de cada conteúdo renderizado; ele não substitui `validatedValueHash`, que identifica a saída aceita pelo Response Validator.

# Artifact

O artefato enriquecido pela plataforma possui:

- id
- executionId
- agentExecutionId
- name
- filename
- type
- content
- version
- createdAt
- provenance

`provenance` registra `agent`, `promptVersion` e `model`.

---

# Versionamento

Depois da fronteira do Generator, um componente futuro enriquece o draft como `ArtifactCreateInput`. O repository cria uma nova versão dentro da mesma Execution e para o mesmo `filename`, com novo registro e `version` incremental iniciando em `1`.

Nunca sobrescrever versões antigas.

O versionamento entre Executions exige um identificador de linhagem que ainda não faz parte do contrato canônico.

---

# Persistência

Artifacts enriquecidos podem ser armazenados no banco pelo `ArtifactRepository`. O Artifact Generator não usa repository, não persiste, não atribui versão e não escreve arquivos.

Opcionalmente poderá ser exportado para:

- Markdown
- PDF
- ZIP

---

# Objetivo

Permitir rastreabilidade completa de toda execução.

Cada artefato deverá indicar:

- qual agente o criou
- quando foi criado
- qual prompt foi utilizado
- qual modelo foi utilizado

O fluxo completo e a distinção entre geração em memória e persistência estão documentados em [Artifact Generator Flow](30-ARTIFACT_GENERATOR_FLOW.md) e [Artifact Lifecycle](31-ARTIFACT_LIFECYCLE.md).
