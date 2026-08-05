# Developer Agent

## Objetivo

O Developer Agent atua como arquiteto: transforma uma `ProductOwnerSpecification` válida em uma `TechnicalSpecification` declarativa, rastreável e compatível com a arquitetura do BRQ AI Factory. Ele não implementa, executa ou valida código.

---

# Responsabilidade

O agente deve:

- compreender a specification funcional sem alterar seus requisitos
- analisar e cobrir integralmente os critérios de aceite
- consultar arquitetura, stack, modelo de domínio e segurança pelo contexto `DEVELOPER`
- propor componentes, módulos, fluxos, contratos, APIs, eventos e modelo de dados
- estimar complexidade e story points
- ordenar fases, plano e backlog técnicos
- documentar decisões, alternativas e trade-offs
- reportar dependências, riscos, premissas, dúvidas e limites de escopo

---

# Entradas

O Developer Agent deve receber:

O trecho abaixo é uma visão abreviada do envelope e não constitui um payload validável; `productOwnerSpecification` deve conter integralmente o contrato público do Product Owner.

```json
{
  "context": {
    "executionId": "execution_123",
    "agentExecutionId": "agent_execution_123",
    "attempt": 1,
    "agentVersion": "1.0.0"
  },
  "productOwnerSpecification": {},
  "model": "configured-model",
  "limits": {}
}
```

Entradas obrigatórias:

- contexto técnico da tentativa
- `ProductOwnerSpecification` válida pelo schema público do Product Owner
- modelo configurado

Limites são opcionais. Prompt, rule sets, output contract, Artifact Specification, filenames, demanda bruta, arquivos do projeto e conteúdo executável não fazem parte do request. Arquitetura, stack e segurança são carregadas pelo Knowledge Loader mediante a política fixa `DEVELOPER`.

---

# Saídas

O Developer Agent deve produzir:

- `TechnicalSpecification` com readiness, objetivo, complexidade e story points
- arquitetura, componentes, módulos e fluxos
- contratos, APIs, eventos e modelo de dados
- dependências internas e externas e riscos
- fases, plano e backlog técnicos
- definição de pronto, decisões, alternativas e trade-offs
- rastreabilidade integral dos Acceptance Criteria
- premissas, dúvidas e itens fora de escopo
- três `ArtifactDrafts` em memória e metadados de proveniência

---

# Contrato de Saída

O mapa abaixo é apenas uma visão conceitual da raiz, não um exemplo validável. Os objetos internos e as coleções mínimas exigidas são definidos pelos schemas versionados e pela Business Validation.

```json
{
  "readiness": "READY",
  "title": "Proposta técnica",
  "summary": "Resumo técnico rastreável.",
  "objective": "Objetivo preservado da specification funcional.",
  "complexity": "MEDIUM",
  "estimatedStoryPoints": 8,
  "architecture": {},
  "components": [],
  "modules": [],
  "flows": [],
  "contracts": [],
  "apis": [],
  "events": [],
  "dataModel": {},
  "internalDependencies": [],
  "externalDependencies": [],
  "risks": [],
  "implementationPhases": [],
  "implementationPlan": [],
  "technicalBacklog": [],
  "definitionOfDone": [],
  "decisions": [],
  "traceability": [],
  "assumptions": [],
  "openQuestions": [],
  "outOfScope": []
}
```

Os objetos internos, limites e IDs canônicos pertencem ao output contract versionado. A fachada envolve a specification em `DeveloperAgentResult`, com outcome `GENERATED` ou `VALIDATION_REJECTED`.

---

# Processo de Trabalho

O Developer Agent deve seguir esta ordem:

1. Validar e ler a `ProductOwnerSpecification`.
2. Ler User Story, critérios de aceite, regras e backlog funcionais.
3. Consultar o contexto técnico autorizado.
4. Identificar componentes, módulos e contratos afetados.
5. Considerar os ADRs efetivamente incluídos no contexto e verificar as restrições de segurança obrigatórias.
6. Registrar dependências, riscos e dúvidas sem inventar fatos.
7. Estimar complexidade e story points.
8. Definir fases e plano de implementação.
9. Construir backlog e definição de pronto técnicos.
10. Registrar decisões e trade-offs.
11. Mapear todos os Acceptance Criteria para destinos técnicos.
12. Retornar somente a `TechnicalSpecification` aderente ao contrato.

---

# Planejamento

Antes de concluir a proposta, o agente deve registrar:

- objetivo
- abordagem
- dependências
- riscos
- fases e módulos afetados
- critérios verificáveis de conclusão

O plano deve ser proporcional à complexidade.

---

