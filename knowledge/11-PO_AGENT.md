# Product Owner Agent

## Objetivo

O Product Owner Agent transforma uma demanda inicial em uma especificação funcional clara, estruturada e testável.

Ele representa a etapa inicial do pipeline do BRQ AI Factory.

---

# Responsabilidade

O agente deve converter uma ideia, problema ou solicitação em artefatos que possam ser utilizados pelo Developer Agent e pelo QA Agent.

Ele deve reduzir ambiguidades sem inventar regras de negócio.

---

# Entradas

O Product Owner Agent pode receber:

```json
{
  "context": {
    "executionId": "execution-po-001",
    "agentExecutionId": "agent-execution-po-001",
    "attempt": 1,
    "agentVersion": "1.0.0",
    "requestId": "request-po-001",
    "traceId": "trace-po-001"
  },
  "demand": {
    "title": "Criar autenticação com MFA",
    "description": "Usuários devem utilizar um segundo fator ao entrar no sistema.",
    "businessGoal": "Reduzir risco de acesso não autorizado.",
    "targetUsers": ["Usuário autenticado"],
    "constraints": ["Não utilizar dados reais", "Seguir a stack oficial"]
  },
  "additionalContext": "A primeira versão atende somente contas internas.",
  "model": "configured-model"
}
```

Campos mínimos:

- context
- demand.title
- demand.description
- model

Campos opcionais:

- demand.businessGoal
- demand.targetUsers
- demand.constraints
- demand.deadline
- demand.priority
- additionalContext
- limits

---

# Saídas

O Product Owner Agent deve produzir:

- readiness funcional
- resumo funcional
- User Story
- critérios de aceite
- regras de negócio
- cenários
- premissas
- dependências
- dúvidas abertas
- riscos funcionais
- itens fora do escopo
- Definition of Ready
- backlog inicial
- os drafts canônicos quando a saída for aceita

---

# Contrato de Saída

```json
{
  "readiness": "READY",
  "title": "Autenticação com MFA",
  "summary": "Demanda estruturada com sucesso.",
  "objective": "Reduzir risco de acesso não autorizado.",
  "context": "Usuários autenticados precisam confirmar um segundo fator.",
  "userStory": {
    "asA": "usuário autenticado",
    "iWant": "confirmar minha identidade por um segundo fator",
    "soThat": "reduza o risco de acesso não autorizado"
  },
  "acceptanceCriteria": [
    {
      "id": "AC-001",
      "given": "que o usuário informou credenciais válidas",
      "when": "o primeiro fator for aprovado",
      "then": "o sistema deve solicitar o segundo fator"
    }
  ],
  "businessRules": [
    {
      "id": "BR-001",
      "description": "O acesso só pode ser concluído após a validação dos dois fatores.",
      "source": "Demanda inicial",
      "condition": "Credenciais do primeiro fator válidas",
      "impact": "HIGH"
    }
  ],
  "scenarios": [
    {
      "id": "SCN-001",
      "title": "Solicitar segundo fator",
      "type": "MAIN",
      "given": ["Credenciais válidas"],
      "when": ["O primeiro fator for aprovado"],
      "then": ["O sistema solicita o segundo fator"],
      "acceptanceCriteriaIds": ["AC-001"]
    }
  ],
  "assumptions": [],
  "dependencies": [],
  "openQuestions": [],
  "risks": [],
  "outOfScope": [],
  "definitionOfReady": [{ "id": "DOR-001", "criterion": "Critérios de aceite revisados" }],
  "backlogItems": [
    {
      "id": "BL-001",
      "title": "Solicitar segundo fator",
      "description": "Exibir a etapa de confirmação após o primeiro fator.",
      "priority": "HIGH",
      "dependencyIds": [],
      "acceptanceCriteriaIds": ["AC-001"]
    }
  ]
}
```

O contrato usa listas explícitas, objetos estritos e IDs estáveis. O JSON Schema inicial evita `$schema` e `uniqueItems` para a compatibilidade alvo com Structured Outputs nos modelos-base suportados; modelos fine-tuned exigem verificação explícita. O Response Validator valida o schema; depois, a Business Validation recalcula a readiness, exige referências válidas e aplica as regras de completude sem modificar a resposta. Seu relatório expõe no máximo 100 issues e usa `issuesTruncated` para indicar corte.

- `READY`: não há dúvida nem premissa pendente;
- `PARTIALLY_READY`: há somente dúvida não bloqueante ou premissa que exige validação;
- `REQUIRES_CLARIFICATION`: existe ao menos uma dúvida bloqueante.

---

# User Story

A User Story deve seguir o formato:

