# Next Steps

## Sprint atual

Sprint 25 — Preview Runner & View Build implementada localmente após aprovação do plano.
`@brq/preview-artifact` preserva uma cópia estática efêmera e `@brq/preview-runner` controla o
lifecycle do container Preview sem reter o Controlled Workspace nem alterar o Factory Pipeline.

O hotfix Developer `1.0.3` está aplicado localmente: ele mantém o schema e a Business Validation,
mas explicita a tabela de readiness nos assets para evitar `DEVELOPER_READINESS_MISMATCH` quando
existirem perguntas não bloqueantes ou premissas ainda pendentes de validação.

O hotfix QA `1.0.1` também está aplicado localmente: preserva o schema e a Business Validation,
mas explicita a correspondência obrigatória entre coverage/matrix e referências dos cenários e a
tabela de readiness das duas fontes, bloqueios, dúvidas e premissas.

Um candidato somente é aprovado depois de `Factory SUCCESS` persistido, Sandbox bem-sucedido,
hashes correlacionados e release confirmado. O fluxo público é
`Factory SUCCESS → Start Preview → RUNNING → View Build → Stop | Expire → cleanup confirmado`, com
origin exclusiva, autenticação/ownership, ticket single-use, cookie Preview próprio e TTL.

## Próximas ações

1. Aguardar revisão e aprovação humanas da Sprint 25 antes de criar qualquer commit.
2. Não iniciar infraestrutura de produção, DNS/TLS operacional, deploy, Preview distribuído,
   retry, self-healing ou qualquer item da Sprint 26 sem planejamento e aprovação próprios.
3. Manter
   `gerar código ≠ materializar código ≠ executar build/test ≠ produzir artifact ≠ servir Preview`;
   nenhuma fronteira deve receber internals, filesystem ou autoridade da anterior.
4. Preservar `NODE_WEB_PREVIEW_24_V1` estrito e fail-closed. Projetos incompatíveis não devem
   executar servidor, comando, package script ou policy alternativa para produzir um Preview.
5. Manter as imagens Factory e Preview separadas, explícitas e digest-pinned, sem fallback para
   fake, pull/build automático, privileged, bind mount, Docker socket, egress ou execução direta no
   host.
6. Manter os testes Docker reais de Sandbox, Factory e Preview exclusivamente opt-in e fora de
   `test`, `test:coverage` e `build`; o teste Preview deve preservar o caminho completo
   `Artifact → Start → Health → conteúdo → Stop → Cleanup`.
7. Não publicar porta do container Preview. O relay fixo pode escutar somente em `127.0.0.1`,
   exigir capability efêmera, acessar o container pelo helper `docker exec` allowlisted e
   permanecer privado ao composition root.
8. Manter TTL, stop, expiração e reconciliação convergindo para cleanup idempotente e confirmado de
   relay, container, network e artifact. Recovery distribuído após perda total do host continua não
   implementado.
9. Não persistir código, prompts, specifications, respostas, stdout/stderr, filesystem, host paths,
   portas, container IDs, cookies ou tickets em claro; novas necessidades exigem contrato e threat
   model próprios.
10. Preservar origin exclusiva, autenticação e ownership em todo launch. Ticket é curto, single-use
    e armazenado somente como hash; o cookie Preview não substitui a sessão da Factory.
11. Manter API e Frontend sobre read models minimizados; nenhum locator Docker ou artifact deve
    atravessar o contrato HTTP.
12. Manter testes e validações locais dos agentes exclusivamente com `FakeAIProvider`, sem chamadas
    reais à OpenAI.
13. Planejar rate limiting/lockout antes de exposição pública do login e capacity controls
    distribuídos antes de qualquer deployment multi-instance.
14. Planejar geração server-side dos identificadores técnicos ainda fornecidos pelo frontend; a
    unicidade global de `workflowId` continua um risco residual conhecido.
15. Preservar os bundles Developer `1.0.0`–`1.0.2`; qualquer evolução posterior ao `1.0.3` deve
    permanecer versionada, manter a Business Validation autoritativa e ser validada sem provider
    real.
16. Preservar o bundle QA `1.0.0`; evoluções posteriores ao `1.0.1` devem manter schema e Business
    Validation autoritativos e validar coverage, matrix e readiness sem provider real.
