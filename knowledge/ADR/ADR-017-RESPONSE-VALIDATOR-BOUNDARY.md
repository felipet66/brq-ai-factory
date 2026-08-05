# ADR-017 — Response Validator Boundary and Deterministic Validation

## Status

Accepted

## Date

2026-08-05

## Context

O ADR-003 tornou obrigatória a saída JSON para os agentes concretos, o ADR-013 reservou a validação funcional ao Response Validator e o ADR-016 definiu `AgentRunResult` como a projeção pública e ainda não confiável de uma execução. Faltava estabelecer como validar esse resultado sem expor o `AIResponse` interno, repetir responsabilidades do Agent Runner ou antecipar regras específicas de Product Owner, Developer e QA.

## Decision

O `ResponseValidator` pertence ao workspace `core/response-validator`. Em produção, ele depende somente da API pública de `@brq/agent-runner`, de componentes transversais de `@brq/shared` e do validador de JSON Schema adotado pelo próprio módulo. Ele não importa internals do Runner, Prompt Builder, AI Provider, adapters concretos, agentes, Orchestrator, Artifact Generator, Prisma ou aplicações.

A operação recebe um `ValidationRequest` formado por um `AgentRunResult` imutável e por um `ValidationContract` provider-neutral e versionado. O resultado do Runner é dado não confiável. O contrato funcional vem de configuração server-side confiável, mas também é validado na fronteira. `expectedOutputContractHash` deve corresponder ao hash registrado nos metadados do prompt, e ID, versão, formato e schema do contrato funcional devem corresponder ao output contract carregado no resultado da execução. Uma divergência produz `ResponseValidatorError` técnico e não é atribuída à resposta do modelo.

A validação segue uma `ValidationPipeline` linear e determinística:

1. validar request e coerência do contrato;
2. classificar o `finishReason`;
3. verificar a presença do conteúdo;
4. selecionar o fluxo `TEXT` ou `JSON_SCHEMA`;
5. para JSON, interpretar novamente o texto original e validar o valor obtido contra o schema;
6. comparar o valor reinterpretado com `structuredData`, quando aplicável;
7. consolidar findings em um `ValidationReport` interno;
8. projetar um `ValidationResult` público, profundamente imutável.

O `ValidationReport` é uma fronteira interna preparada para futura composição de validadores. Ele não integra os exports públicos. O `ValidationResult` expõe somente classificação, issues, metadados de origem, hashes e o valor validado quando a resposta é aceita. O `AgentRunResult` recebido nunca é alterado, normalizado ou corrigido.

`COMPLETED` é o único finish reason que permite validar o conteúdo. `MAX_OUTPUT_TOKENS`, `CONTENT_FILTER` e `REFUSAL` produzem issues funcionais próprias e encerram a pipeline sem tentar interpretar conteúdo potencialmente incompleto ou recusado. Essa classificação não autoriza retry.

Para `TEXT`, o conteúdo deve existir e não pode ser vazio após a verificação de presença; o valor original é preservado sem trim ou reescrita. O suporte a texto mantém o componente genérico, embora Product Owner, Developer e QA continuem obrigados pelo ADR-003 a utilizar contratos JSON.

Para `JSON_SCHEMA`, o contrato declara obrigatoriamente o dialect literal `DRAFT_2020_12`. `output.content` é a fonte autoritativa. O Validator executa um novo parse e valida o valor obtido contra o schema funcional com Ajv 8 em modo Draft 2020-12 e estrito. `structuredData` nunca é aceito isoladamente: quando presente, ele também é revalidado e precisa ser coerente com o valor reinterpretado. Sua ausência gera `STRUCTURED_DATA_UNAVAILABLE` como warning quando o valor reinterpretado não é `null`, mas não invalida conteúdo que foi validado localmente. O módulo não aplica defaults, coerção, remoção de propriedades, resolução remota de schemas, keywords customizadas ou qualquer mutação do payload.

Issues possuem código estável, categoria, severidade e paths técnicos seguros quando aplicáveis. O contrato reserva `INFO` para evolução compatível, mas a implementação de produção desta Sprint emite somente `ERROR` e `WARNING`. A validade é derivada da ausência de issues com severidade `ERROR`; warnings nunca são ocultados.

Limites de conteúdo, schema, profundidade de nesting e quantidade de issues pertencem à configuração da instância, com defaults centralizados e tetos absolutos. Excesso de conteúdo ou profundidade é uma falha funcional; configuração inválida, schema excessivo ou contrato impossível de compilar são falhas técnicas. Quando a lista atinge o limite, `issuesTruncated` preserva essa informação sem expandir o resultado indefinidamente.

Falhas funcionais da resposta produzem `ValidationResult`. Request, configuração ou contrato técnico inválido produzem erro canônico do módulo. O Validator não lança erro para representar refusal, truncamento, content filter, JSON malformado ou schema mismatch.

Hashes SHA-256 possuem funções distintas:

- `responseHash` é preservado do Agent Runner como identidade da resposta normalizada;
- `contentHash` identifica o texto exato recebido;
- `contractHash` identifica o contrato funcional canônico;
- `schemaHash`, quando aplicável, identifica o JSON Schema canônico;
- `validatedValueHash`, quando existente, identifica o valor aceito;
- `validationHash` identifica deterministicamente a decisão pública, sem incluir duração ou conteúdo bruto.

Os eventos do módulo registram somente IDs de correlação, provider, modelo, identidade e versão do contrato, formato, finish reason, hashes, duração, validade, quantidade e códigos de issues e indicador de truncamento. Logs nunca contêm conteúdo, `structuredData`, schema completo, valores rejeitados, mensagens cruas do engine de schema, prompts, segredos ou headers.

O Validator não executa retry, não chama IA, não monta prompts, não carrega conhecimento, não cria artifacts, não persiste dados, não altera estados e não decide revisão humana ou próximo passo. Regras semânticas específicas de agentes, avaliação de qualidade e detecção semântica de conteúdo malicioso permanecem fora desta fronteira.

## Consequences

- toda saída aceita passa por uma decisão funcional determinística e auditável;
- o `AgentRunResult` e o contrato funcional permanecem separados e comparáveis;
- a resposta original é preservada enquanto o valor validado é exposto separadamente;
- malformed JSON, schema mismatch e finish reasons não concluídos são resultados funcionais, não falhas técnicas da infraestrutura;
- a enumeração de severidade pode evoluir para findings informativos sem alterar o contrato;
- Agent Runner, providers e agentes concretos permanecem desacoplados da implementação de validação;
- retry, correção automática, semântica específica, artifact generation, persistência e workflow continuam responsabilidades posteriores.