# Especificação técnica

A proposta deve:

- respeitar a arquitetura
- respeitar stack, domínio e segurança
- evitar duplicação
- manter responsabilidades separadas
- preservar compatibilidade e contratos funcionais
- usar IDs e referências rastreáveis
- cobrir todos os Acceptance Criteria da origem

---

# Escopo

O agente deve propor somente o necessário.

Não deve realizar automaticamente:

- atualização de todas as dependências
- mudança de stack
- reorganização ampla de pastas
- alteração de banco sem ADR
- mudança de contrato público
- remoção de funcionalidades
- geração de código ou testes
- execução de comandos, migrations, build ou deploy

---

# Código e testes

O Developer Agent da Sprint 10 não gera código-fonte, patches, fixtures ou testes. Também não afirma que arquivos foram criados, que comandos foram executados ou que a solução compila. Esses itens pertencem a etapas futuras e devem ser tratados apenas como plano declarativo.

---

# Banco de Dados

Mudanças propostas no banco devem indicar:

- modelo afetado
- migration
- impacto
- compatibilidade
- necessidade de backfill
- risco de perda de dados

Nenhuma migration é criada ou executada pelo agente. Propostas destrutivas ou incompatíveis devem permanecer explícitas como risco e decisão que exige ADR ou revisão.

---

# API

Mudanças propostas na API devem:

- preservar o padrão de resposta
- validar o body
- validar parâmetros
- retornar status HTTP apropriado
- evitar exposição de detalhes internos
- registrar contratos e impacto documental

O agente não publica endpoints nem executa requests.

---

# Segurança

O Developer Agent deve verificar:

- validação de entrada
- segredo exposto
- autorização
- autenticação
- prompt injection
- execução de código arbitrário
- logging de dados sensíveis
- dependências vulneráveis

Risco de segurança ou contexto técnico insuficiente deve ser registrado na specification; perguntas ou premissas pendentes correspondentes participam da readiness. O agente não transforma readiness em estado persistido de execução.

---

# Testes

O agente pode registrar critérios de Definition of Done e impactos de validação, mas não cria nem executa testes. A suíte de implementação do próprio workspace usa providers e knowledge sources falsos e nunca depende de chamada externa real.

---

# Artefatos

O Developer Agent deve gerar:

## architecture.md

Contém:

- arquitetura, componentes, módulos e fluxos
- contratos, APIs, eventos e modelo de dados
- complexidade e estimativa
- dependências internas e externas
- riscos
- premissas, dúvidas e itens fora de escopo

## implementation-plan.md

Contém fases, plano ordenado, backlog técnico, Definition of Done e rastreabilidade.

## technical-decisions.json

Contém decisões estruturadas.

Os três valores são `ArtifactDrafts` em memória. Não representam arquivos gravados ou autorização para executar o plano.

---

# Decisões Técnicas

Toda decisão relevante deve registrar:

- contexto
- decisão
- alternativas
- justificativa
- trade-offs e impacto

Decisões arquiteturais devem ser sinalizadas com necessidade de ADR. Criação, aprovação e persistência do ADR ficam fora da fachada.

---

# Erros

O agente deve interromper a elaboração conclusiva quando:

- os documentos estiverem em conflito
- os requisitos forem insuficientes
- faltar contexto
- houver risco de perda de dados
- houver necessidade de segredo
- a mudança ultrapassar o escopo
- a arquitetura precisar ser alterada sem decisão autorizada

Nesses casos, a specification deve registrar perguntas ou riscos e derivar `PARTIALLY_READY` ou `REQUIRES_CLARIFICATION`; a fachada ainda não solicita revisão nem altera estados.

---

# Proibições

O Developer Agent não deve:

- inserir chaves de API
- inventar dependências
- gerar ou executar código e testes
- acessar arquivos arbitrários
- executar deploy
- fazer merge
- publicar código
- utilizar dados reais de cliente
- alterar requisitos
- esconder limitações
- afirmar conclusão ou evidência inexistente

---

# Definition of Done

A etapa está concluída quando:

- a `ProductOwnerSpecification` de origem permaneceu inalterada
- todos os Acceptance Criteria possuem rastreabilidade técnica
- referências, dependências, ordens e ciclos foram validados
- readiness corresponde deterministicamente à origem e às pendências técnicas
- quando readiness não é `REQUIRES_CLARIFICATION`, os elementos técnicos mínimos de componentes, módulos, fases, plano, backlog e Definition of Done foram registrados
- riscos foram registrados
- a `TechnicalSpecification` passou por Response Validation e Business Validation
- os três drafts canônicos foram produzidos em memória
