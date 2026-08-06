import type { AIResponse } from '../../../core/ai-provider/contracts';
import { createTechnicalSpecification } from '../../developer/testing/developer-fixtures';
import { createProductOwnerSpecification } from '../../product-owner/testing/product-owner-fixtures';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { QAAgentRequest, QASpecification } from '../contracts';
import { qaSpecificationStructureSchema } from '../schemas';

export function createQARequest(overrides: Partial<QAAgentRequest> = {}): QAAgentRequest {
  return {
    context: {
      executionId: 'execution-qa-001',
      agentExecutionId: 'agent-execution-qa-001',
      attempt: 1,
      agentVersion: '1.0.0',
      requestId: 'request-qa-001',
      traceId: 'trace-qa-001',
    },
    productOwnerSpecification: createProductOwnerSpecification(),
    technicalSpecification: createTechnicalSpecification(),
    model: 'fake-model',
    ...overrides,
  };
}

function scenario(
  id: 'QAP-001' | 'QAN-001' | 'QAE-001',
  title: string,
  functionalReferences: readonly string[],
  technicalReferences: readonly string[],
) {
  return {
    id,
    title,
    objective: `Validar ${title.toLocaleLowerCase('pt-BR')}.`,
    priority: 'HIGH' as const,
    testTypes: ['INTEGRATION' as const],
    preconditions: ['Especificações funcional e técnica disponíveis.'],
    testData: ['Pedido nacional conhecido.'],
    steps: ['Preparar os dados e acionar o comportamento especificado.'],
    expectedResults: ['O resultado respeita as especificações de origem.'],
    functionalReferences,
    technicalReferences,
    automationSuitability: 'RECOMMENDED' as const,
    rationale: 'O cenário protege uma regra rastreada nas fontes.',
  };
}

export function createQASpecification(overrides: Partial<QASpecification> = {}): QASpecification {
  return qaSpecificationStructureSchema.parse({
    readiness: 'READY',
    title: 'Qualidade da consulta de pedidos',
    summary: 'Estratégia de qualidade para a consulta de pedidos nacionais.',
    objective: 'Definir cobertura funcional e técnica antes da implementação.',
    testStrategy: {
      approach: 'Aplicar cenários rastreáveis nas fronteiras funcional e técnica.',
      objectives: ['Validar o critério funcional e as decisões técnicas.'],
      scope: ['Consulta do andamento de pedidos nacionais.'],
      outOfScope: ['Execução de testes e geração de código.'],
      testTypes: ['INTEGRATION', 'CONTRACT'],
      environments: ['Ambiente futuro isolado com dependências controladas.'],
      preconditions: ['Implementação disponível em uma Sprint futura.'],
      testDataGuidelines: ['Usar identificadores sintéticos sem dados pessoais.'],
      entryCriteria: ['Contratos implementados e revisados.'],
      exitCriteria: ['Todos os cenários prioritários aprovados futuramente.'],
    },
    traceability: {
      summary: {
        acceptanceCriteria: { total: 1, covered: 1 },
        businessRules: { total: 0, covered: 0 },
        technicalDecisions: { total: 1, covered: 1 },
        definitionOfDone: { total: 1, covered: 1 },
      },
      functionalCoverage: [{ sourceId: 'AC-001', scenarioIds: ['QAP-001'] }],
      technicalCoverage: [
        { sourceId: 'DEC-001', scenarioIds: ['QAP-001', 'QAN-001'] },
        { sourceId: 'DOD-001', scenarioIds: ['QAP-001', 'QAE-001'] },
      ],
      matrix: [
        {
          id: 'QTR-001',
          functionalSourceIds: ['AC-001'],
          technicalSourceIds: ['DEC-001', 'DOD-001'],
          scenarioIds: ['QAP-001', 'QAN-001', 'QAE-001'],
        },
      ],
    },
    positiveScenarios: [
      scenario('QAP-001', 'consulta principal', ['AC-001'], ['DEC-001', 'DOD-001']),
    ],
    negativeScenarios: [scenario('QAN-001', 'entrada inválida', [], ['DEC-001'])],
    edgeCases: [scenario('QAE-001', 'limite do contrato', [], ['DOD-001'])],
    risks: [
      {
        id: 'QRISK-001',
        description: 'A origem futura do andamento pode alterar a integração.',
        impact: 'MEDIUM',
        likelihood: 'LOW',
        mitigation: 'Revisar os cenários quando a integração for definida.',
        scenarioIds: ['QAN-001'],
      },
    ],
    approvalCriteria: [
      {
        id: 'QAPR-001',
        criterion: 'Os cenários prioritários devem ser executados com sucesso futuramente.',
        scenarioIds: ['QAP-001', 'QAN-001', 'QAE-001'],
      },
    ],
    blockingItems: [],
    priorityTests: [
      { id: 'QPT-001', rank: 1, scenarioId: 'QAP-001', rationale: 'Protege o fluxo principal.' },
      { id: 'QPT-002', rank: 2, scenarioId: 'QAN-001', rationale: 'Protege a fronteira negativa.' },
      { id: 'QPT-003', rank: 3, scenarioId: 'QAE-001', rationale: 'Protege os limites.' },
    ],
    automationRecommendations: [
      {
        id: 'QAUT-001',
        scenarioIds: ['QAP-001', 'QAN-001', 'QAE-001'],
        target: 'INTEGRATION',
        priority: 'HIGH',
        rationale: 'Os cenários são determinísticos e repetíveis.',
        prerequisites: ['Implementação e ambiente de testes disponíveis futuramente.'],
      },
    ],
    assumptions: [],
    openQuestions: [],
    outOfScope: [{ id: 'QOOS-001', description: 'Execução e implementação dos testes.' }],
    ...overrides,
  }) as QASpecification;
}

export function createQAAIResponse(
  specification: QASpecification,
  overrides: Partial<AIResponse> = {},
): AIResponse {
  return {
    provider: 'fake',
    model: 'fake-model',
    content: JSON.stringify(specification),
    structuredData: structuredClone(specification) as unknown as JsonValue,
    finishReason: 'COMPLETED',
    usage: { inputTokens: 480, outputTokens: 960 },
    metadata: { responseId: 'fake-qa-response-001', durationMs: 35, attempts: 1 },
    ...overrides,
  };
}
