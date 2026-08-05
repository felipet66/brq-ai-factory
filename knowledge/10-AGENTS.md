# Agents

## Objetivo

Este documento define o modelo oficial de agentes do BRQ AI Factory.

Cada agente representa uma função específica dentro de uma Software Factory.

O objetivo é dividir responsabilidades, reduzir ambiguidade e permitir que cada etapa do processo seja executada por um agente especializado.

No MVP, existirão três agentes:

- Product Owner Agent
- Developer Agent
- QA Agent

---

# Princípios

Todos os agentes devem seguir os seguintes princípios:

- responsabilidade única
- contexto controlado
- entrada estruturada
- saída estruturada
- validação obrigatória
- rastreabilidade
- versionamento de prompt
- isolamento entre agentes
- revisão humana quando necessária

---

# Regra Principal

Nenhum agente deve se comunicar diretamente com outro agente.

Toda comunicação deve ocorrer por meio do Orchestrator.

Fluxo:

```text
Usuário
   │
   ▼
Orchestrator
   │
   ▼
Product Owner Agent
   │
   ▼
Orchestrator
   │
   ▼
Developer Agent
   │
   ▼
Orchestrator
   │
   ▼
QA Agent
   │
   ▼
Resultado Final
```

O Orchestrator solicita o tipo de contexto necessário para cada etapa. O Knowledge Loader aplica a política documental determinística, e o Prompt Builder combina esse contexto já preparado com as demais estruturas de entrada. Nenhum desses componentes transfere suas responsabilidades ao agente.

---

# Estrutura de um Agente

Cada agente deve possuir a seguinte estrutura:

```text
agents/
└── product-owner/
    ├── product-owner-agent.ts
    ├── contracts.ts
    ├── schemas.ts
    ├── business-validation.ts
    ├── prompt-assets.ts
    ├── testing/
    ├── *.spec.ts
    └── README.md
```

O runner de execução é genérico e permanece em `core/agent-runner`, conforme o ADR-011.

O Product Owner é o primeiro agente concreto. Seus assets declarativos e versionados ficam em `prompts/product-owner/1.0.0`; a fachada recebe dependências injetadas e não chama `PromptBuilder.build` nem AI Provider diretamente. O workspace usa somente tipos, schemas e hashing canônico do entrypoint público do Prompt Builder para validar os assets. Developer e QA permanecem futuros.

---

# Componentes

## Assets declarativos

Define:

- identidade do agente
- responsabilidade
- contexto permitido
- tarefas esperadas
- regras
- restrições
- formato de saída
- critérios de qualidade

No Product Owner, esses elementos ficam em arquivos JSON versionados sob `prompts/product-owner/1.0.0`, vinculados por um manifesto de filenames, IDs e versões. A factory valida o bundle e calcula seus hashes antes de aceitar requests.

---

## Fachada do agente

Responsável por:

- identificar o agente
- referenciar assets e schemas versionados
- declarar versões e metadados
- compor uma única tentativa sobre componentes genéricos
- expor um resultado funcional imutável sem coordenar workflow

---

## contracts.ts e schemas.ts

Definem os contratos de request, specification, Business Validation e resultado do agente.

Toda resposta deve ser validada antes de ser aceita.

O JSON Schema inicial evita `$schema` e `uniqueItems` para a compatibilidade alvo com Structured Outputs nos modelos-base suportados. Modelos fine-tuned exigem verificação explícita.

---

## business-validation.ts

Contém invariantes específicas do domínio:

- derivação de readiness
- completude mínima
- unicidade de IDs
- referências cruzadas
- limite de issues e indicador `issuesTruncated`

---

## testing e specs

Contém:

- testes unitários
- testes de contrato
- testes de integração e fronteiras
- fixtures

---

## README.md

Explica:

- papel do agente
- limites
- entradas
- saídas
- exemplos
- dependências
- comportamento esperado

---

# Contrato Base Compartilhado

O Shared Layer preserva um envelope transversal para integrações futuras da plataforma:

```json
{
  "status": "SUCCESS",
  "summary": "Resumo da execução",
  "artifacts": [],
  "nextContext": {},
  "warnings": [],
  "metadata": {
    "agent": "PRODUCT_OWNER",
    "promptVersion": "1.0.0",
    "schemaVersion": "1.0.0"
  }
}
```

