# Next Steps

## Sprint atual

Sprint 23 — Docker Sandbox Build & Test Runner implementada localmente após aprovação do plano.
`core/sandbox-runner` mantém um port provider-neutral e expõe Docker somente em adapter explícito.
O Runner recebe o resultado público do Controlled Workspace, verifica uma cópia limitada por stdin
e executa somente `PREPARE → TYPECHECK → BUILD → TEST` por policy confiável em container
descartável. Gerar código, materializar código e executar código permanecem três autoridades
independentes.

A imagem mínima de integração permanece versionada em `core/sandbox-runner/integration/image`,
com Node 24.19.0, TypeScript 6.0.3 e helpers fixos pinados. O teste Docker opt-in foi executado com
sucesso no Docker Desktop 4.42.0 / Engine 28.2.2, incluindo typecheck, build, teste e confirmação de
cleanup; ele continua fora dos quality gates normais e nunca constrói ou baixa a imagem
automaticamente.

## Próximas ações

1. Aguardar aprovação humana da Sprint 23 antes de criar qualquer commit.
2. Não integrar Code Generator, Controlled Workspace ou Sandbox Runner ao workflow, API, Frontend,
   Factory View, Repository ou Observability sem uma Sprint e contratos próprios.
3. Manter o adapter Docker sem execução direta no host, bind mount, rede, privileged, Docker socket,
   comandos da IA, package scripts, lifecycle scripts, instalação online ou retry.
4. Manter `test:sandbox:integration` explicitamente opt-in, fora dos quality gates normais, sem
   pull ou build automático e dependente de imagem digest-pinned preparada pelo host.
5. Definir ownership, retenção, recuperação de staging órfão e limpeza de workspaces antes de uso
   operacional prolongado.
6. Definir ownership durável e orphan recovery de containers antes de execução operacional ou
   distribuída; cleanup in-process não cobre crash do host ou daemon.
7. Preservar a `TechnicalSpecification` aprovada em uma futura integração confiável: o Execution
   Repository atual guarda somente hashes e não permite reconstruí-la por ID.
8. Tratar Preview Runner como fronteira futura independente: build bem-sucedido não autoriza
   servidor, porta, URL, container persistente, artifact export ou deploy.
9. Manter testes e validações locais do Code Generator exclusivamente sobre `FakeAIProvider`, sem
   chamadas reais à OpenAI.
10. Planejar, em evolução contratual própria, rate limiting/lockout antes de exposição pública do
    login.
11. Planejar, em evolução contratual própria, a geração server-side dos identificadores técnicos
    ainda fornecidos pelo frontend; até lá, a unicidade global de `workflowId` permanece um risco
    residual documentado, sem exposição dos dados de outro owner.
12. Manter qualquer edição/versionamento de prompts, registry, A/B testing, evaluation framework e
    execução de provider fora do Playground até uma decisão arquitetural futura explícita.
13. Evoluir filename, media type e timestamps autoritativos de handoff somente por contrato e
    persistência próprios; a Factory atual não deve inferir esses dados.
