# Code Generator Agent

O Code Generator transforma uma `TechnicalSpecification` aprovada em um
`GeneratedCodeBundle` textual, estruturado, rastreável e imutável.

## Fronteira

O módulo recebe evidência `WORKFLOW_QA_READY`, valida a elegibilidade de um
snapshot composto exclusivamente por mudanças `CREATE`, carrega o contexto
`CODE_GENERATOR`, usa o `AgentRunner`, aplica o `ResponseValidator`, executa a
Code Business Validation e monta hashes, manifest, lineage e provenance no
servidor.

O modelo produz somente `files` e `entrypoints`. Ele nunca fornece hashes ou
metadata autoritativa.

## Segurança

- não importa nem chama o AI Provider diretamente;
- não usa o Artifact Generator;
- não acessa filesystem, shell, rede, Repository, Engine ou Orchestrator;
- não executa código gerado;
- não produz binários;
- rejeita paths inseguros, colisões portáveis, conteúdo inválido e referências
  técnicas desconhecidas;
- não registra prompts, especificações ou conteúdo dos arquivos.

O bundle permanece dado não confiável. A fronteira Controlled Workspace deve
revalidar paths, limites e hashes antes de materializar qualquer arquivo.

## Limites do release 1.0.0

- TechnicalSpecification: 224 KiB;
- Knowledge: 4 documentos e 48 KiB;
- Prompt: 384 KiB;
- saída do provider: 131072 tokens;
- 96 arquivos;
- 64 KiB por arquivo;
- 384 KiB de conteúdo total;
- 16 entrypoints.

O `bundleContentHash` usa o domínio `brq.code-bundle-content.v1\n` seguido da
projeção canônica e ordenada de path, encoding, media type, purpose, tamanho e
content hash. Timestamps e durações permanecem observacionais e fora dos hashes.
