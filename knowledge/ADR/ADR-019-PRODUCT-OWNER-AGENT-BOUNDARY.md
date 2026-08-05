# ADR-019 — Product Owner Agent Boundary and Single-Agent Pipeline

## Status

Accepted

## Date

2026-08-05

## Context

As Sprints anteriores entregaram componentes genéricos e independentes para carregar conhecimento, construir prompts, executar uma chamada de IA, validar a resposta e gerar drafts. A Sprint 9 introduz o primeiro consumer concreto desse conjunto: o Product Owner Agent, responsável por transformar uma demanda em uma especificação funcional e nos artifacts `story.md`, `acceptance.md` e `backlog.json`.

O ADR-011 estabeleceu inicialmente que `agents` dependeria apenas de `shared`, enquanto os documentos de arquitetura reservaram ao futuro Orchestrator a coordenação do pipeline completo. Essa regra era suficiente enquanto os agentes ainda eram apenas diretórios reservados, mas não define como um agente concreto deve reutilizar as fronteiras públicas já implementadas sem duplicar seus comportamentos.

Também era necessário decidir onde residem os assets versionados do agente, como separar dados não confiáveis de configuração server-side, como distinguir rejeição funcional de falha técnica e quais responsabilidades continuam reservadas ao Orchestrator.

## Decision

O Product Owner Agent pertence ao workspace `agents/product-owner`. Sua factory valida as dependências e o bundle de assets uma vez, antes de aceitar requests. A fachada criada representa uma única tentativa do agente e compõe, nesta ordem:

1. validação do request;
2. carregamento do contexto `PRODUCT_OWNER` pelo Knowledge Loader;
3. projeção do conhecimento e da demanda em contextos não confiáveis do prompt;
4. uma execução pelo Agent Runner;
5. validação estrutural e declarativa pelo Response Validator;
6. Business Validation específica de Product Owner;
7. geração determinística de drafts pelo Artifact Generator;
8. projeção de um resultado público imutável.

Essa composição é local a uma tentativa. Ela não constitui o Orchestrator e não decide o fluxo entre Product Owner, Developer e QA.

### Refinamento das fronteiras do ADR-011

Agentes concretos podem depender dos entrypoints públicos dos componentes genéricos de `core` estritamente necessários para executar sua própria tentativa. Essa permissão não autoriza deep imports nem torna os componentes genéricos conscientes de agentes concretos.

O Product Owner Agent pode depender de:

- `@brq/knowledge-loader`;
- `@brq/agent-runner`;
- `@brq/response-validator`;
- `@brq/artifact-generator`;
- componentes transversais de `@brq/shared`;
- tipos, schemas declarativos e as funções públicas `canonicalizeJson`, `calculateCanonicalJsonHash` e `calculatePromptHash` de `@brq/prompt-builder`.

O acesso limitado ao entrypoint do Prompt Builder evita duplicar as regras canônicas de JSON e hashing utilizadas para validar e vincular assets. O Product Owner Agent não chama nem injeta `PromptBuilder.build`; o Agent Runner continua sendo o único consumer dessa operação dentro da tentativa.

O agente não depende de AI Provider, OpenAI, adapters concretos, Prisma, repositories, aplicações, frontend, API, Orchestrator, Execution Engine ou outro agente. Product Owner, Developer e QA não se comunicam diretamente.

### Request e trust boundaries

O request separa metadados de execução de uma demanda não confiável. IDs, tentativa, versão do agente, modelo e limites técnicos são fornecidos pela composição server-side. Título, descrição, objetivo de negócio, usuários, constraints, prazo, prioridade e contexto adicional são tratados como dados.

O agente solicita sempre o contexto lógico `PRODUCT_OWNER`; o caller não escolhe documentos, locators ou categorias. O resultado do Knowledge Loader é revalidado e projetado como:

- `context:product-owner-knowledge`, do tipo `KNOWLEDGE`, serialização `TEXT`, com conteúdo e `contextHash` preservados e references limitadas a ID, categoria e hash;
- `context:product-owner-request`, do tipo `USER_INPUT`, serialização `JSON`, contendo somente demanda e contexto adicional, com hash calculado sobre JSON canônico.