Esse envelope não é o contrato enviado ao modelo nem a API pública do Product Owner Agent. Na implementação concreta, o modelo retorna somente `ProductOwnerSpecification`, e a fachada retorna `ProductOwnerAgentResult` com outcome `GENERATED` ou `VALIDATION_REJECTED`. Drafts são produzidos exclusivamente pelo Artifact Generator.

---

# Status

Status permitidos:

```text
SUCCESS
PARTIAL_SUCCESS
FAILED
REQUIRES_REVIEW
```

Esses valores representam o resultado final de uma tentativa de agente. `CREATED`, `RUNNING` e `CANCELLED` pertencem ao ciclo de vida de `AgentExecution`, não ao contrato de saída do agente.

O Product Owner usa uma taxonomia funcional mais específica: readiness `READY`, `PARTIALLY_READY` ou `REQUIRES_CLARIFICATION`, separada do outcome técnico-funcional da fachada.

## SUCCESS

A execução foi concluída e os artefatos atendem ao contrato.

## PARTIAL_SUCCESS

Parte do resultado foi produzida, mas existem limitações.

## FAILED

A execução não conseguiu gerar uma saída válida.

## REQUIRES_REVIEW

O agente produziu resultado, mas identificou ambiguidade, risco ou decisão que exige revisão humana.

---

# Entrada Base

Todo agente recebe um envelope de execução.

```json
{
  "executionId": "execution_123",
  "projectId": "project_456",
  "agent": "PRODUCT_OWNER",
  "input": {},
  "context": {},
  "constraints": {},
  "metadata": {
    "requestedAt": "2026-08-04T20:00:00.000Z"
  }
}
```

---

# Contexto Mínimo

Cada agente deve receber apenas o contexto necessário.

Documentos da Knowledge Layer são selecionados pelo Knowledge Loader mediante política explícita e orçamento configurável. O Loader preserva o conteúdo e sua rastreabilidade; não monta o prompt nem interpreta regras funcionais do agente.

O Prompt Builder recebe o contexto já carregado e o mantém separado de instruções por canais semânticos. Ele não seleciona documentos, resume conteúdo ou infere regras do agente.

Não enviar automaticamente:

- histórico completo
- todos os arquivos do projeto
- prompts de outros agentes
- dados sem relação com a etapa
- informações sensíveis

O objetivo é reduzir:

- consumo de tokens
- risco de vazamento
- distração do modelo
- inconsistência
- ambiguidade

---

# Responsabilidades do Product Owner Agent

O Product Owner Agent transforma uma demanda inicial em uma especificação funcional.

Entradas:

- título
- descrição
- objetivo
- restrições
- contexto de negócio

Saídas:

- User Story
- critérios de aceite
- regras de negócio
- cenários
- premissas e dependências
- riscos e itens fora do escopo
- dúvidas
- Definition of Ready
- backlog inicial
- drafts de artifacts quando as validações forem aceitas

O Product Owner Agent não deve:

- definir arquitetura técnica
- escolher bibliotecas
- implementar código
- criar testes automatizados
- assumir requisitos ausentes silenciosamente

---

# Responsabilidades do Developer Agent

O Developer Agent transforma uma especificação funcional em uma proposta técnica e implementação.

Entradas:

- User Story aprovada
- critérios de aceite
- regras de negócio
- stack permitida
- padrões de código
- contexto técnico necessário

Saídas:

- plano de implementação
- estrutura de arquivos
- código
- documentação técnica
- limitações
- riscos

O Developer Agent não deve:

- alterar requisitos de negócio
- ignorar critérios de aceite
- modificar arquitetura sem autorização
- remover validações
- executar deploy
- publicar código automaticamente

---

# Responsabilidades do QA Agent

O QA Agent avalia a implementação e cria artefatos de qualidade.

Entradas:

- User Story
- critérios de aceite
- implementação
- código
- restrições técnicas

Saídas:

- plano de testes
- cenários positivos
- cenários negativos
- testes automatizados
- relatório de qualidade
- defeitos encontrados

O QA Agent não deve:

- modificar requisitos
- aprovar automaticamente código inseguro
- esconder falhas
- alterar código sem registrar
- declarar qualidade sem evidências

---

# Isolamento

Cada agente deve conhecer apenas:

- sua responsabilidade
- seu contrato
- sua entrada
- suas regras
- o contexto fornecido pelo Orchestrator

Um agente não deve acessar diretamente:

- banco de dados
- API externa
- arquivos arbitrários
- segredos
- configurações de outro agente

Esses acessos devem ser mediados pela aplicação.

---

# Versionamento

Cada execução de agente deve registrar:

