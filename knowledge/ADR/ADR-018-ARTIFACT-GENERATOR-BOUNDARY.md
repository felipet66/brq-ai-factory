# ADR-018 — Artifact Generator Boundary and Deterministic Rendering

## Status

Accepted

## Date

2026-08-05

## Context

O ADR-003 tornou obrigatórias saídas estruturadas para os agentes concretos, o ADR-016 definiu `AgentRunResult` como a saída técnica do Agent Runner e o ADR-017 introduziu `ValidationResult` como decisão funcional determinística. Ainda faltava uma fronteira explícita para transformar um valor aceito em `ArtifactDrafts` sem atribuir ao Response Validator regras de apresentação, nem antecipar Orchestrator, agentes concretos ou persistência.

Os contratos compartilhados já distinguem `ArtifactDraft`, `ArtifactCreateInput` e `Artifact`. O primeiro contém apenas `name`, `filename`, `type` e `content`; os demais acrescentam identidade de execução, provenance, versão e timestamps sob responsabilidade de componentes posteriores. Preservar essa distinção evita que rendering em memória seja confundido com criação, versionamento ou gravação de um registro.

## Decision

O `ArtifactGenerator` pertence ao workspace `core/artifact-generator`. Em produção, ele depende somente da API pública de `@brq/response-validator` e dos tipos, schemas e logger transversais de `@brq/shared`. Ele não importa internals do Validator, Agent Runner, Prompt Builder, AI Provider, agentes, Orchestrator, repositories, Prisma ou aplicações.

A operação pública recebe um `ArtifactGenerationRequest` composto por:

- um `ValidationResult` profundamente imutável, com `valid: true` e saída validada presente;
- uma `ArtifactSpecification` declarativa, explicitamente identificada e versionada.

Saídas validadas nos formatos `TEXT` e `JSON_SCHEMA` são suportadas. A specification declara o `sourceContract` completo — ID, versão, formato e hash — e todos os quatro campos devem corresponder aos metadados da validação antes que qualquer binding seja resolvido.

A specification contém os `ArtifactTemplate` necessários para a chamada. Cada template declara seus próprios `ArtifactBinding` com ID estável e path segmentado. Templates `TEXT` referenciam bindings por `bindingId` em fragments e definem serialização explícita; templates `JSON` indicam um único `rootBindingId`. IDs são únicos dentro do template, referências desconhecidas e bindings não utilizados são rejeitados. `TEXT` admite somente `text/plain` e `text/markdown`; `JSON` exige `application/json`. Essa configuração server-side chega pronta: o Generator não consulta manifesto, registry, filesystem ou agente para selecioná-la. Templates são dados declarativos, não callbacks ou código. Specifications específicas de Product Owner, Developer e QA serão definidas somente nas Sprints desses agentes.

A transformação é síncrona, determinística e organizada em quatro fronteiras:

1. **Binding Resolution** valida e resolve cada binding somente contra o valor aceito pelo Validator;
2. **ResolvedArtifactModel** reúne internamente templates e valores já resolvidos, sem expor essa representação na API pública;
3. **Rendering** converte cada modelo resolvido em conteúdo textual na ordem declarada, tratando valores como dados opacos;
4. **ArtifactDraft** projeta `name`, `filename`, `type` e `content`, e o conjunto é retornado em um `ArtifactGenerationResult` profundamente imutável.

Binding resolution e rendering permanecem separados. Paths são arrays de segmentos `string | number`, e o array vazio seleciona a raiz; não existe linguagem de expressão. Segmentos perigosos para prototype traversal são rejeitados. O renderer não volta ao valor validado, não resolve novos caminhos, não interpreta valores inseridos como template e não aplica correção ou transformação semântica. Artifacts `JSON` usam serialização canônica indentada com newline final; conteúdo vazio é rejeitado. O conteúdo original do `ValidationResult` também não é alterado.

O `ResolvedArtifactModel` é exclusivamente interno. Essa fronteira permite testar resolução e rendering separadamente sem tornar detalhes intermediários parte do contrato público ou permitir que consumers contornem validações.

O resultado preserva em `metadata.source` os IDs de correlação, provider, modelo, finish reason e hashes técnicos da execução, além de ID, versão, formato e hash do contrato e dos hashes de validação e valor validado. Esses dados são copiados da decisão anterior; não são inferidos do conteúdo nem transformados em provenance persistida.