Ambos permanecem no canal `INPUT` e com trust `UNTRUSTED`. Conteúdo de usuário ou da Knowledge Layer nunca é concatenado ao template, promovido para regras ou inserido no canal `INSTRUCTIONS`.

### Assets declarativos e versionados

Os assets de produção residem em `prompts/product-owner/1.0.0/` e formam um bundle declarativo, validado, hashado e profundamente imutável. O bundle inicial usa:

| Asset                  | ID                                     | Versão  |
| ---------------------- | -------------------------------------- | ------- |
| Manifest               | `assets:product-owner`                 | `1.0.0` |
| Prompt template        | `prompt:product-owner`                 | `1.0.0` |
| Regras globais         | `rules:global-baseline`                | `1.0.0` |
| Regras de segurança    | `rules:security-baseline`              | `1.0.0` |
| Regras do agente       | `rules:product-owner`                  | `1.0.0` |
| Output contract        | `contract:product-owner-specification` | `1.0.0` |
| Artifact specification | `artifacts:product-owner`              | `1.0.0` |

O template usa `schemaVersion: 1.0.0`. O manifest vincula filenames, identidades e versões; o loader calcula e verifica os hashes de cada asset, do Validation Contract derivado e do bundle completo. O `bundleHash` esperado fica fixado para o release 1.0.0, de modo que qualquer alteração de conteúdo exija uma nova versão declarada. O JSON Schema inicial usa um subconjunto deliberadamente conservador, sem `$schema` e `uniqueItems`, visando compatibilidade com Structured Outputs nos modelos-base suportados pelo adapter. Modelos fine-tuned exigem verificação explícita de compatibilidade e permanecem um risco conhecido. Não existe seleção dinâmica por conteúdo do modelo, hot reload, registry global ou persistência de PromptVersion nesta Sprint.

Identidade, regras, segurança, objetivo, responsabilidades, processo, output contract e instrução final pertencem a `INSTRUCTIONS/TRUSTED`. Conhecimento, demanda e constraints pertencem a `INPUT/UNTRUSTED`. O output contract é `JSON_SCHEMA`, provider-neutral, e a mesma definição estrutural é vinculada ao Validation Contract.

### Validação em duas camadas

O Response Validator continua responsável por finish reason, presença de conteúdo, JSON, JSON Schema e coerência de structured output. Um `ValidationResult` com `valid: false` encerra a tentativa como outcome `VALIDATION_REJECTED`; ele não lança erro técnico, não chama Business Validation, não gera artifacts e não autoriza retry.

Quando o Validator aceita a resposta, a Business Validation do Product Owner interpreta o valor como `ProductOwnerSpecification` e verifica invariantes específicas que não pertencem ao Validator genérico, incluindo IDs, referências, completude e coerência entre perguntas abertas e readiness. Ela não corrige, completa ou reescreve a saída. Seu retorno interno imutável contém `valid`, `expectedReadiness`, `issues` e `issuesTruncated`; no máximo 100 issues são expostas. Falhas de parse ou de invariantes encerram a tentativa como `VALIDATION_REJECTED`, com `rejectedAt: BUSINESS_VALIDATION`, sem gerar artifacts.

Readiness é uma classificação funcional, distinta de estado de execução:

- `READY`: nenhuma pergunta aberta e nenhuma premissa pendente de validação;
- `PARTIALLY_READY`: existem somente perguntas `NON_BLOCKING` ou premissas com `requiresValidation: true`, e a especificação possui a completude mínima exigida;
- `REQUIRES_CLARIFICATION`: existe ao menos uma pergunta `BLOCKING`.

`REQUIRES_CLARIFICATION` ainda é uma especificação estruturalmente válida e pode gerar drafts. Uma futura política do Orchestrator decidirá se essa readiness deve produzir `REQUIRES_REVIEW`. O código técnico `PRODUCT_OWNER_AGENT_VALIDATED_OUTPUT_INCOMPATIBLE` fica reservado a uma violação do contrato da dependência injetada — por exemplo, o Response Validator reportar `valid: true` sem um envelope `JSON_SCHEMA`; uma saída funcional inválida do modelo permanece rejeição, não exception.

### Resultado e artifacts

