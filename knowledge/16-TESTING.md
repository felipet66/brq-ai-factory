# Testing Strategy

## Objetivo

Este documento define a estratégia oficial de testes do BRQ AI Factory.

Os testes devem garantir que o sistema continue funcionando corretamente durante sua evolução.

Todo comportamento crítico deve possuir cobertura automatizada.

---

# Princípios

A estratégia de testes segue os seguintes princípios:

- testar comportamentos, não detalhes internos
- priorizar fluxos críticos
- manter testes determinísticos
- evitar dependência de serviços externos
- utilizar mocks apenas quando necessário
- tornar falhas fáceis de diagnosticar

---

# Pirâmide de Testes

A aplicação utilizará:

1. Testes unitários
2. Testes de integração
3. Testes de contrato
4. Testes end-to-end
5. Avaliações de agentes de IA

---

# Testes Unitários

Ferramenta:

- Vitest

Testes unitários devem validar:

- funções puras
- validações
- schemas
- regras de domínio
- transformações de dados
- transições de estado
- políticas de retry
- formatação de respostas

Exemplo:

```ts
describe('canRetryAgentExecution', () => {
  it('returns true when the execution failed and attempts remain', () => {
    const result = canRetryAgentExecution({
      status: 'FAILED',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(result).toBe(true);
  });
});
```

---

# Testes de Integração

Devem validar a interação entre módulos.

Exemplos:

- Orchestrator e repository
- Route Handler e service
- Agent Runner e AI Provider
- Prisma e banco de testes
- geração e persistência de Artifact
- validação da resposta estruturada de um agente

O banco utilizado nos testes deve ser isolado.

Nenhum teste automatizado deve utilizar dados de produção.

---

# Testes de Contrato

Contratos de entrada e saída devem ser validados.

Principais contratos:

- API
- resposta dos agentes
- artefatos
- eventos do Orchestrator
- AI Provider
- repository

Todos os contratos devem utilizar schemas versionados.

Exemplo:

```ts
const result = agentResponseSchema.safeParse(response);

expect(result.success).toBe(true);
```

---

# Testes End-to-End

Ferramenta:

- Playwright

Os testes E2E devem validar os principais fluxos do usuário.

Fluxos mínimos do MVP:

1. Criar um projeto.
2. Criar uma demanda.
3. Iniciar uma execução.
4. Acompanhar o progresso.
5. Visualizar o resultado do Product Owner.
6. Visualizar o resultado do Developer.
7. Visualizar o resultado do QA.
8. Consultar artefatos.
9. Consultar histórico.
10. Reexecutar uma etapa com falha.

---

# Testes do Orchestrator

O Orchestrator é um componente crítico.

Deve possuir testes para:

- criação da execução
- execução sequencial dos agentes
- persistência antes da próxima etapa
- falha no Product Owner
- falha no Developer
- falha no QA
- retry
- cancelamento
- timeout
- retomada de execução
- geração de logs
- criação de artefatos
- transições de estado inválidas

---

# Testes dos Agentes

Os agentes não devem ser testados apenas pela resposta textual.

Cada agente deve possuir avaliações para:

- schema válido
- campos obrigatórios
- aderência à responsabilidade
- ausência de conteúdo proibido
- qualidade mínima
- consistência entre entrada e saída

---

# Avaliação de Respostas de IA

Como respostas de IA podem variar, os testes não devem depender de igualdade textual completa.

Evitar:

```ts
expect(response).toBe('Texto exato esperado');
```

Preferir:

- validação de schema
- presença de campos
- regras semânticas
- critérios objetivos
- fixtures controladas
- respostas simuladas

---

# AI Provider Falso

Os testes automatizados devem utilizar um provider falso por padrão.

Exemplo:

```ts
const provider = new FakeAIProvider([{ type: 'success' }]);
const response = await provider.generate(request);

expect(aiResponseSchema.safeParse(response).success).toBe(true);
```

Chamadas reais à OpenAI não devem ocorrer na suíte principal.

O FakeAIProvider deve simular sucesso, timeout, cancelamento, rate limit, resposta técnica inválida, falhas transitórias e permanentes, JSON malformado e structured output incompatível.

---

# Testes com Modelo Real

Testes com modelo real devem:

- ser separados
- ser opcionais
- possuir limite de custo
- não executar em todo commit
- usar dados fictícios
- não enviar informações confidenciais

Comando explícito:

```bash
RUN_OPENAI_LIVE_TESTS=true OPENAI_LIVE_TEST_MODEL=nome-do-modelo npm run test:ai:live
```

---

# Fixtures

Fixtures devem ser utilizadas para representar:

- demanda inicial
- resposta do Product Owner
- resposta do Developer
- resposta do QA
- execução concluída
- execução com falha
- artefatos gerados

Fixtures não devem conter dados reais de clientes.

---

# Cobertura

Cobertura mínima inicial:

- 80% para domínio e Orchestrator
- 70% para services e repositories
- cobertura E2E dos fluxos críticos

A cobertura não deve ser utilizada como única métrica de qualidade.

Código crítico deve ser testado mesmo que a cobertura global já tenha sido atingida.

---

# Nomenclatura

Formato recomendado:

```text
should [expected behavior] when [condition]
```

Exemplo:

```ts
it('should mark the execution as failed when an agent returns an invalid schema');
```

---

# Estrutura

Testes podem permanecer próximos ao código.

```text
orchestrator/
├── orchestrator.ts
├── orchestrator.spec.ts
└── fixtures/
```

Testes E2E devem permanecer em:

```text
tests/
└── e2e/
```

---

# Dados de Teste

Todo dado utilizado deve ser:

- fictício
- reproduzível
- não sensível
- independente
- descartável

---

# CI

O pipeline de integração contínua deve executar:

```bash
npm run lint
npm run typecheck
npm run test
npm run prisma:validate
npm run build
```

Testes E2E e chamadas reais a providers não fazem parte da CI atual.

---

# Definition of Done para Testes

Uma funcionalidade só pode ser considerada concluída quando:

- possui testes adequados
- os testes passam localmente
- os testes passam na CI
- os cenários negativos foram considerados
- os contratos foram validados
- os fluxos críticos permanecem funcionando
