# Next Steps

## Sprint atual

Sprint 19 — Authentication & Authorization concluída localmente após planejamento aprovado. Better
Auth foi mantido depois de reavaliação com Auth.js, e a página protegida `/profile` integra a
entrega. O hotfix separado de Structured Outputs do Developer Agent permanece isolado.

## Próximas ações

1. Aguardar aprovação humana da Sprint 19 antes de criar qualquer commit.
2. Manter o hotfix de Structured Outputs isolado e não executar uma chamada real à OpenAI.
3. Não iniciar nenhum item da Sprint 20.
4. Planejar, em evolução contratual própria, rate limiting/lockout antes de exposição pública do
   login.
5. Planejar, em evolução contratual própria, a geração server-side dos identificadores técnicos
   ainda fornecidos pelo frontend; até lá, a unicidade global de `workflowId` permanece um risco
   residual documentado, sem exposição dos dados de outro owner.