O resultado público é uma união discriminada:

- `GENERATED`, com a especificação tipada, readiness, três artifacts gerados e metadados técnicos;
- `VALIDATION_REJECTED`, sem specification, com lista vazia de artifacts, `rejectedAt: RESPONSE_VALIDATION | BUSINESS_VALIDATION` e a classificação sanitizada da validação.

A Artifact Specification server-side é a única fonte de templates, bindings, nomes, filenames, tipos lógicos e media types. Campos de artifact sugeridos pelo modelo não substituem essa configuração.

O bundle inicial produz, na ordem declarada:

1. `story.md`;
2. `acceptance.md`;
3. `backlog.json`.

`story.md` reúne title, readiness, summary, objective, context, User Story, assumptions e out of scope. `acceptance.md` reúne acceptance criteria, business rules, scenarios, dependencies, risks, open questions e Definition of Ready. `backlog.json` preserva `backlogItems` como JSON estruturado.

Esses valores são `ArtifactDrafts` em memória. O agente não cria `ArtifactCreateInput`, não atribui ID, versão, timestamp ou provenance persistida, não escreve arquivos e não chama repository.

### Timeout, cancelamento e retry

O Product Owner Agent não cria timers nem implementa timeout próprio. O timeout técnico é encaminhado ao Agent Runner e aplicado pelo AI Provider. O mesmo `AbortSignal` recebido é encaminhado ao Runner; checkpoints locais podem impedir o início de uma fase posterior, mas o contrato atual do Knowledge Loader não permite interromper uma leitura já iniciada.

Nenhuma falha gera retry no agente. Retry funcional, nova `AgentExecution`, backoff e limites de tentativas continuam sob responsabilidade do futuro Orchestrator. Retries técnicos permitidos dentro do provider permanecem regidos pelo ADR-013.

### Erros e observabilidade

Rejeição funcional é resultado; exceptions representam somente falhas técnicas, cancelamento ou timeout. `ProductOwnerAgentError` preserva código, estágio, duração, correlação e código seguro da causa quando disponível, sem expor payload ou mensagem crua do componente interno.

A factory pode falhar em `ASSET_VALIDATION`. Depois de criada a fachada, os estágios de uma tentativa são:

- `REQUEST_VALIDATION`;
- `KNOWLEDGE_LOADING`;
- `CONTEXT_PROJECTION`;
- `RUNNER_EXECUTION`;
- `RESPONSE_VALIDATION`;
- `BUSINESS_VALIDATION`;
- `ARTIFACT_GENERATION`;
- `FINALIZATION`.

Eventos da fachada registram somente IDs, versões, hashes, quantidades, bytes, durações, provider, modelo, finish reason, outcome, readiness, códigos de issues, estágio e código de erro. Nunca registram demanda, contexto, prompt, regras, schema completo, resposta, valor validado, perguntas, riscos, conteúdo dos drafts, segredos, headers, cookies, stack ou causa crua.

### Responsabilidades futuras

O Product Owner Agent não cria ou altera estados de `Execution` ou `AgentExecution`, não persiste logs ou artifacts, não seleciona o próximo agente, não executa revisão humana e não coordena Developer ou QA. O Orchestrator futuro receberá o resultado da tentativa e será responsável por workflow, estado, retries, revisão, enriquecimento de drafts e persistência.

## Consequences

- o primeiro agente reutiliza contratos públicos existentes sem duplicar Prompt Builder, provider, validação ou rendering;
- o ADR-011 passa a permitir dependências direcionadas de agentes concretos para entrypoints públicos de componentes genéricos de `core`;
- componentes genéricos continuam sem importar agentes concretos;
- rejeição funcional, readiness e falha técnica permanecem conceitos separados;
- assets e filenames são controlados pela aplicação, não pelo modelo;
- hashes e versões permitem detectar drift entre prompt, schema, validação e geração;
- o pipeline de uma tentativa pode ser testado integralmente com fakes, sem OpenAI, banco ou filesystem;
- cancelamento durante uma leitura já iniciada do Knowledge Loader permanece uma limitação conhecida;
- semantic quality, workflow multiagente, retry, persistência e revisão humana continuam responsabilidades posteriores.
