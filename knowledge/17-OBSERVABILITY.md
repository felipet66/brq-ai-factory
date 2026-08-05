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

- payload transformado
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

artifact.created
artifact.versioned

prompt.loaded
prompt.validation.failed

ai.request.started
ai.request.completed
ai.request.failed
```

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
│   ├── Prompt loading
│   ├── AI request
│   ├── Schema validation
│   └── Artifact persistence
├── Developer
│   ├── Prompt loading
│   ├── AI request
│   ├── Schema validation
│   └── Artifact persistence
└── QA
    ├── Prompt loading
    ├── AI request
    ├── Schema validation
    └── Artifact persistence
```

---

# Auditoria

A plataforma deve registrar informações suficientes para reproduzir uma execução.

Registrar:

- versão do prompt
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
