# Project Context

## Nome

BRQ AI Factory

---

## Objetivo

Criar uma plataforma capaz de orquestrar agentes especializados para automatizar parte do processo de desenvolvimento de software.

---

## Escopo do MVP

Nesta primeira versão existirão apenas três agentes.

- Product Owner
- Developer
- QA

---

## Fluxo Inicial

Usuário

↓

Orchestrator

↓

Product Owner

↓

Developer

↓

QA

↓

Resultado

---

## Objetivos do MVP

Os objetivos abaixo descrevem o produto completo. A implementação é incremental: até a Sprint 14,
Orchestrator, Execution Engine efêmero e adapter HTTP estão disponíveis sobre as três fachadas.
Geração e execução de código ou testes, frontend e persistência funcional continuam futuros.

- Criar uma demanda
- Gerar User Story
- Gerar Critérios de Aceite
- Gerar Código
- Gerar Plano de Testes
- Gerar Testes Automatizados
- Exibir progresso
- Persistir histórico

---

## Princípios

Todo conhecimento deve existir antes do código.

Toda decisão importante deve estar documentada.

Nenhuma regra de negócio deve existir apenas na implementação.

A documentação representa a principal fonte de conhecimento para pessoas e agentes de IA.

---

## Público Alvo

Inicialmente:

- Desenvolvedores
- Tech Leads
- Arquitetos
- Consultores BRQ

No futuro:

Qualquer equipe interessada em desenvolvimento AI First.

---

## Roadmap

MVP

↓

Architect

↓

Tech Lead

↓

Reviewer

↓

DevOps

↓

Security

↓

UX

↓

Multi Model

## Estado incremental da Sprint 14

O Execution Engine é a fronteira efêmera acima do Orchestrator. Ele cria a identidade
determinística da execução, controla um único ciclo local e consolida `ExecutionResult`. O adapter
HTTP expõe health, criação síncrona e o contrato futuro de lookup. Frontend funcional,
persistência da execução, retry e qualquer item da Sprint 15 permanecem futuros.