A ordem dos templates e fragments declarados é canônica. O mesmo request válido, sob a mesma versão do módulo e configuração, produz drafts na mesma ordem, com o mesmo conteúdo e os mesmos hashes. Filenames duplicados são rejeitados para evitar ambiguidade no resultado e colisões futuras na persistência.

Todo `filename` é validado pelo contrato compartilhado de nome seguro. Um filename representa apenas identidade lógica do draft: não é caminho, não autoriza resolução de diretório e nunca é usado pelo Generator para criar arquivos.

Limites de quantidade de artifacts, tamanho da specification, fragments por template, profundidade de caminhos de binding, bytes por artifact e bytes totais pertencem à configuração da instância. Defaults são centralizados e possuem tetos absolutos. Durante a resolução de templates `TEXT`, os bytes são acumulados fragmento a fragmento e serializações repetidas do mesmo binding são reutilizadas; a pipeline rejeita expansão acima do limite antes de concatenar o conteúdo completo. O Renderer confirma o tamanho exato do resultado. Excesso é rejeitado; o módulo não trunca, omite ou divide conteúdo silenciosamente.

Hashes SHA-256 possuem funções distintas:

- `metadata.source.validatedValueHash` preserva o hash do Response Validator, que é recalculado e comparado antes da geração;
- `specificationHash` identifica a specification canônica;
- `templateHash` identifica a estrutura canônica de cada template;
- `contentHash` identifica os bytes UTF-8 exatos do conteúdo renderizado;
- `draftHash` identifica o `ArtifactDraft` completo em JSON canônico;
- `generationHash` identifica o resultado público ordenado da geração e sua origem validada, sem incluir duração ou timestamp.

`specificationHash`, `templateHash`, `draftHash` e `generationHash` são hashes estruturais. `contentHash` é um hash do conteúdo efetivo. Eles não são intercambiáveis, e nenhum deles substitui `validationHash` ou `validatedValueHash` provenientes da etapa anterior.

Falhas de request, integridade da origem, specification, binding, rendering, validação do draft, orçamento, finalização ou configuração produzem um erro canônico do módulo com classificação `TECHNICAL` ou `GENERATION`, estágio e código seguros. Depois que o request cruza a validação de fronteira, o erro preserva também os IDs de execução e correlação disponíveis. O Generator não converte falha em draft parcial, não corrige a specification e não executa retry. Como a transformação é local e síncrona, não introduz timeout ou cancelamento próprios.

Os eventos `artifact.generation.started`, `artifact.generation.completed` e `artifact.generation.failed` registram somente IDs de correlação, identidade e versão da specification, hashes, contagens, bytes, duração, estágio e código de erro. Logs nunca incluem conteúdo validado ou renderizado, valores de binding, templates, specification completa, prompts, schemas ou segredos.

O módulo não cria `ArtifactCreateInput` ou `Artifact`. Ele não atribui ID, `executionId`, `agentExecutionId`, provenance, versão ou timestamp; não chama `ArtifactRepository`; não escreve no filesystem e não exporta Markdown, JSON, código, PDF ou ZIP. Um consumer futuro deve enriquecer drafts e solicitar persistência explicitamente.

O Generator também não chama IA, não constrói prompts, não carrega conhecimento, não valida semanticamente a resposta, não executa artifacts, não altera estados, não decide retry ou revisão humana e não conhece o fluxo entre agentes.

## Consequences

- saída validada e apresentação em artifacts ficam desacopladas e podem evoluir de forma independente;
- specifications declarativas permitem testes, hashing, versionamento e auditoria sem executar código dinâmico;
- resolução, modelo interno e rendering possuem responsabilidades explícitas;
- a API pública contém somente request, specification e resultado, sem vazar o modelo intermediário;
- hashes distinguem origem validada, estrutura declarada, conteúdo renderizado, draft e resultado total;
- limites evitam expansão silenciosa ou resultados parciais;
- drafts continuam valores em memória até que um componente posterior adicione provenance e invoque a persistência;
- templates de agentes, Orchestrator, versionamento persistido, exportação e filesystem permanecem fora da Sprint 8.
