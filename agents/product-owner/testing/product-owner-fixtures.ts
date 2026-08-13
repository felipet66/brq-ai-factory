import type { AIResponse } from '../../../core/ai-provider/contracts';
import { GREENFIELD_DELIVERY_INTENT } from '@brq/shared/constants/delivery-intent';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { ProductOwnerAgentRequest, ProductOwnerSpecification } from '../contracts';
import { productOwnerSpecificationStructureSchema } from '../schemas';

export function createProductOwnerRequest(
  overrides: Partial<ProductOwnerAgentRequest> = {},
): ProductOwnerAgentRequest {
  return {
    context: {
      executionId: 'execution-po-001',
      agentExecutionId: 'agent-execution-po-001',
      attempt: 1,
      agentVersion: '1.0.0',
      requestId: 'request-po-001',
      traceId: 'trace-po-001',
    },
    demand: {
      title: 'Consulta de pedidos',
      description: 'Permitir que clientes consultem o andamento de seus pedidos.',
      businessGoal: 'Reduzir contatos manuais com o atendimento.',
      targetUsers: ['Cliente autenticado'],
      constraints: ['Não inventar integrações ainda não informadas.'],
      priority: 'HIGH',
    },
    deliveryIntent: GREENFIELD_DELIVERY_INTENT,
    additionalContext: 'A primeira versão atende somente pedidos nacionais.',
    model: 'fake-model',
    ...overrides,
  };
}

export function createProductOwnerSpecification(
  overrides: Partial<ProductOwnerSpecification> = {},
): ProductOwnerSpecification {
  return productOwnerSpecificationStructureSchema.parse({
    readiness: 'READY',
    title: 'Consulta de pedidos',
    summary: 'Consulta do andamento de pedidos nacionais.',
    objective: 'Dar visibilidade ao cliente e reduzir contatos manuais.',
    context: 'Clientes precisam consultar o andamento de pedidos já realizados.',
    userStory: {
      asA: 'cliente autenticado',
      iWant: 'consultar o andamento de um pedido',
      soThat: 'eu acompanhe a entrega sem contatar o atendimento',
    },
    acceptanceCriteria: [
      {
        id: 'AC-001',
        given: 'que o cliente possui um pedido nacional',
        when: 'ele consulta o pedido',
        then: 'o andamento atual é apresentado',
      },
    ],
    businessRules: [],
    scenarios: [
      {
        id: 'SCN-001',
        title: 'Consulta principal',
        type: 'MAIN',
        given: ['O cliente possui um pedido nacional'],
        when: ['O cliente solicita o andamento'],
        then: ['O andamento atual é apresentado'],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    assumptions: [],
    dependencies: [],
    risks: [],
    openQuestions: [],
    outOfScope: [],
    definitionOfReady: [
      {
        id: 'DOR-001',
        criterion: 'Critério de aceite principal definido',
      },
    ],
    backlogItems: [
      {
        id: 'BL-001',
        title: 'Consultar andamento do pedido',
        description: 'Disponibilizar o andamento do pedido ao cliente.',
        priority: 'HIGH',
        dependencyIds: [],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    ...overrides,
  }) as ProductOwnerSpecification;
}

export function createProductOwnerAIResponse(
  specification: ProductOwnerSpecification,
  overrides: Partial<AIResponse> = {},
): AIResponse {
  return {
    provider: 'fake',
    model: 'fake-model',
    content: JSON.stringify(specification),
    structuredData: structuredClone(specification) as unknown as JsonValue,
    finishReason: 'COMPLETED',
    usage: { inputTokens: 120, outputTokens: 240 },
    metadata: {
      responseId: 'fake-po-response-001',
      durationMs: 25,
      attempts: 1,
    },
    ...overrides,
  };
}
