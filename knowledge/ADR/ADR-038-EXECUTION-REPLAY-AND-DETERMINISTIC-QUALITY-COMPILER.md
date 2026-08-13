# ADR-038 — Execution Replay and Deterministic Quality Compiler

## Status

Accepted

## Date

2026-08-12

## Context

Execuções greenfield reais demonstraram duas fontes independentes de instabilidade e custo:

- etapas generativas já concluídas eram chamadas novamente depois de uma falha downstream;
- o QA gerava por IA uma matriz que era imediatamente recalculada por regras determinísticas de
  Business Validation.

Na falha que motivou esta decisão, o QA consumiu 39.282 tokens de entrada e 11.059 de saída, teve
seu JSON aceito pelo schema e foi rejeitado depois por `QA_CATEGORY_MISMATCH`. O Code Generator não
consome o conteúdo da `QASpecification`; ele depende da aprovação e do hash do handoff. A evidência
real de qualidade do código continua sendo produzida pelos gates de profile, workspace e Sandbox.

O ADR-027 proibiu a persistência do request funcional no aggregate de histórico. Essa minimização
continua correta para consultas e logs, mas impede replay autorizado pelo próprio usuário. O replay
precisa de uma raiz privada separada, com acesso por owner, sem ampliar o contrato público do
histórico.

## Decision

### QA no caminho crítico

O estágio `QA` do workflow passa a usar um compilador determinístico de contrato de qualidade. Ele:

1. recebe as `ProductOwnerSpecification` e `TechnicalSpecification` já validadas;
2. deriva readiness sem criar dúvidas ou premissas novas;
3. compila cenários e rastreabilidade canônicos;
4. passa pelos mesmos schemas, Business Validation e Artifact Generator;
5. registra uso de zero tokens e não invoca `AIProvider`.

O QA generativo e todos os seus bundles versionados permanecem imutáveis e disponíveis para
composição consultiva explícita fora da Factory. O Playground apenas inspeciona o bundle/prompt e
valida candidates manuais; não executa essa fachada. O QA generativo deixa de ser um gate
probabilístico da Factory. Essa decisão não afirma que o compilador executa testes ou revisa código.
A aprovação operacional continua pertencendo aos gates downstream de profile, materialização,
typecheck, build e test.

Não se funde QA ao Developer: auto-revisão pelo mesmo modelo aumentaria o payload e manteria a
mesma fonte probabilística. Uma futura revisão por Tech Lead pode ser adicionada como etapa humana
ou consultiva, mas não como requisito para compilar invariantes que o backend já conhece.

### Snapshot privado do request

Cada nova execução aceita persiste uma cópia imutável do `ExecutionRequest` validado em uma raiz
separada do histórico público. O snapshot é correlacionado por `executionId`, `ownerId` e hash
canônico. Consultas exigem o mesmo owner e retornam ausência para outro usuário.

O snapshot pode conter demanda e contexto adicional porque isso foi explicitamente autorizado para
replay. Ele não pode conter prompt montado, documentos de knowledge, credenciais, headers, cookies,
logs, errors crus ou objetos de runtime. Nenhum desses valores pode aparecer em logs ou nas APIs de
histórico.

Esta seção refina somente a proibição de persistência funcional do ADR-027 para a raiz privada de
replay; o aggregate `ExecutionRecord` e suas projeções públicas continuam minimizados.

### Checkpoints exatos de respostas de IA

Um decorator de `AIProvider` calcula o `requestHash` canônico sobre o `AIRequest` completo. Somente
respostas `COMPLETED`, validadas pelo contrato técnico, podem concluir a persistência. Cada linha
nasce como claim `PENDING`; após a transição atômica, o estado `COMPLETED` constitui o checkpoint
imutável identificado por `(executionId, agent)` e contém também `provider`, `requestHash`, a
resposta e seu `responseHash` de integridade. A linha não contém o request nem o prompt em claro.

Esses checkpoints pertencem à execução que consumiu a resposta. Eles não formam um cache global e
uma execução normal não reutiliza oportunisticamente a resposta de outra execução, mesmo quando os
requests são semanticamente ou byte a byte iguais. Em `READ_WRITE`, a primeira execução continua
delegando ao provider para Product Owner, Developer e Code Generator e grava somente seus sucessos
completos. Falha de leitura ou escrita não autoriza retry do provider. O QA crítico é compilado
deterministicamente, usa zero tokens e por isso não exige checkpoint de IA.

