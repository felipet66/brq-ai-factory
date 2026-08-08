# Next Steps

## Sprint atual

Sprint 21 — Live Agent Workspace & Factory Visualization implementada localmente após aprovação do
plano. A Factory usa somente eventos e read models públicos reais, por meio de
`FactoryViewModel`, e não executa agentes nem acessa AI Provider/OpenAI. O hotfix separado de
Structured Outputs do Developer Agent permanece isolado.

## Próximas ações

1. Aguardar aprovação humana da Sprint 21 antes de criar qualquer commit.
2. Manter o hotfix de Structured Outputs isolado e não executar uma chamada real à OpenAI.
3. Não iniciar nenhum item da Sprint 22.
4. Planejar, em evolução contratual própria, rate limiting/lockout antes de exposição pública do
   login.
5. Planejar, em evolução contratual própria, a geração server-side dos identificadores técnicos
   ainda fornecidos pelo frontend; até lá, a unicidade global de `workflowId` permanece um risco
   residual documentado, sem exposição dos dados de outro owner.
6. Manter qualquer edição/versionamento de prompts, registry, A/B testing, evaluation framework e
   execução de provider fora do Playground até uma decisão arquitetural futura explícita.
7. Evoluir filename, media type e timestamps autoritativos de handoff somente por contrato e
   persistência próprios; a Factory atual não deve inferir esses dados.