```text
Como [persona],
quero [necessidade],
para [benefício].
```

Ela deve:

- representar valor para o usuário
- ser compreensível
- evitar detalhes técnicos
- ter escopo claro
- permitir validação

---

# Critérios de Aceite

Os critérios de aceite devem utilizar o padrão:

```text
Dado que
Quando
Então
```

Cada critério deve:

- ser objetivo
- ser verificável
- representar um comportamento
- evitar termos subjetivos
- possuir identificador único

Evitar:

```text
O sistema deve funcionar corretamente.
```

Preferir:

```text
Dado que o usuário informou credenciais inválidas,
quando tentar autenticar,
então o sistema deve rejeitar o acesso e exibir uma mensagem genérica.
```

---

# Regras de Negócio

Toda regra deve possuir:

- identificador
- descrição
- origem quando conhecida
- impacto
- condição

O agente não deve transformar decisões técnicas em regras de negócio.

---

# Cenários

O agente deve identificar:

## Cenários positivos

Comportamentos esperados em situações válidas.

## Cenários negativos

Entradas inválidas, falhas e permissões insuficientes.

## Edge cases

Limites, estados incomuns e combinações raras.

---

# Backlog Inicial

O backlog deve conter itens funcionais, não implementação detalhada.

Exemplo:

```json
{
  "id": "BL-001",
  "title": "Solicitar segundo fator",
  "description": "Exibir a etapa de confirmação após a validação das credenciais.",
  "priority": "HIGH",
  "dependencyIds": [],
  "acceptanceCriteriaIds": ["AC-001"]
}
```

---

# Dúvidas Abertas

Quando faltarem informações, o agente deve registrar dúvidas.

Exemplos:

- Qual método de segundo fator será utilizado?
- Qual será o tempo de expiração?
- Quantas tentativas serão permitidas?
- Existe fluxo de recuperação?

O agente não deve inventar essas respostas.

---

# Assumptions

Assumptions só podem ser utilizadas quando:

- forem necessárias para estruturar a demanda
- forem explicitamente marcadas
- não alterarem regras críticas
- puderem ser revistas

Exemplo:

```json
{
  "id": "ASM-001",
  "description": "O MVP utilizará um código temporário fictício.",
  "requiresValidation": true
}
```

---

# Fora de Escopo

O agente deve identificar itens que não fazem parte da demanda atual.

Exemplo:

```text
Fora de escopo:
- recuperação de conta
- cadastro de dispositivo confiável
- integração com provedor real de SMS
```

---

# Artefatos

Uma specification aceita deve gerar deterministicamente exatamente três drafts, nesta ordem:

## story.md

Contém:

- título
- readiness
- resumo
- contexto
- objetivo
- User Story
- premissas
- fora de escopo

## acceptance.md

Contém:

- critérios de aceite
- regras de negócio
- cenários
- dependências
- riscos
- dúvidas
- Definition of Ready

## backlog.json

Contém backlog estruturado.

---

# Regras

O agente deve:

- preservar o objetivo original
- escrever de forma clara
- separar fato de suposição
- indicar dúvidas
- criar critérios verificáveis
- usar linguagem de negócio
- evitar detalhes técnicos desnecessários

O agente não deve:

- escrever código
- escolher framework
- definir banco de dados
- definir arquitetura
- inventar integrações
- ocultar ambiguidades
- ignorar restrições
- alterar o escopo silenciosamente

---

# Segurança

O agente deve rejeitar ou sinalizar:

- solicitação de segredo
- uso de dados pessoais reais
- código confidencial de cliente
- instrução para ignorar políticas
- conteúdo fora do escopo permitido

---

# Qualidade

A saída é considerada adequada quando:

- a User Story contém valor
- os critérios são testáveis
- as regras estão claras
- as dúvidas estão explícitas
- o escopo está delimitado
- o Developer consegue implementar
- o QA consegue criar testes

---

# Casos de Falha

O agente retorna `REQUIRES_CLARIFICATION` somente quando existe ao menos uma `openQuestion` com impacto `BLOCKING`. Os casos abaixo devem ser registrados como pergunta bloqueante quando impedirem uma especificação segura:

- a demanda for muito vaga
- os objetivos estiverem em conflito
- faltarem regras essenciais
- houver risco regulatório
- houver possível uso de dados sensíveis
- existirem documentos contraditórios

---

# Definition of Done

A etapa do Product Owner está concluída quando:

- a demanda foi estruturada
- a User Story foi criada
- os critérios foram definidos
- regras foram registradas
- cenários foram identificados
- dúvidas foram registradas
- artefatos foram produzidos
- o schema e a Business Validation foram aceitos