Antes de delegar ao provider, o decorator adquire atomicamente um claim `PENDING` para
`(executionId, agent)`. Somente o dono desse claim pode concluir o checkpoint. Um concorrente
observa `IN_PROGRESS` e falha fechado, sem realizar uma segunda chamada paga. Em uma falha ordinária
do provider, o decorator tenta remover apenas o claim pertencente à tentativa; respostas completas
passam para `COMPLETED` de forma atômica. Crash do processo ou falha da própria persistência podem
deixar um `PENDING` órfão. Não há TTL, lease, reaper nem recuperação automática: essa coordenada
permanece bloqueada e exige auditoria/intervenção operacional, sempre sem fallback para IA.

O rerun usa obrigatoriamente `REQUIRE_HIT` e informa explicitamente o `sourceExecutionId`. Para cada
etapa generativa, o decorator busca somente o checkpoint `(sourceExecutionId, agent)`, confirma
`provider`, `requestHash` — que já inclui o modelo solicitado —, `responseHash` e
`finishReason: COMPLETED` e nunca delega ao provider real. A resposta exata é copiada para
`(executionId filho, agent)` antes de ser devolvida, preservando a cadeia para futuros reruns. O
modelo resolvido/versionado informado pelo provider pode diferir do alias solicitado e é preservado
como evidência. O conteúdo original é preservado, mas duração e tokens da nova execução são
reportados como zero. Ausência, erro de leitura, falha de cópia ou violação de integridade falham
fechados com reason code estável.

Nenhuma normalização por regex, remoção de campos do prompt ou compartilhamento por similaridade é
permitido. Uma mudança de prompt, knowledge, modelo, output contract ou profile muda o request
efetivo e impede o uso do checkpoint incompatível.

### Semântica de rerun

Rerun nunca reabre nem altera a execução de origem. Ele cria novo workflow, novos agent execution
IDs, novo `executionId` e novo job, mantendo a origem apenas como evidência de replay.

O endpoint de rerun:

- exige autenticação, same-origin e ownership;
- aceita somente corpo vazio e nenhum query parameter;
- aceita somente uma origem terminal com Code Generator concluído;
- usa o snapshot privado e owner-scoped já validado;
- verifica, antes do enqueue, os checkpoints íntegros de Product Owner, Developer e Code Generator;
- agenda exclusivamente em modo `REQUIRE_HIT`;
- informa explicitamente que OpenAI não será chamada;
- copia os checkpoints consumidos para a execução filha;
- falha sem custo quando algum resultado exigido estiver ausente, corrompido ou incompatível.

Não existe fallback silencioso para `READ_WRITE`, retry automático ou correção semântica de
outputs. Para produzir uma etapa nunca gerada, o usuário deve iniciar conscientemente uma execução
normal.

## Consequences

- falhas downstream podem ser reproduzidas sem repetir chamadas de IA já concluídas;
- reruns cache-only aprovados no preflight possuem custo de IA deterministicamente zero e não
  possuem fallback para OpenAI;
- a primeira execução continua usando IA para Product Owner, Developer e Code Generator;
- checkpoints isolados por execução e agente evitam que respostas divergentes de execuções distintas
  sejam confundidas, mesmo quando compartilham o mesmo `requestHash`;
- a cópia para a execução filha permite uma cadeia de reruns sem depender de cache global;
- a Factory deixa de pagar para o modelo montar relações que o backend consegue compilar;
- schemas, Business Validation, Code Generator eligibility, Controlled Workspace e Sandbox não são
  relaxados;
- execuções anteriores à migration não ganham snapshots ou respostas retroativamente e não podem
  ser prometidas como replayáveis;
- mudanças de prompt, knowledge, modelo, output contract ou profile tornam o checkpoint
  incompatível e causam miss seguro, sem chamada externa;
- o banco local passa a conter conteúdo funcional privado necessário ao replay e deve receber a
  mesma proteção e política de backup aplicadas aos demais dados do usuário.

## Out of scope

Cache aproximado, normalização semântica de prompts, retry com IA, backfill de execuções antigas,
execução real da OpenAI, execução Docker durante a entrega, novo bundle de prompt e substituição
dos gates de código downstream.
