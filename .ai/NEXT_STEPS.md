# Next Steps

## Sprint atual

Sprint 24 — End-to-End Factory Pipeline Integration implementada localmente após aprovação do
plano. `@brq/factory-pipeline` compõe externamente `Execution Engine → Code Generator → Controlled
Workspace → Sandbox Runner` sem alterar funcionalmente Orchestrator ou Execution Engine.

`FactoryExecutionResult` é aditivo e terminaliza a Factory somente depois de
`PREPARE → TYPECHECK → BUILD → TEST` e do release confirmado do workspace. Observability `2.0.0`,
persistência normalizada opcional e a linha técnica da Factory View preservam compatibilidade com
execuções históricas `1.0.0`.

## Próximas ações

1. Aguardar aprovação humana da Sprint 24 antes de criar qualquer commit.
2. Não iniciar Preview Runner, servidor do projeto gerado, iframe, portas, deploy ou qualquer item
   da Sprint 25 sem planejamento e aprovação próprios.
3. Manter `gerar código ≠ materializar código ≠ executar código`; nenhuma dessas fronteiras deve
   receber internals da anterior.
4. Manter Docker real explicitamente configurado e digest-pinned, sem fallback automático para
   fake, pull/build automático, rede, privileged, bind mount, Docker socket ou execução no host.
5. Manter testes Docker e do Factory Pipeline real exclusivamente opt-in, fora de `test`,
   `test:coverage` e `build`.
6. Definir recovery explícito para processo/host que caia durante staging, workspace materializado
   ou container; a Sprint 24 garante cleanup in-process, não recuperação distribuída.
7. Não persistir código, prompts, specifications completas, respostas, stdout/stderr ou
   filesystem; novas necessidades de inspeção exigem contrato e threat model próprios.
8. Preservar Observability `1.0.0` e read models históricos; mudanças futuras devem ser
   versionadas e aditivas.
9. Manter falha de build/test como resultado funcional `FAILED`, transportado normalmente pela
   API, e não como erro HTTP de infraestrutura.
10. Manter testes e validações locais dos agentes exclusivamente com `FakeAIProvider`, sem chamadas
    reais à OpenAI.
11. Planejar rate limiting/lockout antes de exposição pública do login.
12. Planejar geração server-side dos identificadores técnicos ainda fornecidos pelo frontend; a
    unicidade global de `workflowId` continua um risco residual conhecido.
13. Não adicionar retry, self-healing ou correção autônoma de código sem uma decisão arquitetural
    futura explícita.
