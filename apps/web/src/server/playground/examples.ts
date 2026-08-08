import { technicalSpecificationStructureSchema } from '@brq/developer-agent';
import { productOwnerSpecificationSchema } from '@brq/product-owner-agent';
import { qaSpecificationStructureSchema } from '@brq/qa-agent';

/**
 * Synthetic, non-personal examples owned by the Playground composition layer.
 * They intentionally do not import the agents' test-only fixture modules.
 */
export const PLAYGROUND_PRODUCT_OWNER_SPECIFICATION = productOwnerSpecificationSchema.parse({
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
  definitionOfReady: [{ id: 'DOR-001', criterion: 'Critério de aceite principal definido' }],
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
});

export const PLAYGROUND_TECHNICAL_SPECIFICATION = technicalSpecificationStructureSchema.parse({
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
      changeType: 'MODIFY',
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
  dataModel: { changesRequired: false, migrationRequired: false, entities: [], relations: [] },
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
  outOfScope: [{ id: 'TOOS-001', description: 'Geração de código e testes nesta etapa.' }],
});

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

export const PLAYGROUND_QA_SPECIFICATION = qaSpecificationStructureSchema.parse({
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
});
