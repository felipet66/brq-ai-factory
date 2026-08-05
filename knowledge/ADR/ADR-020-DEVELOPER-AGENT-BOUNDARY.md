# ADR-020 — Developer Agent Boundary and Technical Specification Handoff

## Status

Accepted

## Date

2026-08-05

## Context

A Sprint 9 introduziu o Product Owner Agent como primeira fachada concreta sobre Knowledge Loader, Agent Runner, Response Validator, Business Validation e Artifact Generator. A Sprint 10 precisa reutilizar o mesmo pipeline para transformar uma `ProductOwnerSpecification` validada em uma `TechnicalSpecification`, sem converter o agente em Orchestrator e sem antecipar geração de código, testes ou persistência.

Também era necessário decidir como transportar o contrato funcional entre workspaces de agentes sem permitir que um agente execute outro, como garantir cobertura dos critérios de aceite, como representar os assets técnicos e como acomodar o contexto `DEVELOPER` dentro do orçamento padrão do Knowledge Loader.

## Decision

O Developer Agent pertence ao workspace `agents/developer`. Sua factory valida dependências e o bundle de assets antes de aceitar requests. Cada invocação representa uma única tentativa e compõe, nesta ordem:

1. validação do request e da `ProductOwnerSpecification` de origem;
2. carregamento do contexto lógico `DEVELOPER` pelo Knowledge Loader;
3. projeção do conhecimento e da especificação funcional em contextos não confiáveis;
4. uma execução pelo Agent Runner;
5. validação estrutural e declarativa pelo Response Validator;
6. Developer Business Validation;
7. geração determinística de drafts pelo Artifact Generator;
8. projeção de um `DeveloperAgentResult` público e imutável.

Essa composição não coordena o Product Owner Agent, o futuro QA Agent ou qualquer workflow.

### Dependências permitidas

O Developer Agent pode depender somente dos entrypoints públicos de:

- `@brq/knowledge-loader`;
- `@brq/agent-runner`;
- `@brq/response-validator`;
- `@brq/artifact-generator`;
- `@brq/prompt-builder`, restrito a tipos, schemas e canonicalização/hashing públicos;
- `@brq/product-owner-agent`, restrito ao contrato e schema da `ProductOwnerSpecification` recebida;
- componentes transversais de `@brq/shared`.

A dependência do pacote de Product Owner não autoriza comunicação entre agentes. O Developer Agent não cria nem chama `ProductOwnerAgent`; apenas valida um valor funcional já recebido. Componentes genéricos de `core` continuam sem importar agentes concretos, e deep imports permanecem proibidos.

Esta decisão refina a formulação ampla do ADR-011 segundo a qual um agente nunca depende de outro: continua proibida qualquer dependência operacional ou chamada entre agentes, mas uma fachada pode importar do entrypoint público de um agente anterior somente tipos e schemas do contrato imutável usado como entrada. A exceção contratual é unidirecional, não transfere controle e não permite acessar implementação, testing helpers ou subpaths internos.

### Request e trust boundaries

O request contém metadados técnicos de execução, modelo, limites opcionais e exatamente uma `productOwnerSpecification`. Ele não aceita demanda bruta, prompt, rule sets, output contract, Artifact Specification, filenames ou resultado executável do Product Owner Agent.

O contexto lógico é sempre `DEVELOPER`; o caller não escolhe documentos, locators ou categorias. A fachada projeta duas entradas:

- `context:developer-knowledge`, `KNOWLEDGE/TEXT`, preservando conteúdo, `contextHash` e referências limitadas a ID, categoria e hash;
- `context:product-owner-specification`, `ARTIFACT/JSON`, preservando a specification funcional e usando hash de JSON canônico.

Ambas permanecem em `INPUT/UNTRUSTED`. Assets, regras e contratos server-side permanecem em `INSTRUCTIONS/TRUSTED`. Conteúdo da Knowledge Layer ou da specification nunca é promovido a instrução.

### Orçamento do contexto DEVELOPER

O orçamento padrão global do Knowledge Loader permanece em 64 KiB. A política `DEVELOPER` passa a exigir somente o núcleo necessário — arquitetura, stack, modelo de domínio, visão geral dos agentes, Developer Agent e segurança — e mantém system design, estrutura do repositório, coding standards, testing, workflow e ADRs como opcionais em ordem determinística.

Essa decisão resolve a seleção anterior de aproximadamente 88 KiB sem elevar o default global, sem truncar documentos e sem espalhar um limite específico pelo código do agente. Um teste com a Knowledge Layer real garante que todos os documentos obrigatórios caibam no orçamento padrão. O request pode apenas reduzir o orçamento da instância; uma ampliação exige que a composição server-side injete um Knowledge Loader configurado explicitamente com limite maior.

### Assets declarativos e versionados

Os assets do release inicial residem em `prompts/developer/1.0.0/` e formam um bundle declarativo, validado, hashado e profundamente imutável:

| Asset                  | ID                                           | Versão  |
| ---------------------- | -------------------------------------------- | ------- |
| Manifest               | `assets:developer`                           | `1.0.0` |
| Prompt template        | `prompt:developer`                           | `1.0.0` |
| Regras globais         | `rules:global-baseline`                      | `1.0.0` |
| Regras de segurança    | `rules:security-baseline`                    | `1.0.0` |
| Regras do agente       | `rules:developer`                            | `1.0.0` |
| Output contract        | `contract:developer-technical-specification` | `1.0.0` |
| Artifact specification | `artifacts:developer`                        | `1.0.0` |

