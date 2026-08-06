# Web

Aplicação Next.js 16 do BRQ AI Factory.

Desde a Sprint 14, o workspace hospeda a página inicial e o adapter HTTP em `src/app/api`. As
rotas implementadas são health, criação síncrona de execução e o contrato de lookup ainda não
suportado.

`src/server/runtime.ts` é o composition root lazy da aplicação. Ele monta apenas factories
públicas e fornece o `ExecutionEngine`; regras de negócio permanecem nos workspaces do núcleo.
Não existe persistência, autenticação, frontend funcional ou workspace de runtime no domínio.

Consulte `knowledge/38-HTTP_API_FLOW.md` e o ADR-024 para contratos, status e fronteiras.
