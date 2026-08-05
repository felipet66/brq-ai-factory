# Observability

## Objetivo

Este documento define a estratégia de observabilidade do BRQ AI Factory.

A plataforma deve permitir entender:

- o que aconteceu
- quando aconteceu
- por que aconteceu
- qual agente participou
- qual modelo foi utilizado
- quanto tempo levou
- qual foi o consumo
- onde ocorreu uma falha

---

# Pilares

A observabilidade será baseada em:

- Logs
- Métricas
- Traces
- Eventos de domínio
- Auditoria

---

# Correlação

Toda execução deve possuir um identificador único.

Principais identificadores:

- projectId
- executionId
- agentExecutionId
- artifactId
- requestId
- traceId

Esses identificadores devem acompanhar logs, métricas e erros.

---

# Logs Estruturados

Os logs devem ser estruturados em JSON.

No banco, cada Log pertence obrigatoriamente a uma Execution e pode correlacionar uma AgentExecution e um Artifact. Também registra `level`, `event`, `message`, `context`, `requestId`, `traceId` e `createdAt`. Registros são append-only no MVP.

Exemplo:

```json
{
  "level": "info",
  "event": "agent.execution.completed",
  "projectId": "project_123",
  "executionId": "execution_456",
  "agentExecutionId": "agent_execution_789",
  "agent": "PRODUCT_OWNER",
  "model": "configured-model",
  "durationMs": 12400,
  "inputTokens": 2400,
  "outputTokens": 950,
  "timestamp": "2026-08-04T20:00:00.000Z"
}
```

---

# Níveis de Log

## DEBUG

Informações detalhadas para desenvolvimento.

Exemplos:

- metadados do payload transformado
- transição interna
- decisão de retry

Não registrar prompts completos ou dados sensíveis sem necessidade.

---

## INFO

Eventos normais da aplicação.

Exemplos:

- projeto criado
- execução iniciada
- agente concluído
- artefato persistido

---

## WARN

Situações inesperadas que não interromperam o fluxo.

Exemplos:

- retry executado
- resposta parcialmente inválida
- timeout próximo
- uso acima do esperado

---

## ERROR

Falhas que interrompem uma operação.

Exemplos:

- resposta inválida
- falha no banco
- timeout
- erro no provider
- falha de persistência

---

# Eventos Principais

Eventos mínimos:

```text
project.created
execution.created
execution.started
execution.completed
execution.failed
execution.cancelled

agent.execution.started
agent.execution.completed
agent.execution.failed
agent.execution.retried

agent.run.started
agent.run.prompt.completed
agent.run.provider.completed
agent.run.completed
agent.run.failed
agent.run.cancelled
agent.run.timed_out

response.validation.started
response.validation.accepted
response.validation.rejected
response.validation.failed

artifact.generation.started
artifact.generation.completed
artifact.generation.failed

product_owner.agent.started
product_owner.knowledge.loaded
product_owner.run.completed
product_owner.validation.accepted
product_owner.validation.rejected
product_owner.artifacts.generated
product_owner.agent.completed
product_owner.agent.failed

developer.agent.started
developer.knowledge.loaded
developer.run.completed
developer.validation.accepted
developer.validation.rejected
developer.artifacts.generated
developer.agent.completed
developer.agent.failed

artifact.created
artifact.versioned

prompt.build.started
prompt.build.completed
prompt.build.failed
prompt.validation.failed
prompt.budget.exceeded

ai.request.started
ai.request.retrying
ai.request.completed
ai.request.failed
```

Eventos do AI Provider registram somente provider, modelo, IDs de correlação, tentativa, duração, tokens, código de erro e status técnico aplicável. Nunca registram prompts, respostas completas, chaves, headers de autorização, cookies ou JSON Schemas completos.

Eventos do Prompt Builder registram somente metadados aplicáveis ao evento: promptId, agente, versão, schemaVersion, `templateHash`, `instructionsHash`, `inputHash`, `outputContractHash`, `promptHash`, quantidades de seções e contextos, orçamento, bytes, duração, requestId, traceId e código de erro. Nunca registram o texto renderizado, contexto, entrada do usuário, valores de variáveis ou JSON Schemas completos.

Eventos do Agent Runner usam `agentExecutionId` como correlação obrigatória e podem registrar executionId, agente, tentativa, versões, IDs de correlação, hashes, provider, modelos, responseId, finish reason, bytes, durações, tentativas, uso e código de erro. Nunca registram prompts, respostas, structured data, valores de contexto, segredos ou JSON Schemas completos. O Runner emite no máximo um ciclo de provider por invocação e não possui evento de retry próprio.

Eventos do Response Validator podem registrar IDs de execução e correlação, identidade, versão e formato do contrato, finish reason, validade, hashes, duração, quantidade e códigos de issues e indicador de truncamento. Nunca registram conteúdo, `structuredData`, valor validado, schema completo, mensagens cruas do engine de schema, prompts ou segredos. O Validator emite uma decisão para a tentativa atual e não possui evento de retry ou correção.

Eventos do Artifact Generator podem registrar IDs de execução e correlação, identidade e versão da specification, `sourceValidationHash`, `sourceValidatedValueHash`, hashes estruturais e de conteúdo, quantidade de templates e artifacts, bytes renderizados, duração, estágio, classificação e código de erro. Nunca registram conteúdo validado ou renderizado, templates, bindings, specification completa, valores resolvidos, prompts ou segredos. Eventos de geração em memória são distintos de `artifact.created` e `artifact.versioned`, emitidos somente pela futura integração de persistência.