O manifest vincula filenames, IDs e versões. O loader calcula e verifica hashes do manifest, template, rule sets, output contract, Validation Contract derivado, Artifact Specification e bundle. O `bundleHash` esperado fica fixado no release; qualquer alteração de conteúdo exige nova versão. Não há registry, descoberta dinâmica, hot reload ou seleção automática de versão.

### TechnicalSpecification

A saída declarativa descreve arquitetura, componentes, módulos, fluxos, contratos, APIs, eventos, modelo de dados, dependências internas e externas, riscos, fases, plano, backlog técnico, definição de pronto, decisões, trade-offs e rastreabilidade. Ela também declara:

- `complexity`: `LOW | MEDIUM | HIGH | VERY_HIGH`;
- `estimatedStoryPoints`: inteiro positivo limitado pelo contrato;
- `implementationPhases`: fases ordenadas e com dependências explícitas;
- `internalDependencies` e `externalDependencies` como coleções distintas.

A specification não contém código-fonte, patches, comandos executáveis ou testes gerados. O JSON Schema inicial usa o subconjunto conservador já adotado para Structured Outputs, sem `$schema` e `uniqueItems`; compatibilidade de modelos fine-tuned exige verificação explícita.

### Validação em duas camadas

O Response Validator permanece responsável somente por finish reason, presença e formato do conteúdo, JSON, JSON Schema e coerência de structured output. Resposta rejeitada produz `VALIDATION_REJECTED` em `RESPONSE_VALIDATION`, sem Business Validation, artifacts ou retry.

A Developer Business Validation recebe a `TechnicalSpecification` estruturalmente aceita e a `ProductOwnerSpecification` original. Ela verifica invariantes específicas, incluindo:

- unicidade de IDs e referências;
- referências funcionais e técnicas existentes;
- ausência de referências duplicadas;
- coerência de dependências, ordem e ciclos nos grafos declarados;
- consistência do modelo de dados;
- coerência determinística de readiness;
- completude mínima quando a saída não requer esclarecimento;
- cobertura integral de todos os IDs de Acceptance Criteria da origem pela rastreabilidade técnica.

Cada critério de aceite deve aparecer em pelo menos um `traceability[].sourceIds`. Referências funcionais podem apontar somente para IDs `AC`, `BR` ou `BL` existentes na specification de origem, e cada item de rastreabilidade deve possuir ao menos um destino técnico. A validação não corrige ou completa a resposta.

Readiness técnica segue a seguinte precedência:

1. `REQUIRES_CLARIFICATION` se a specification de origem já requer esclarecimento ou existir pergunta técnica bloqueante;
2. `PARTIALLY_READY` se a origem estiver parcialmente pronta, existir pergunta técnica não bloqueante ou premissa técnica pendente;
3. `READY` nos demais casos válidos.

Readiness é classificação de domínio, não estado persistido de execução.

### Resultado e artifacts

O resultado público é uma união discriminada:

- `GENERATED`, com `TechnicalSpecification`, readiness, três drafts e metadados de proveniência;
- `VALIDATION_REJECTED`, sem specification ou drafts, identificando `RESPONSE_VALIDATION` ou `BUSINESS_VALIDATION`.

Além da linhagem comum de assets, knowledge, prompt, provider, validação e geração, os metadados preservam o hash canônico e a readiness da `ProductOwnerSpecification` de origem.

O bundle produz, na ordem declarada:

1. `architecture.md`;
2. `implementation-plan.md`;
3. `technical-decisions.json`.

Esses valores são `ArtifactDrafts` em memória. O Developer Agent não atribui IDs persistidos, versões ou timestamps, não escreve arquivos e não chama repositories.

### Timeout, cancelamento e retry

O Developer Agent não cria timers. O timeout opcional é encaminhado pelo Agent Runner ao provider, e o mesmo `AbortSignal` recebido é propagado ao Runner. Checkpoints locais impedem o início de fases posteriores quando o sinal já está cancelado; o Knowledge Loader ainda não permite cancelar uma leitura em andamento.

O agente não executa retry. Política funcional, criação de nova `AgentExecution`, backoff e decisão de continuidade permanecem responsabilidades do futuro Orchestrator. Retries técnicos internos permitidos pelo provider continuam regidos pelo ADR-013.

### Erros, logs e segurança

Rejeições funcionais são resultados; exceptions representam configuração inválida, falha técnica, cancelamento ou timeout. Erros canônicos expõem somente código, estágio, duração, IDs de correlação e código seguro da causa.

Logs usam allowlist de IDs, versões, hashes, quantidades, bytes, tempos, provider, modelo, finish reason, readiness, outcome e códigos técnicos. Nunca incluem Knowledge, Product Owner Specification, prompt, regras, schemas completos, resposta, Technical Specification, conteúdo dos drafts, segredos, headers, cookies, stack ou causa crua.

## Consequences

- o handoff PO → Developer usa um contrato explícito sem execução direta entre agentes;
- a cobertura integral de Acceptance Criteria passa a ser um gate de domínio verificável;
- a specification técnica é rastreável, versionável e auditável sem antecipar persistência;
- os três drafts são controlados pela aplicação e não por sugestões do modelo;
- o orçamento padrão do Knowledge Loader permanece estável e o contexto DEVELOPER cabe nele sem truncamento;
- geração de código, testes, workflow multiagente, retry, estados, persistência e revisão humana continuam fora desta Sprint;
- qualidade semântica profunda e viabilidade real da proposta ainda dependem de revisão humana e de componentes futuros.
