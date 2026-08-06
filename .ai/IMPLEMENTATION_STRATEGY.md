# IMPLEMENTATION STRATEGY

## Objetivo

Este documento define a estratégia oficial de implementação do BRQ AI Factory.

O objetivo é orientar o desenvolvimento incremental da plataforma, permitindo que cada etapa seja concluída, validada e revisada antes da próxima.

O desenvolvimento deve ocorrer em pequenas entregas (Sprints), preservando a arquitetura definida na Knowledge Layer.

---

# Filosofia

O projeto deve seguir os seguintes princípios:

- Implementação incremental
- Arquitetura antes do código
- Qualidade antes da velocidade
- Testes desde o início
- Revisões frequentes
- Baixo acoplamento
- Alta coesão
- AI First

Nenhuma Sprint deve quebrar funcionalidades entregues anteriormente.

---

# Estratégia Geral

Cada Sprint deve seguir o fluxo:

```
Planejamento

↓

Implementação

↓

Testes

↓

Revisão

↓

Documentação

↓

Próxima Sprint
```

Nunca iniciar uma Sprint sem concluir a anterior.

---

# Definition of Done

Uma Sprint só pode ser considerada concluída quando:

- Build funcionando
- TypeScript sem erros
- Lint aprovado
- Testes passando
- Documentação atualizada
- Arquitetura preservada
- Sem TODOs críticos
- Sem código morto

---

# Sprint 0 — Foundation

Objetivo

Criar a estrutura inicial do projeto.

Entregas

- Estrutura de pastas
- Configuração do Next.js
- TypeScript
- ESLint
- Prettier
- Husky
- Prisma
- SQLite
- Configurações compartilhadas
- Node.js 24 LTS
- npm workspaces
- testes unitários e smoke
- CI com lint, typecheck, testes, Prisma validate e build
- baseline de segurança e observabilidade

Limites da Sprint

- Prisma e SQLite apenas no nível de infraestrutura
- nenhum model, migration, seed ou repository
- nenhum teste E2E
- nenhum deploy
- nenhum item da Shared Layer além do baseline mínimo de config, erros e logger

Critério de aceite

O projeto inicia corretamente e possui toda a estrutura base.

---

# Sprint 1 — Shared Layer

Objetivo

Construir toda infraestrutura compartilhada.

Entregas

shared/

- types
- schemas
- constants
- utils
- logger
- errors
- config
- estados canônicos de Project, Execution e AgentExecution
- contratos base de agentes e artefatos
- códigos de erro compartilhados
- testes unitários e de contrato

Limites da Sprint

- preservar os baselines existentes de config, erros e logger
- não implementar AIProvider, persistência, agentes ou Orchestrator
- retries automáticos criam uma nova AgentExecution na mesma Execution
- retomadas após falha ou revisão permanecem decisões explícitas do fluxo futuro

Critério

Todos os módulos podem reutilizar estes componentes.

---

# Sprint 2 — Persistence

Objetivo

Implementar persistência.

Entregas

- Prisma Schema
- Repositories
- Migrations
- Seed somente quando existir dado inicial obrigatório
- Configuração SQLite
- testes de integração com banco isolado

Entidades

- Project
- Execution
- AgentExecution
- Artifact
- PromptVersion
- Log

Critério

Persistência funcional.

Decisões da implementação

- nenhum seed é necessário no MVP atual;
- contratos e ports permanecem em `shared`;
- Prisma Client, mapeadores e implementações permanecem em `prisma`;
- repositories não executam lógica de negócio nem transições de estado.

---

# Sprint 3 — AI Provider

Objetivo

Criar abstração para IA.

Entregas

core/ai-provider

Implementar:

- Interface AIProvider
- OpenAIProvider
- FakeAIProvider
- Configuração

Decisões da implementação

- contratos específicos permanecem em `core/ai-provider` e não conhecem a Responses API;
- OpenAIProvider utiliza a Responses API apenas como adapter inicial;
- timeout padrão de 60 segundos com configuração server-side;
- retry técnico somente para falha de conexão sem resposta HTTP válida;
- FakeAIProvider cobre falhas técnicas, JSON malformado e structured output incompatível;
- suíte padrão não realiza chamadas reais.

Critério

A aplicação consegue conversar com um provider utilizando interfaces.

---

# Sprint 4 — Knowledge Loader

Objetivo

Criar o carregador da Knowledge Layer.

Entregas

