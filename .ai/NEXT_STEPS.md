# Next Steps

## Sprint atual

Sprint 22 — Code Generation & Controlled Workspace implementada localmente após aprovação do
plano. `agents/code-generator` gera somente bundles textuais validados e
`core/controlled-workspace` planeja e materializa esses dados sob uma raiz controlada. As duas
fronteiras permanecem independentes e ainda não integram workflow, API, Frontend ou Factory View.
Gerar código continua explicitamente diferente de executar código.

## Próximas ações

1. Aguardar aprovação humana da Sprint 22 antes de criar qualquer commit.
2. Não integrar Code Generator ou Controlled Workspace ao workflow, API, Frontend, Factory View,
   Repository ou Observability sem uma Sprint e contratos próprios.
3. Não instalar dependências, compilar, testar, executar, publicar ou fazer preview do código
   materializado; uma futura fronteira Build/Test Runner deverá ser isolada e explicitamente
   aprovada.
4. Definir ownership, retenção, recuperação de staging órfão e limpeza de workspaces antes de uso
   operacional prolongado.
5. Preservar a `TechnicalSpecification` aprovada em uma futura integração confiável: o Execution
   Repository atual guarda somente hashes e não permite reconstruí-la por ID.
6. Manter testes e validações locais do Code Generator exclusivamente sobre `FakeAIProvider`, sem
   chamadas reais à OpenAI.
7. Planejar, em evolução contratual própria, rate limiting/lockout antes de exposição pública do
   login.
8. Planejar, em evolução contratual própria, a geração server-side dos identificadores técnicos
   ainda fornecidos pelo frontend; até lá, a unicidade global de `workflowId` permanece um risco
   residual documentado, sem exposição dos dados de outro owner.
9. Manter qualquer edição/versionamento de prompts, registry, A/B testing, evaluation framework e
   execução de provider fora do Playground até uma decisão arquitetural futura explícita.
10. Evoluir filename, media type e timestamps autoritativos de handoff somente por contrato e
    persistência próprios; a Factory atual não deve inferir esses dados.
