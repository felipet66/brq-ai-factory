import type { AIResponse } from '../../../core/ai-provider/contracts';
import { createProductOwnerSpecification } from '../../product-owner/testing/product-owner-fixtures';
import { GREENFIELD_DELIVERY_INTENT } from '@brq/shared/constants/delivery-intent';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { DeveloperAgentRequest, TechnicalSpecification } from '../contracts';
import { technicalSpecificationStructureSchema } from '../schemas';

export function createDeveloperRequest(
  overrides: Partial<DeveloperAgentRequest> = {},
): DeveloperAgentRequest {
  return {
    context: {
      executionId: 'execution-developer-001',
      agentExecutionId: 'agent-execution-developer-001',
      attempt: 1,
      agentVersion: '1.0.0',
      requestId: 'request-developer-001',
      traceId: 'trace-developer-001',
    },
    productOwnerSpecification: createProductOwnerSpecification(),
    deliveryIntent: GREENFIELD_DELIVERY_INTENT,
    model: 'fake-model',
    ...overrides,
  };
}

export function createTechnicalSpecification(
  overrides: Partial<TechnicalSpecification> = {},
): TechnicalSpecification {
  return technicalSpecificationStructureSchema.parse({
    readiness: 'READY',
    title: 'Arquitetura da consulta de pedidos',
    summary: 'Proposta técnica para consultar o andamento de pedidos nacionais.',
    objective: 'Entregar uma consulta rastreável sem ampliar o escopo funcional.',
    complexity: 'MEDIUM',
    estimatedStoryPoints: 13,
    architecture: {
      overview: 'Uma aplicação consulta o estado do pedido por um módulo isolado.',
      style: 'Arquitetura modular',
      rationale: 'Mantém a mudança pequena e compatível com as fronteiras existentes.',
      principles: ['Contratos explícitos e dependências direcionadas.'],
      constraints: ['Não inventar integrações não confirmadas.'],
      qualityAttributes: ['Rastreabilidade', 'Testabilidade'],
      trustBoundaries: ['Dados externos são tratados como não confiáveis.'],
    },
    components: [
      {
        id: 'CMP-001',
        name: 'Aplicação de consulta',
        kind: 'APPLICATION',
        changeType: 'CREATE',
        responsibility: 'Coordenar a consulta do andamento do pedido.',
        moduleIds: ['MOD-001'],
        dependsOnComponentIds: [],
      },
    ],
    modules: [
      {
        id: 'MOD-001',
        name: 'Consulta de pedidos',
        path: 'core/order-query',
        changeType: 'CREATE',
        responsibility: 'Aplicar o contrato técnico da consulta.',
        componentId: 'CMP-001',
        dependsOnModuleIds: [],
      },
    ],
    flows: [
      {
        id: 'FLW-001',
        name: 'Consultar andamento',
        description: 'Fluxo síncrono da consulta principal.',
        steps: [
          {
            order: 1,
            componentId: 'CMP-001',
            moduleId: 'MOD-001',
            action: 'Receber a consulta e devolver o andamento conhecido.',
          },
        ],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    contracts: [
      {
        id: 'CTR-001',
        name: 'Resposta da consulta',
        kind: 'RESPONSE',
        description: 'Representa o andamento retornado ao consumidor.',
        ownerComponentId: 'CMP-001',
        consumerComponentIds: [],
      },
    ],
    apis: [
      {
        id: 'API-001',
        name: 'Consultar pedido',
        method: 'GET',
        path: '/orders/{orderId}',
        description: 'Consulta o andamento de um pedido nacional.',
        componentId: 'CMP-001',
        requestContractId: null,
        responseContractId: 'CTR-001',
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    events: [],
    dataModel: {
      changesRequired: false,
      migrationRequired: false,
      entities: [],
      relations: [],
    },
    internalDependencies: [
      {
        id: 'IDEP-001',
        name: 'Contratos compartilhados',
        description: 'Contratos já disponíveis no repositório.',
        componentId: 'CMP-001',
        status: 'AVAILABLE',
        blocking: false,
      },
    ],
    externalDependencies: [
      {
        id: 'EDEP-001',
        name: 'Definição da origem do andamento',
        description: 'A integração concreta será definida antes da implementação.',
        componentId: 'CMP-001',
        kind: 'DECISION',
        status: 'UNKNOWN',
        blocking: false,
      },
    ],
    risks: [
      {
        id: 'TRSK-001',
        description: 'A origem do andamento ainda pode exigir um contrato adicional.',
        impact: 'MEDIUM',
        likelihood: 'LOW',
        mitigation: 'Confirmar a origem antes da implementação.',
        componentIds: ['CMP-001'],
      },
    ],
    implementationPhases: [
      {
        id: 'PH-001',
        order: 1,
        name: 'Contrato e consulta',
        objective: 'Definir e implementar a fronteira técnica da consulta.',
        dependsOnPhaseIds: [],
      },
    ],
    implementationPlan: [
      {
        id: 'PLAN-001',
        order: 1,
        title: 'Implementar o módulo de consulta',
        description: 'Criar o módulo e integrar o contrato de resposta.',
        phaseId: 'PH-001',
        componentIds: ['CMP-001'],
        moduleIds: ['MOD-001'],
        dependsOnPlanItemIds: [],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    technicalBacklog: [
      {
        id: 'TBL-001',
        title: 'Disponibilizar consulta de andamento',
        description: 'Implementar o fluxo técnico definido no plano.',
        priority: 'HIGH',
        implementationPlanIds: ['PLAN-001'],
        dependsOnBacklogItemIds: [],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    definitionOfDone: [
      {
        id: 'DOD-001',
        criterion: 'O contrato e o fluxo atendem ao critério funcional rastreado.',
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    decisions: [
      {
        id: 'DEC-001',
        title: 'Isolar a consulta em módulo próprio',
        context: 'A mudança precisa preservar as fronteiras existentes.',
        decision: 'Criar um módulo dedicado dentro da aplicação.',
        alternatives: ['Adicionar a lógica diretamente ao módulo existente.'],
        tradeOffs: [
          {
            benefit: 'Responsabilidade explícita e testável.',
            cost: 'Adiciona uma fronteira interna.',
          },
        ],
        rationale: 'O isolamento reduz acoplamento sem criar um novo serviço.',
        requiresAdr: false,
        componentIds: ['CMP-001'],
        moduleIds: ['MOD-001'],
      },
    ],
    traceability: [
      {
        id: 'TRC-001',
        sourceIds: ['AC-001', 'BL-001'],
        componentIds: ['CMP-001'],
        moduleIds: ['MOD-001'],
        flowIds: ['FLW-001'],
        contractIds: ['CTR-001'],
        apiIds: ['API-001'],
        eventIds: [],
        implementationPlanIds: ['PLAN-001'],
        technicalBacklogIds: ['TBL-001'],
        definitionOfDoneIds: ['DOD-001'],
      },
    ],
    assumptions: [],
    openQuestions: [],
    outOfScope: [
      {
        id: 'TOOS-001',
        description: 'Geração de código e testes nesta etapa de arquitetura.',
      },
    ],
    ...overrides,
  }) as TechnicalSpecification;
}

export function createDeveloperAIResponse(
  specification: TechnicalSpecification,
  overrides: Partial<AIResponse> = {},
): AIResponse {
  return {
    provider: 'fake',
    model: 'fake-model',
    content: JSON.stringify(specification),
    structuredData: structuredClone(specification) as unknown as JsonValue,
    finishReason: 'COMPLETED',
    usage: { inputTokens: 320, outputTokens: 640 },
    metadata: {
      responseId: 'fake-developer-response-001',
      durationMs: 30,
      attempts: 1,
    },
    ...overrides,
  };
}
