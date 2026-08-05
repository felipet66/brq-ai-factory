# ADR-014 — Knowledge Loader Boundary and Deterministic Context

## Status

Accepted

## Date

2026-08-05

## Context

O ADR-005 criou a Knowledge Layer e o ADR-011 reservou `core/knowledge-loader` para seu carregamento. Ainda era necessário definir como documentos seriam autorizados, identificados, selecionados e verificados sem antecipar o Prompt Builder, o Agent Runner ou o Orchestrator.

## Decision

O `KnowledgeLoader` pertence a `core/knowledge-loader` e depende da abstração `KnowledgeSource`. `FilesystemKnowledgeSource` é a origem inicial do MVP, mas consumidores não conhecem caminhos físicos nem regras específicas de filesystem.

Os documentos permitidos são descritos por `knowledge-manifest.json`, um artefato declarativo versionado e validado por Zod durante o carregamento. JSON foi escolhido porque o manifesto contém somente dados, mantém a allowlist revisável sem executar código e não obtém vantagem concreta ao ser representado em TypeScript no MVP. Cada entrada possui ID explícito e estável, independente do nome físico do arquivo, além de locator, categoria e ordem. Documentos não manifestados não entram automaticamente no contexto.

Cada instância constrói um índice imutável em memória. O índice registra metadados e um hash SHA-256 calculado sobre os bytes exatos do documento. O conteúdo não é mantido em cache. Durante `load`, apenas os documentos selecionados são relidos e seus hashes são comparados com o índice; divergências geram erro em vez de atualização silenciosa.

A seleção é determinística, explícita e versionada por contexto. Documentos obrigatórios ausentes ou que não cabem no orçamento causam falha. Documentos opcionais que excedem o orçamento são omitidos de forma rastreável e nunca truncados. Limites de documentos, bytes do contexto e bytes por documento pertencem à configuração da instância, possuem valores padrão centralizados e podem ser reduzidos por solicitação validada.

O Context Composer preserva o conteúdo original e produz um contexto estruturado em ordem estável. Cada documento recebe delimitadores e metadados visíveis de ID, categoria e hash. O Loader não resume, interpola, interpreta ou transforma o conteúdo.

O adapter de filesystem usa uma raiz absoluta fornecida pela composição server-side. Locators absolutos, traversal, separadores inválidos, segmentos ocultos, extensões não permitidas, arquivos não regulares, symlinks e conteúdo fora do manifesto são rejeitados. A leitura exige UTF-8 válido e verifica contenção por caminho real.

O Knowledge Loader não monta prompts, não executa agentes, não coordena o pipeline, não persiste dados e não utiliza IA, embeddings, RAG ou busca semântica. O Prompt Builder futuro receberá o contexto já carregado; o Agent Runner receberá uma solicitação já montada; o Orchestrator apenas solicitará o tipo de contexto necessário.

Logs registram somente metadados técnicos, como IDs, hashes, quantidades, bytes, duração e códigos de erro. Conteúdo documental e caminhos absolutos não são registrados.

## Consequences

- a inclusão de novos documentos exige atualização explícita do manifesto;
- renomeações físicas podem preservar a identidade lógica do documento;
- uma instância não incorpora mudanças de conteúdo silenciosamente;
- a mesma origem, índice, política e orçamento produzem contexto determinístico;
- futuras origens podem implementar `KnowledgeSource` sem alterar consumidores;
- orçamento em bytes permanece independente de tokenização de modelos;
- resumo, RAG, cache de conteúdo e composição de prompts permanecem fora do escopo.