core/knowledge-loader

Funções

- autorizar documentos por manifesto JSON validado por Zod
- manter IDs explícitos e independentes de filenames
- construir índice imutável com hashes SHA-256
- selecionar documentos por contexto mediante política determinística e versionada
- carregar e verificar somente os documentos selecionados
- compor contexto estruturado sem resumir ou alterar conteúdo
- aplicar orçamento configurável por instância sem truncamento silencioso

Decisões da implementação

- `KnowledgeSource` abstrai a origem e o filesystem é o adapter inicial;
- o manifesto é declarativo, versionado e mantido em `core/knowledge-loader`;
- o contexto identifica cada documento por ID, categoria, hash e delimitadores;
- o Loader não monta prompts, executa agentes, coordena o fluxo ou persiste dados;
- IA, embeddings, RAG, busca semântica e cache de conteúdo permanecem fora do escopo.

Critério

Cada contexto recebe somente os documentos autorizados e selecionados, com conteúdo íntegro e rastreável.

---

# Sprint 5 — Prompt Builder

Objetivo

Transformar estruturas prontas em prompts finais determinísticos.

Entregas

core/prompt-builder

Responsabilidades

- validar contratos de entrada, AST e resultado
- representar a hierarquia conceitual PromptDocument → PromptSection → PromptBlock → PromptFragment como PromptTemplate antes da resolução e ResolvedPromptDocument depois dela
- separar seções pelos canais semânticos INSTRUCTIONS e INPUT
- compor regras globais, regras de agente, constraints, contexto, variáveis e output contracts provider-neutral
- resolver slots tipados em uma única passagem
- aplicar preflight de limite inferior e medição final exata sobre orçamento configurável em bytes UTF-8, com default centralizado de 128 KiB, sem truncamento silencioso
- limitar estruturalmente as referências de proveniência antes do clone por schema, sem debitá-las do orçamento do payload
- produzir `templateHash`, `instructionsHash`, `inputHash`, `outputContractHash` e `promptHash` canônicos
- preservar proveniência canônica de rule sets e contextos sem alterar o `promptHash` do payload efetivo
- comparar prompts estruturalmente com referências imutáveis de nodeType e path
- renderizar os canais `instructions` e `input` somente na etapa final

Decisões da implementação

- a transformação é pura e determinística, sem I/O de domínio, filesystem, persistência ou chamadas externas; o logger estruturado injetável é a única saída lateral;
- recebe somente estruturas prontas e não conhece AI Provider, Agent Runner, Orchestrator, Knowledge Source, Prisma ou frontend;
- valores resolvidos são tratados como dados opacos e nunca reinterpretados como template;
- logs contêm somente metadados técnicos sanitizados;
- Prompt Manifest, assets, loader, selector, registry e consumers de produção permanecem adiados por não existir uso concreto nesta Sprint.

Critério

O mesmo input válido produz uma estrutura imutável, os mesmos canais renderizados e hashes idênticos, dentro do orçamento configurado.

---

# Sprint 6 — Agent Runner

Objetivo

Executar a fronteira genérica entre prompts estruturados e o AI Provider.

Entregas

- workspace `core/agent-runner`
- contratos e schemas Zod próprios de entrada e saída
- `PromptRequest` independente de `PromptBuildInput`
- integração somente pelas APIs públicas de Prompt Builder e AI Provider
- mapeamento provider-neutral de `PromptResult` para `AIRequest`
- `ResponseEnvelope` interno e `AgentRunResult` público sem expor `AIResponse`
- correlação obrigatória por `agentExecutionId`
- métricas observadas separadas das reportadas pelo provider
- logs estruturados e sanitizados
- testes unitários, de contrato, integração e fronteiras

Decisões da implementação

- cada execução realiza exatamente uma chamada a `AIProvider.generate` e o Runner não implementa retry;
- cancelamento é encaminhado por `AbortSignal`, sem criação de timers no Runner;
- o timeout configurado é apenas repassado e aplicado pelo AI Provider;
- validações locais são técnicas e estruturais, nunca funcionais ou específicas de agente;
- o Runner não conhece providers concretos, agentes, Orchestrator, Knowledge Loader, Prisma, API ou frontend.

Critério

Um `PromptRequest` válido gera um `AgentRunResult` rastreável por meio de uma única chamada abstrata ao provider, sem vazamento de detalhes internos.

---

# Sprint 7 — Response Validator

Objetivo

