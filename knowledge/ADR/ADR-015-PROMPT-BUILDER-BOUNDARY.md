# ADR-015 — Prompt Builder Boundary and Deterministic Prompt Model

## Status

Accepted

## Date

2026-08-05

## Context

O ADR-009 tornou obrigatório o versionamento de prompts, o ADR-011 reservou `core/prompt-builder` e o ADR-014 definiu que o Knowledge Loader entrega contexto já carregado. Ainda era necessário definir como regras, contexto, variáveis e contratos de saída seriam compostos sem acoplar o Prompt Builder ao provider, aos agentes, à persistência ou a mecanismos de carregamento.

## Decision

O `PromptBuilder` pertence a `core/prompt-builder`. Sua transformação é pura e determinística, sem I/O de domínio ou acesso a recursos externos; o logger estruturado injetável é sua única saída lateral. Ele recebe estruturas prontas e produz um `PromptResult`; não lê arquivos, seleciona versões, carrega conhecimento, persiste dados nem conhece AI Provider, OpenAI, Responses API, Agent Runner, Orchestrator, Knowledge Source, Prisma ou frontend.

O prompt permanece estruturado até a última etapa. A hierarquia conceitual imutável possui quatro níveis: `PromptDocument`, `PromptSection`, `PromptBlock` e `PromptFragment`. Ela é representada por `PromptTemplate` antes da resolução e por `ResolvedPromptDocument` depois dela. Cada seção declara um canal semântico: identidade, regras e output contract confiáveis pertencem a `INSTRUCTIONS`; constraints, contexto e entrada não confiáveis pertencem a `INPUT`. A ordem canônica é a posição de seções, blocos e fragments em seus arrays, sem campo `order`, e somente o renderer produz os textos separados `instructions` e `input`.

Templates utilizam os slots tipados `VARIABLE_SLOT`, `CONTEXT_SLOT`, `RULE_SET_SLOT`, `CONSTRAINTS_SLOT` e `OUTPUT_CONTRACT_SLOT`. A resolução ocorre em uma única passagem: valores inseridos são dados opacos, não são reinterpretados como template e não podem introduzir novas instruções estruturais. Regras globais, regras específicas de agente, constraints, contexto estruturado e output contracts entram como dados declarativos já preparados. Fragments resolvidos de regra preservam origem por `sourceId` igual ao `ruleSetId` e `sourceItemId` igual ao `ruleId`, evitando identidades concatenadas ambíguas.

O output contract é provider-neutral e aceita `TEXT` ou `JSON_SCHEMA`. O Prompt Builder pode validá-lo, incorporá-lo à estrutura e renderizá-lo, mas não o converte para uma API específica nem valida respostas de IA. O `PromptResult` contém documento resolvido, canais renderizados, metadados, orçamento e output contract. Sua validação confirma que o contrato e a proveniência correspondem aos fragments efetivamente resolvidos na AST.

O orçamento padrão centralizado é de 128 KiB, pode ser configurado por instância e apenas reduzido pela chamada. Um preflight barato calcula um limite inferior do conteúdo e payload efetivos antes do clone por schema, da canonicalização e da renderização; referências de proveniência não são cobradas nessa estimativa. Como proteção independente contra amplificação de metadados, `maxContextReferences` limita o total de referências antes do clone, com default 256 configurável por instância e teto absoluto de schema de 4096. A medição final exata usa `instructionsBytes + inputBytes + outputContractBytes`, com o contrato serializado em JSON canônico. O Builder não resume, trunca nem omite silenciosamente seções; exceder o orçamento gera erro canônico.

Hashes SHA-256 possuem significados distintos: `templateHash` usa o JSON canônico do template; `instructionsHash` e `inputHash` usam os textos exatos dos canais; `outputContractHash` usa o JSON canônico do contrato; e `promptHash` usa o JSON canônico com promptId, agente, versões, canais e output contract. `ResolvedPromptDocument.sources` e os metadados preservam rule sets por ID, versão, scope, agente e hash e contextos por ID, tipo, serialização, contentHash, descriptorHash e referências. Essa proveniência não altera o `promptHash`, que continua representando somente a identidade e o payload efetivo.

Nesta Sprint, a comparação estrutural reporta seções adicionadas, removidas, alteradas ou reordenadas e a mudança de `promptHash`. O comparator usa um navigator interno; cada referência pública inclui `nodeType` e `path` imutável. `PromptComparison.equal` compara somente a estrutura e o payload efetivos, portanto mudanças exclusivas de proveniência podem manter a comparação igual embora hashes de fonte mudem. A estrutura permite futura recursão em blocos e fragments, sem realizar comparação semântica por IA.

Logs do módulo contêm somente metadados técnicos aplicáveis ao evento: promptId, agente, versões, hashes finais, quantidades de seções e contextos, orçamento, bytes, duração, correlação e códigos de erro. Os eventos são `prompt.build.started`, `prompt.build.completed`, `prompt.build.failed`, `prompt.validation.failed` e `prompt.budget.exceeded`. Nunca registram conteúdo do prompt, contexto, valores de variáveis, entrada do usuário, segredos ou JSON Schemas completos.

Um Prompt Manifest, assets de prompt, loader, selector, registry e consumers de produção foram considerados prematuros para esta Sprint. `prompts/` permanece reservado para artefatos versionados futuros. A Sprint 5 entrega apenas o motor determinístico e fixtures necessárias para seus testes.

## Consequences

- prompts podem ser auditados, reproduzidos e comparados antes e depois da renderização;
- entradas não confiáveis permanecem separadas de instruções por canais e delimitadores estruturais;
- testes não dependem de filesystem, banco, agentes ou chamadas de IA;
- integração futura com o Agent Runner poderá transformar o `PromptResult` em uma solicitação de provider sem alterar o Builder;
- seleção, persistência e ativação de versões continuam responsabilidades externas;
- comparação estrutural detecta mudanças de seções; a recursão em blocos e fragments permanece futura e não haverá avaliação de equivalência semântica;
- a criação de assets e de um Prompt Manifest exigirá uma necessidade concreta e uma decisão posterior.
