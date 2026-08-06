# Glossary

## Agent

Componente especializado responsável por executar uma única responsabilidade.

---

## Orchestrator

Camada responsável por coordenar a ordem entre agentes por suas APIs públicas. Na Sprint 12 seu
estado é efêmero e seu único workflow é Product Owner → Developer → QA.

---

## WorkflowResult

Resultado terminal consolidado pelo Orchestrator, com resultados públicos disponíveis, timeline,
lineage, provenance, métricas e hashes.

---

## Lineage

Vínculo verificável entre specifications transportadas de uma etapa para outra.

---

## Provenance

Origem técnica de um resultado, expressa por identidades e hashes de assets, knowledge, prompt,
response, validação, geração e artifacts.

---

## Timeline

Sequência observacional de eventos do workflow. Seus timestamps e durações não participam de
hashes determinísticos.

---

## Execution

Representa uma execução completa da Software Factory.

---

## Agent Execution

Execução individual de um agente.

---

## Artifact

Qualquer resultado produzido por um agente.

Exemplos:

- User Story
- Código
- Plano de Testes

---

## Prompt

Conjunto de instruções que define o comportamento de um agente.

---

## Prompt Version

Versão específica de um prompt.

---

## Knowledge Layer

Conjunto de documentos utilizados como contexto pelos agentes.

---

## AI Provider

Serviço responsável por executar modelos de IA.

Exemplo:

- OpenAI
- Anthropic
- Google

---

## Pipeline

Sequência de agentes executados.

---

## Context

Informações enviadas ao agente.

---

## Schema

Contrato de entrada e saída.

---

## Retry

Nova tentativa de execução após falha.

---

## Human Review

Intervenção manual quando a IA não possui segurança suficiente para decidir.

---

## ADR

Architecture Decision Record.

Documento que registra uma decisão arquitetural.

---

## AI First

Abordagem onde a documentação é criada antes da implementação para servir como fonte oficial de conhecimento para pessoas e agentes de IA.

---

## MVP

Menor versão funcional do produto.

---

## RAG

Retrieval Augmented Generation.

Técnica de recuperação de contexto antes da geração de respostas.

---

## Memory Layer

Camada responsável por armazenar contexto persistente utilizado pelos agentes.

---

## Execution Engine

Fronteira que cria a identidade determinística e controla o ciclo efêmero de uma execução. Na
Sprint 13 chama o Orchestrator no máximo uma vez e não persiste, retenta ou conhece agentes.

## ExecutionResult

Contrato terminal que consolida resultado do workflow, metadata versionada, timestamps
observacionais, métricas, hashes, lineage, provenance e falha sanitizada.