Validar funcionalmente o resultado público de uma execução de agente.

Entregas

- workspace `core/response-validator`
- `ValidationRequest` e `ValidationContract` provider-neutral e versionado
- `ValidationPipeline` determinística
- `ValidationReport` exclusivamente interno e `ValidationResult` público imutável
- classificação de finish reasons, conteúdo ausente e formato
- reinterpretação de JSON e validação por JSON Schema
- revalidação de structured output sem confiar em `structuredData`
- issues classificadas por código, categoria e severidade
- hashes de conteúdo, contrato, output validado e decisão
- logs estruturados e sanitizados
- testes unitários, de contrato, integração e fronteiras

Decisões da implementação

- o Validator recebe somente `AgentRunResult` e um contrato funcional próprio, sem acessar o `ResponseEnvelope` interno;
- `expectedOutputContractHash` vincula o contrato funcional ao output contract usado na execução;
- `output.content` é reinterpretado e permanece a fonte autoritativa para `JSON_SCHEMA`;
- `structuredData` nunca é confiado isoladamente e precisa ser coerente com o valor reinterpretado;
- JSON Schema utiliza exclusivamente o dialect `DRAFT_2020_12`, sem coerção, defaults, referências remotas ou mutação;
- limites configuráveis e centralizados protegem conteúdo, schema, nesting e quantidade de issues;
- falhas funcionais produzem `ValidationResult`, enquanto request, configuração ou contrato técnico inválido produzem erro canônico;
- a severidade reserva `INFO` para evolução compatível, mas a pipeline de produção emite somente `ERROR` e `WARNING` nesta Sprint;
- validação estrutural e declarativa não equivale a avaliação semântica específica de agente;
- o Validator não chama IA, corrige conteúdo, cria artifacts, persiste dados, altera estados ou executa retry;
- uma eventual nova `AgentExecution` permanece decisão do Orchestrator.

Critério

Uma resposta só pode seguir para componentes posteriores quando produzir um `ValidationResult` válido, rastreável e imutável.

---

# Sprint 8 — Artifact Generator

Objetivo

Converter uma saída funcionalmente validada em drafts de artefatos determinísticos.

Entregas

- workspace `core/artifact-generator`
- `ArtifactGenerationRequest`, `ArtifactSpecification` e templates declarativos
- resolução determinística de bindings
- `ResolvedArtifactModel` exclusivamente interno
- rendering de conteúdo sem transformação semântica
- `ArtifactGenerationResult` público e imutável
- hashes estruturais e de conteúdo com funções distintas
- limites configuráveis por instância
- logs estruturados e sanitizados
- testes unitários, de contrato, integração e fronteiras

Decisões da implementação

- somente `ValidationResult` com `valid: true` pode entrar na pipeline;
- o Generator recalcula `validatedValueHash` e exige correspondência exata do `sourceContract` antes de resolver bindings;
- o módulo recebe uma specification pronta e não escolhe templates por agente;
- bindings são locais ao template, possuem IDs estáveis e são referenciados declarativamente;
- a pipeline separa `Binding Resolution → ResolvedArtifactModel → Rendering → ArtifactDraft`;
- o conteúdo validado continua sendo dado não confiável e nunca é executado ou reinterpretado como template;
- nenhum filename representa caminho, e o módulo não acessa o filesystem;
- o Generator não chama IA, não cria versões persistidas, não usa repositories, não altera estados e não coordena workflow;
- enriquecimento de `ArtifactDraft` para `ArtifactCreateInput`, versionamento e persistência permanecem fora da fronteira.

Critério

O mesmo resultado validado e a mesma specification produzem drafts imutáveis, na ordem declarada, com conteúdo e hashes idênticos, sem I/O ou persistência.

---

# Sprint 9 — Product Owner Agent

Objetivo

Implementar o primeiro agente.

Entregas

- workspace `agents/product-owner`
- contratos e schemas versionados da demanda, specification e resultado
- assets declarativos versionados em `prompts/product-owner/1.0.0`
- fachada de uma única tentativa sobre Knowledge Loader, Agent Runner, Response Validator e Artifact Generator
- Business Validation determinística para readiness, completude, IDs e referências cruzadas, com relatório limitado e `issuesTruncated`
- drafts canônicos `story.md`, `acceptance.md` e `backlog.json`
- hashes e metadados de proveniência sem persistência
- logs estruturados e sanitizados
- testes unitários, de contrato, integração e fronteiras