Eventos do Product Owner Agent podem registrar IDs de execução e correlação, versões e hashes de assets, contexto documental por ID e hash, outcome, readiness, contagens, durações, provider, modelo e códigos técnicos ou de validação. Nunca registram demanda, contexto, prompt, resposta, specification, issues com valores, artifacts ou schemas completos. A fachada não emite evento de retry ou persistência.

Eventos do Developer Agent seguem a mesma allowlist técnica e podem acrescentar `sourceSpecificationHash`, `sourceReadiness` e contagens de elementos técnicos. Nunca registram a `ProductOwnerSpecification`, a `TechnicalSpecification`, conhecimento, prompt, resposta, decisões, traceability, conteúdo de drafts ou schemas completos. A fachada não emite evento de execução de código, testes, retry, estado ou persistência.

---

# Métricas

## Execuções

- número total de execuções
- execuções concluídas
- execuções com falha
- execuções canceladas
- duração média
- taxa de sucesso

---

## Agentes

- duração média por agente
- taxa de erro por agente
- quantidade de retries
- respostas inválidas
- artefatos produzidos

---

## IA

- tokens de entrada
- tokens de saída
- custo estimado
- tempo de resposta
- erros por modelo
- erros por provider
- uso por agente

## Validação de respostas

- respostas válidas e inválidas;
- issues por categoria, código e severidade;
- finish reasons rejeitados;
- JSON malformado e schema mismatch;
- duração da validação.

## Geração de artifacts

- gerações concluídas e falhas;
- quantidade de drafts e bytes renderizados;
- duração total da geração;
- erros por classificação, estágio e código.

## Product Owner Agent

- tentativas concluídas, rejeitadas e com falha;
- readiness e códigos de rejeição;
- duração total da fachada e métricas reportadas pelos componentes quando disponíveis;
- quantidade e bytes dos drafts gerados;
- versões e hashes dos assets usados.

## Developer Agent

- tentativas concluídas, rejeitadas e com falha;
- readiness técnica e readiness funcional de origem;
- duração total da fachada e códigos da Business Validation;
- quantidade de Acceptance Criteria da origem e resultado do gate de cobertura;
- quantidade e bytes dos três drafts técnicos;
- versões, hashes de assets e hash da specification de origem.

No Agent Runner, as métricas permanecem separadas por origem:

- `observed`: `totalDurationMs`, `promptBuilderDurationMs`, `providerDurationMs`, `bytesSent` e `bytesReceived`, medidos localmente;
- `reported`: `durationMs`, `attempts` e `usage`, preservados do AI Provider.

O Runner não estima tokens nem substitui valores reportados. Divergências entre durações observadas e reportadas são esperadas porque medem limites distintos.

---

## API

- requisições por endpoint
- latência
- status HTTP
- taxa de erro
- payload inválido

---

# Tracing

Uma execução completa deve poder ser visualizada como um trace.

```text
Execution
├── Product Owner
│   ├── Knowledge loading
│   ├── Prompt building
│   ├── AI request
│   ├── Schema validation
│   ├── Business validation
│   ├── Artifact generation
│   └── Resultado em memória
├── Developer
│   ├── Knowledge loading
│   ├── Prompt building
│   ├── AI request
│   ├── Schema validation
│   ├── Business validation
│   ├── Artifact generation
│   └── Resultado em memória
└── QA
    ├── Prompt building
    ├── AI request
    ├── Schema validation
    ├── Artifact generation
    └── Artifact persistence
```

---

# Auditoria

A plataforma deve registrar informações suficientes para reproduzir uma execução.

Registrar:

- ID e versão do prompt
- `templateHash` e `promptHash`
- agente
- modelo
- configurações
- entrada normalizada
- saída estruturada
- horários
- artefatos
- retries
- erros

Dados sensíveis devem ser removidos ou mascarados.

---

# Dashboard

O dashboard deve exibir:

- status da execução
- etapa atual
- duração
- agentes concluídos
- agentes com falha
- quantidade de artefatos
- consumo de tokens
- erros
- histórico de eventos

---

# Alertas

Alertas futuros podem ser criados para:

- aumento na taxa de erro
- custo acima do limite
- duração acima do esperado
- falhas consecutivas
- banco indisponível
- provider indisponível
- resposta inválida recorrente

---

# Retenção

Os períodos de retenção devem ser configuráveis.

Sugestão inicial:

- logs de aplicação: 30 dias
- logs de auditoria: 90 dias
- métricas agregadas: 12 meses
- artefatos: conforme política do projeto

No MVP local, os dados podem permanecer no SQLite.

---

# Privacidade

Nunca registrar diretamente:

- chaves de API
- tokens de autenticação
- senhas
- cookies
- segredos
- dados pessoais desnecessários
- código confidencial de clientes

Campos sensíveis devem ser mascarados.

```text
sk-****************
```

---

# Ferramentas

No MVP:

- logger estruturado
- persistência de eventos no banco
- dashboard interno

Evolução futura:

- OpenTelemetry
- Sentry
- Grafana
- Prometheus
- Loki
- ferramentas corporativas aprovadas

---

# Critérios de Aceite

A observabilidade será considerada adequada quando for possível:

- identificar rapidamente uma falha
- localizar a etapa responsável
- saber qual prompt e modelo foram usados
- consultar tempo e consumo
- reproduzir a sequência da execução
- analisar tendências sem acessar dados sensíveis
