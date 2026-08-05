# FAQ

## O que é o BRQ AI Factory?

Uma plataforma AI First baseada em agentes especializados.

---

## O projeto substitui desenvolvedores?

Não.

O objetivo é aumentar produtividade e padronização.

---

## O que significa AI First?

Significa que a documentação e o conhecimento são criados antes do código.

---

## Posso trocar o modelo de IA?

Sim.

A arquitetura foi criada para suportar múltiplos providers.

---

## Por que existe um Orchestrator?

Para centralizar regras, contexto e fluxo entre agentes.

---

## Por que os agentes não conversam diretamente?

Para reduzir acoplamento e facilitar evolução.

---

## Posso adicionar novos agentes?

Sim.

A arquitetura foi projetada para isso.

---

## Posso alterar prompts?

Sim.

Toda alteração gera uma nova versão.

---

## Como reproduzir uma execução?

Utilizando:

- Prompt Version
- Agent Version
- Model
- Artifacts
- Logs

---

## Como funciona o histórico?

Toda execução gera:

- logs
- artefatos
- eventos
- versões

---

## O projeto utiliza IA em tempo real?

Sim.

Inicialmente utilizando OpenAI Responses API.

---

## O projeto suporta outros modelos?

Planejado.

- Claude
- Gemini
- Azure OpenAI

---

## Onde ficam os documentos?

Na pasta:

knowledge/

---

## Onde ficam os prompts?

Os prompts específicos ficam em `agents/` e suas versões em `prompts/`.

---

## Como novos ADRs são criados?

Criando um novo documento dentro da pasta ADR.

Nunca editar um ADR antigo.

---

## Como contribuir?

Seguindo CONTRIBUTING.md.

---

## Como iniciar uma implementação?

Lendo primeiro:

README.md

Depois toda a pasta docs.
