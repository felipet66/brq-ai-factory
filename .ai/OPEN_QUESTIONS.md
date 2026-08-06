# Open Questions

As questões abaixo devem ser resolvidas antes das Sprints relacionadas:

- confirmar o versionamento dos endpoints antes da Sprint 14;
- definir a estratégia de execução assíncrona antes de qualquer deploy;
- definir a política de retenção de logs e artefatos antes da observabilidade completa.
- definir um identificador de linhagem antes de versionar Artifacts entre Executions.
- definir, antes da integração com persistência, quais hashes da geração (`specificationHash`, `validationHash`, `generationHash` e hashes dos drafts) integrarão a provenance persistida.
- resolvido pelo ADR-022: o Orchestrator calcula hashes canônicos das specifications, verifica os hashes públicos declarados nos handoffs e mantém lineage separado de provenance. A futura persistência desses vínculos continua pendente.
