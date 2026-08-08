# Next Steps

## Sprint atual

Sprint 20 — Prompt Playground & Agent Debugger implementada localmente após aprovação do plano. O
Playground é exclusivo para `ADMIN`, usa um runtime de inspeção separado e não executa agentes nem
acessa AI Provider/OpenAI. O hotfix separado de Structured Outputs do Developer Agent permanece
isolado.

## Próximas ações

1. Aguardar aprovação humana da Sprint 20 antes de criar qualquer commit.
2. Manter o hotfix de Structured Outputs isolado e não executar uma chamada real à OpenAI.
3. Não iniciar nenhum item da Sprint 21.
4. Planejar, em evolução contratual própria, rate limiting/lockout antes de exposição pública do
   login.
5. Planejar, em evolução contratual própria, a geração server-side dos identificadores técnicos
   ainda fornecidos pelo frontend; até lá, a unicidade global de `workflowId` permanece um risco
   residual documentado, sem exposição dos dados de outro owner.
6. Manter qualquer edição/versionamento de prompts, registry, A/B testing, evaluation framework e
   execução de provider fora do Playground até uma decisão arquitetural futura explícita.