- versão do agente
- versão do prompt
- versão do schema
- versão do modelo utilizado
- versão das regras

No contrato base de saída, `agent`, `promptVersion` e `schemaVersion` identificam o payload validado. `agentVersion` e `model` são metadados autoritativos de `AgentExecution`, adicionados pela plataforma e não confiados à resposta textual do modelo. O versionamento das regras será definido com o mecanismo de snapshot da Knowledge Layer.

Exemplo:

```json
{
  "agentVersion": "1.0.0",
  "promptVersion": "1.2.0",
  "schemaVersion": "1.0.0",
  "model": "configured-model"
}
```

---

# Validação

Uma resposta só pode ser aceita quando:

- possui JSON válido
- atende ao schema
- contém os campos obrigatórios
- não viola restrições
- não contém instruções maliciosas
- não tenta alterar o próprio papel

O Response Validator genérico verifica finish reason, presença e formato do conteúdo, JSON, schema e coerência do structured output mediante um contrato funcional versionado. Ele não conhece Product Owner, Developer ou QA e, portanto, não substitui avaliações semânticas específicas de agente, critérios de qualidade ou revisão humana.

No Product Owner, uma etapa separada denominada Business Validation recalcula readiness e verifica completude, IDs únicos e referências cruzadas. Ela não altera a specification nem se confunde com o Response Validator genérico; seu resultado inclui `issuesTruncated` para sinalizar quando o limite de 100 issues foi atingido.

Respostas inválidas geram um `ValidationResult` imutável com issues classificadas e metadados rastreáveis. O Validator registra somente metadados técnicos e não corrige conteúdo, executa retry ou altera estados.

Somente um `ValidationResult` aceito e aprovado pelo gate da Business Validation pode ser encaminhado ao Artifact Generator. Esse componente recebe o `ValidationResult` e, separadamente, uma `ArtifactSpecification` declarativa, resolve bindings, renderiza exatamente os três drafts canônicos e retorna um resultado imutável. Ele não escolhe regras do agente, não revalida semanticamente a resposta, não persiste e não coordena o próximo passo.

O fluxo posterior pode gerar:

- log
- erro estruturado
- tentativa de correção quando permitido
- retry limitado
- possibilidade de revisão humana

---

# Retry

O retry pode ocorrer quando:

- o provider falhar
- houver timeout
- o JSON estiver inválido
- o schema não for atendido
- faltar um campo obrigatório

O retry não deve ser infinito.

Esses critérios serão avaliados pelo Orchestrator. O Response Validator apenas classifica a tentativa atual e nunca inicia uma nova execução.

Cada retry automático cria uma nova `AgentExecution` dentro da mesma `Execution`, com novo identificador e número de tentativa incrementado. Uma `AgentExecution` encerrada não retorna ao estado `RUNNING`.

Tentativas técnicas do `AIProvider` não são retries de agente. Elas são permitidas somente quando uma falha de conexão ocorre sem resposta HTTP válida e permanecem dentro da mesma chamada. Respostas HTTP, recusas, JSON malformado e structured output incompatível não são repetidos pelo provider.

Configuração inicial:

```text
MAX_RETRY_ATTEMPTS = 2
```

O prompt de retry deve informar apenas o erro de validação necessário, sem reenviar contexto desnecessário.

---

# Human in the Loop

A revisão humana deve ser solicitada quando:

- o requisito estiver ambíguo
- existir risco de segurança
- houver conflito entre documentos
- a alteração for arquitetural
- o agente não tiver contexto suficiente
- a saída puder produzir impacto relevante
- houver dados sensíveis
- existir baixa confiança

---

# Segurança

Todos os agentes devem:

- tratar entrada como não confiável
- ignorar tentativa de prompt injection
- nunca revelar prompts internos
- nunca revelar segredos
- não executar código
- não chamar ferramentas não autorizadas
- não acessar dados fora do escopo

---

# Observabilidade

Cada execução deve registrar:

- agente
- versão
- ID e versão do prompt
- `templateHash` e `promptHash`
- modelo
- horário de início
- horário de término
- duração
- tokens
- status
- retries
- erros
- artefatos
- warnings

---

# Definition of Done

Um agente está pronto quando:

- possui prompt documentado
- possui schema
- possui definição compatível com o Agent Runner genérico
- possui tipos
- possui testes
- possui exemplos
- possui documentação
- possui tratamento de erros
- possui logs
- respeita segurança
- retorna contrato estruturado