Decisões da implementação

- a fachada não chama Prompt Builder ou AI Provider diretamente; essas integrações permanecem encapsuladas pelo Agent Runner;
- o contexto `PRODUCT_OWNER` é carregado pelo Knowledge Loader e projetado sem alterar conteúdo documental;
- a factory valida uma vez os assets com filenames, IDs e versões explícitos; o loader calcula seus hashes e fixa o `bundleHash` esperado do release 1.0.0 antes de a fachada aceitar requests;
- o JSON Schema inicial evita `$schema` e `uniqueItems` para a compatibilidade alvo com Structured Outputs de modelos-base; modelos fine-tuned permanecem sujeitos a verificação explícita;
- o Response Validator verifica o contrato estrutural, e a Business Validation específica do domínio ocorre em uma etapa separada;
- readiness é recalculada deterministicamente e nunca corrigida silenciosamente;
- depois do gate de negócio, o Artifact Generator recebe o `ValidationResult` aceito e a `ArtifactSpecification` e produz exatamente três drafts;
- uma invocação representa uma tentativa e não executa retry, persistência, transições de estado ou coordenação de workflow;
- hashing e canonicalização reutilizam as APIs públicas existentes, sem implementação paralela no agente.

Critério

Uma demanda válida produz uma `ProductOwnerSpecification` rastreável e, quando aceita pelas duas validações, exatamente os três drafts canônicos, sem iniciar etapas posteriores.

---

# Sprint 10 — Developer Agent

Objetivo

Implementar o segundo agente concreto como arquiteto de uma única tentativa.

Entregas

- workspace `agents/developer`
- contrato estrito `ProductOwnerSpecification → TechnicalSpecification`
- assets declarativos versionados em `prompts/developer/1.0.0`
- composição `Knowledge Loader → Agent Runner → Response Validator → Developer Business Validation → Artifact Generator`
- validação determinística de IDs, referências, dependências, ciclos, readiness, completude e cobertura integral dos Acceptance Criteria
- drafts canônicos `architecture.md`, `implementation-plan.md` e `technical-decisions.json`
- metadados com hash e readiness da specification funcional de origem
- política `DEVELOPER` com seis documentos obrigatórios dentro do orçamento padrão de 64 KiB

Decisões da implementação

- o request recebe somente contexto de execução, uma `ProductOwnerSpecification` válida, modelo e limites opcionais;
- o pacote reutiliza o contrato público do Product Owner sem criar ou executar outro agente;
- a `TechnicalSpecification` registra complexidade, story points, fases, plano, dependências internas e externas, decisões e rastreabilidade;
- o agente não gera código ou testes, não executa comandos, não acessa filesystem, não persiste, não retenta, não altera estados e não coordena QA ou Orchestrator;
- os artifacts são drafts em memória produzidos exclusivamente pela Artifact Specification server-side.

Critério

Uma `ProductOwnerSpecification` válida produz uma proposta técnica rastreável e, após os dois gates de validação, exatamente os três drafts canônicos sem executar a implementação.

---

# Sprint 11 — QA Agent

Objetivo

Implementar o terceiro agente como fachada independente de tentativa única.

Entregas

- workspace `@brq/qa-agent`;
- request com `ProductOwnerSpecification` e `TechnicalSpecification`;
- validação cruzada das fontes;
- `QASpecification` com estratégia, rastreabilidade, cenários, cobertura, riscos, aprovação, bloqueios, prioridades, automação futura e readiness;
- bundle `prompts/qa/1.0.0`;
- QA Business Validation com cobertura integral de `AC`, `BR`, `DEC` e `DOD`;
- drafts `test-plan.md`, `traceability-matrix.json` e `qa-specification.md`;
- ADR-021 e fluxo visual 35;
- política QA dentro de 64 KiB.

Restrições

- uma chamada ao provider pelo Agent Runner;
- sem comunicação operacional entre agentes;
- sem código, Playwright ou execução de testes;
- sem persistência, retry, workflow, Orchestrator ou Execution Engine.

Critério

As duas specifications compatíveis produzem uma proposta de qualidade rastreável e, após os dois gates de validação, exatamente três drafts em memória.

---

# Sprint 12 — Orchestrator

Objetivo

Coordenar deterministicamente o workflow inicial entre os três agentes públicos.

Entregas

