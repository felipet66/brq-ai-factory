# Web

Aplicação Next.js 16 do BRQ AI Factory.

O workspace hospeda o Frontend, o adapter HTTP e o composition root da aplicação. O contrato HTTP
`3.0.0` expõe:

- `GET /api/health`;
- `POST /api/executions`, que aceita o job com `202 Accepted`;
- `GET /api/jobs/[id]`, que consulta o lifecycle persistido do job;
- `GET /api/executions`, `GET /api/executions/[id]` e
  `GET /api/executions/[id]/timeline`, que consultam o histórico durável;
- `GET /api/playground/agents`, `POST /api/playground/preview` e
  `POST /api/playground/validate`, exclusivos para `ADMIN` e sempre ephemeral.

`src/app/page.tsx` compõe a página como Server Component. A subárvore interativa usa estado local e
delega toda comunicação a clients HTTP internos. O formulário envia o POST uma única vez, recebe
`executionId` e `jobId` e navega imediatamente para `/executions/[executionId]/factory`; nenhum
estado terminal dispara novo dispatch.

A Factory é uma rota autenticada dedicada e mantém `/executions/[id]` como detalhe técnico. Seu
controller consulta somente `GET /api/jobs/[id]` enquanto o job estiver enfileirado, somente
`GET /api/executions/[id]/timeline` durante a execução e atualiza o detalhe uma vez ao chegar a um
estado terminal. `GET /api/executions/[id]` projeta a metadata minimizada do job já persistido para
permitir deep links sem endpoint agregado ou query adicional.

Componentes da Factory consomem exclusivamente o `FactoryViewModel` frontend, derivado de dados
públicos reais. Não existem conversa entre agentes, fases live de validação ou artifact generation,
filenames inferidos ou timestamp autoritativo de handoff. O activity feed usa somente metadata de
job e eventos tipados da Timeline.

`src/server/runtime.ts` é o composition root lazy da aplicação. Ele monta apenas factories
públicas e fornece o Engine persistente/observado, o `ExecutionRecordRepository`, o
`InMemoryJobQueue`, o dispatcher e o único Execution Worker sequencial. Regras de negócio
permanecem nos workspaces do núcleo e nenhum workspace de runtime existe no domínio.

`src/server/playground/prompt-inspection-runtime.ts` é um composition root independente. Ele
fornece somente o `PromptInspector` e adapters estáticos para Product Owner, Developer e QA. Não
importa `runtime.ts` e não pode alcançar provider, Runner, Orchestrator, Engine, Queue, Worker,
Repository ou Observability.

O dispatcher persiste a metadata `QUEUED` antes de disponibilizar o payload à fila. O signal da
requisição HTTP termina quando o POST é aceito; o Worker possui seu próprio `AbortController` para
cancelamento e shutdown cooperativos. Polling é somente leitura e não representa retry.

O default do Prompt Builder permanece em 128 KiB. O host da AI Factory configura explicitamente
um orçamento de 512 KiB para suportar o pipeline multiagente e os contratos funcionais reais. Essa
é uma configuração do composition root, permanece abaixo do teto de 1 MiB aceito pelos agentes e
não altera o default nem o algoritmo de budget do módulo.

Fila e payload são locais ao processo. Um restart perde jobs ativos, múltiplas instâncias possuem
filas independentes e não existe recovery, retry ou garantia de continuidade em host serverless.
As projeções de job e execução persistem somente metadados técnicos permitidos; prompts, demanda
detalhada, knowledge, respostas e artifacts não são persistidos pela fila.

O request de execução ainda exige IDs e configurações técnicas dos agentes. O client fornece um perfil
versionado e gera esses IDs por submissão como limitação temporária; `executionId` e `jobId`
permanecem exclusivamente sob responsabilidade do backend.

Consulte `knowledge/38-HTTP_API_FLOW.md`, `knowledge/39-FRONTEND_FLOW.md`,
`knowledge/41-EXECUTION_REPOSITORY_FLOW.md`, `knowledge/42-JOB_QUEUE_FLOW.md`,
`knowledge/44-PROMPT_PLAYGROUND_FLOW.md`, `knowledge/45-FACTORY_VISUALIZATION_FLOW.md` e os ADRs 024,
025, 027, 028, 030 e 031 para contratos, status e fronteiras.
