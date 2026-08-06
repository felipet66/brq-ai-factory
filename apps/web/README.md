# Web

Aplicação Next.js 16 do BRQ AI Factory.

O workspace hospeda o Frontend MVP e o adapter HTTP. As rotas implementadas são health, criação
síncrona de execução e o contrato de lookup ainda não suportado.

`src/app/page.tsx` compõe a página como Server Component. A subárvore interativa usa estado local e
delega toda comunicação a um client HTTP interno. `ExecutionResult` bruto não atravessa essa
fronteira: componentes recebem somente `ExecutionSummary`.

`src/server/runtime.ts` é o composition root lazy da aplicação. Ele monta apenas factories
públicas e fornece o `ExecutionEngine`; regras de negócio permanecem nos workspaces do núcleo. Não
existe persistência, autenticação ou workspace de runtime no domínio.

Como a API `1.0.0` exige IDs e configurações técnicas dos agentes, o client fornece um perfil
versionado e gera IDs por submissão. Essa limitação é temporária e deverá migrar para configuração
confiável no backend em uma evolução futura do contrato.

Consulte `knowledge/38-HTTP_API_FLOW.md`, `knowledge/39-FRONTEND_FLOW.md`, ADR-024 e ADR-025 para
contratos, status e fronteiras.