- workspace `@brq/orchestrator` em `core/orchestrator`, conforme ADR-011;
- `WorkflowRequest` e `WorkflowResult` estritos;
- timeline observacional fora dos hashes;
- lineage e provenance em contratos separados;
- métricas e hashes consolidados;
- ADR-022 e fluxo visual 36.

Responsabilidades

- ordem fixa Product Owner → Developer → QA;
- estados locais e efêmeros;
- propagação de contexto público e `AbortSignal`;
- interrupção imediata e preservação de resultados anteriores;
- logs allowlisted;
- sem retry, persistência, revisão humana ou Execution Engine.

Critério

Os três agentes executam no máximo uma vez e em sequência; rejeições, erros e cancelamento impedem chamadas posteriores e produzem um resultado terminal rastreável.

---

# Sprint 13 — Execution Engine

Objetivo

Controlar deterministicamente o ciclo de vida efêmero de uma execução e iniciar o Orchestrator
por sua API pública.

Entregas

- workspace `@brq/execution-engine` em `core/execution-engine`, conforme ADR-011;
- `ExecutionRequest` sem `executionId` fornecido pelo caller;
- ID determinístico criado pelo Engine;
- `ExecutionResult` com timestamps observacionais, métricas, hashes, lineage e provenance;
- `engineVersion` e `contractVersion` explícitos;
- ADR-023 e fluxo visual 37.

Responsabilidades

- estados locais `CREATED → RUNNING → SUCCESS | FAILED | CANCELLED`;
- uma tentativa e no máximo uma chamada ao Orchestrator;
- propagação do mesmo `AbortSignal`;
- validação da correlação pública do workflow;
- sem persistência, retry, concorrência, revisão humana, API ou frontend.

Critério

Uma entrada válida recebe identidade determinística, percorre o Orchestrator uma única vez e
produz resultado terminal rastreável sem conhecer agentes ou componentes inferiores.

---

# Sprint 14 — API

Objetivo

Criar a API oficial.

Endpoints

- Projects
- Executions
- Agents
- Prompts

Critério

Frontend consegue consumir a plataforma.

---

# Sprint 15 — Frontend

Objetivo

Criar interface web.

Páginas

- Dashboard
- Projetos
- Nova Execução
- Execução
- Artefatos
- Logs

Critério

Usuário consegue utilizar todo o fluxo.

---

# Sprint 16 — Observabilidade

Objetivo

Adicionar rastreabilidade.

Entregas

- logs estruturados
- métricas
- eventos
- dashboard

Critério

Toda execução pode ser auditada.

---

# Sprint 17 — Segurança

Objetivo

Adicionar controles de segurança.

Entregas

- validações
- sanitização
- proteção contra Prompt Injection
- autenticação inicial
- autorização

Critério

Fluxo protegido.

---

# Sprint 18 — Refino

Objetivo

Melhorar qualidade.

Atividades

- refatorações
- otimizações
- documentação
- cobertura de testes
- performance

Critério

Projeto preparado para produção.

---

# Ordem Obrigatória

As Sprints devem ser executadas exatamente nesta sequência.

Não inverter.

Não pular.

Caso uma Sprint dependa de outra, a anterior deve estar concluída.

---

# Revisão ao Final de Cada Sprint

Ao concluir uma Sprint, o Codex deve apresentar:

## Resumo

O que foi implementado.

---

## Arquivos Criados

Lista completa.

---

## Arquivos Modificados

Lista completa.

---

## Testes

Quais testes foram criados.

---

## Pendências

Itens que ficaram para a próxima Sprint.

---

## Riscos

Possíveis impactos.

---

## Próxima Sprint Recomendada

Indicar exatamente qual Sprint deve iniciar.

---

# Regras para o Codex

Nunca implemente duas Sprints ao mesmo tempo.

Nunca pule etapas.

Nunca altere arquitetura sem ADR.

Nunca modifique código fora do escopo da Sprint.

Sempre preserve compatibilidade com as Sprints anteriores.

Ao terminar uma Sprint, aguarde aprovação antes de iniciar a próxima.

---

# Objetivo Final

Ao final da Sprint 18, o BRQ AI Factory deverá ser uma plataforma AI First completa, capaz de:

- Orquestrar múltiplos agentes especializados.
- Produzir artefatos rastreáveis.
- Persistir execuções.
- Validar respostas de IA.
- Gerar documentação automaticamente.
- Permitir revisão humana.
- Evoluir para novos agentes e novos modelos de IA sem alterações estruturais.
