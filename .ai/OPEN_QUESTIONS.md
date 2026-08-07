# Open Questions

As questões abaixo devem ser resolvidas antes das Sprints relacionadas:

- resolvido pelos ADRs 024 e 028: os endpoints permanecem sem prefixo; o contrato assíncrono usa
  `apiVersion` `2.0.0` e mudança incompatível exige nova decisão;
- resolvido pelo ADR-028: a estratégia assíncrona inicial usa fila FIFO local em memória e um único
  Execution Worker sequencial, sem retry ou requeue. Antes de produção distribuída ainda será
  necessário decidir um adapter durável: restart perde payloads ativos, múltiplas instâncias têm
  filas independentes e hosts serverless podem suspender o processo após o `202 Accepted`;
- definir a política de retenção de logs e artefatos antes da observabilidade completa.
- definir um identificador de linhagem antes de versionar Artifacts entre Executions.
- definir, antes da integração com persistência, quais hashes da geração (`specificationHash`, `validationHash`, `generationHash` e hashes dos drafts) integrarão a provenance persistida.
- resolvido pelo ADR-022: o Orchestrator calcula hashes canônicos das specifications, verifica os hashes públicos declarados nos handoffs e mantém lineage separado de provenance. A futura persistência desses vínculos continua pendente.
