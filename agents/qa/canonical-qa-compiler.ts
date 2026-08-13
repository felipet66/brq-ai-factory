import { technicalSpecificationSchema } from '@brq/developer-agent';
import { productOwnerSpecificationSchema } from '@brq/product-owner-agent';

import { deriveQAReadiness, validateQABusinessRules } from './business-validation';
import type { CanonicalQACompilationInput, QASpecification } from './contracts';
import { deepFreeze } from './immutability';
import { qaSpecificationStructureSchema } from './schemas';

const SCENARIO_IDS = ['QAP-001', 'QAN-001', 'QAE-001'] as const;

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedUniqueIds(values: readonly { readonly id: string }[], source: string): string[] {
  const ids = values.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`A fonte ${source} possui IDs duplicados.`);
  }
  return ids.sort(compareCodeUnits);
}

function scenario(
  id: (typeof SCENARIO_IDS)[number],
  kind: 'POSITIVE' | 'NEGATIVE' | 'EDGE',
  functionalReferences: readonly string[],
  technicalReferences: readonly string[],
) {
  const descriptions = {
    POSITIVE: {
      title: 'Fluxo principal rastreável',
      objective: 'Validar o comportamento esperado pelas fontes funcionais e técnicas.',
      steps: ['Executar o fluxo principal definido pelas especificações de origem.'],
      expected: ['O resultado atende a todas as fontes relacionadas ao cenário.'],
      rationale: 'Protege deterministicamente o caminho funcional principal.',
    },
    NEGATIVE: {
      title: 'Rejeição de entrada inválida',
      objective: 'Validar a rejeição controlada de entradas incompatíveis com as fontes.',
      steps: ['Executar o fluxo com uma entrada inválida representativa.'],
      expected: ['A entrada inválida é rejeitada sem violar os contratos de origem.'],
      rationale: 'Protege deterministicamente as fronteiras negativas.',
    },
    EDGE: {
      title: 'Limites das especificações',
      objective: 'Validar os limites funcionais e técnicos declarados pelas fontes.',
      steps: ['Executar o fluxo no limite permitido pelas especificações de origem.'],
      expected: ['O comportamento de limite permanece compatível com as fontes.'],
      rationale: 'Protege deterministicamente casos de fronteira.',
    },
  } as const;
  const description = descriptions[kind];

  return {
    id,
    title: description.title,
    objective: description.objective,
    priority: kind === 'POSITIVE' ? ('CRITICAL' as const) : ('HIGH' as const),
    testTypes: kind === 'EDGE' ? (['UNIT'] as const) : (['INTEGRATION'] as const),
    preconditions: ['As especificações funcional e técnica estão disponíveis e validadas.'],
    testData: ['Usar dados sintéticos compatíveis com o cenário.'],
    steps: description.steps,
    expectedResults: description.expected,
    functionalReferences,
    technicalReferences,
    automationSuitability: 'RECOMMENDED' as const,
    rationale: description.rationale,
  };
}

function allTechnicalIds(
  technicalSpecification: CanonicalQACompilationInput['technicalSpecification'],
): string[] {
  return sortedUniqueIds(
    [
      ...technicalSpecification.components,
      ...technicalSpecification.modules,
      ...technicalSpecification.flows,
      ...technicalSpecification.contracts,
      ...technicalSpecification.apis,
      ...technicalSpecification.events,
      ...technicalSpecification.dataModel.entities,
      ...technicalSpecification.dataModel.relations,
      ...technicalSpecification.decisions,
      ...technicalSpecification.definitionOfDone,
    ],
    'TechnicalSpecification',
  );
}

export function compileCanonicalQASpecification(
  rawInput: CanonicalQACompilationInput,
): QASpecification {
  const productOwnerSpecification = productOwnerSpecificationSchema.parse(
    rawInput.productOwnerSpecification,
  );
  const technicalSpecification = technicalSpecificationSchema.parse(
    rawInput.technicalSpecification,
  );
  const acceptanceCriterionIds = sortedUniqueIds(
    productOwnerSpecification.acceptanceCriteria,
    'ProductOwnerSpecification.acceptanceCriteria',
  );
  const businessRuleIds = sortedUniqueIds(
    productOwnerSpecification.businessRules,
    'ProductOwnerSpecification.businessRules',
  );
  const decisionIds = sortedUniqueIds(
    technicalSpecification.decisions,
    'TechnicalSpecification.decisions',
  );
  const definitionOfDoneIds = sortedUniqueIds(
    technicalSpecification.definitionOfDone,
    'TechnicalSpecification.definitionOfDone',
  );
  const functionalReferences = [...acceptanceCriterionIds, ...businessRuleIds].sort(
    compareCodeUnits,
  );
  const requiredTechnicalReferences = [...decisionIds, ...definitionOfDoneIds].sort(
    compareCodeUnits,
  );
  const availableTechnicalReferences = allTechnicalIds(technicalSpecification);
  const technicalReferences =
    requiredTechnicalReferences.length > 0
      ? requiredTechnicalReferences
      : availableTechnicalReferences.slice(0, 1);
  const hasTraceableSource = functionalReferences.length + technicalReferences.length > 0;
  const readiness = deriveQAReadiness(
    productOwnerSpecification.readiness,
    technicalSpecification.readiness,
    [],
    [],
    [],
  );
  const scenarioIds = hasTraceableSource ? [...SCENARIO_IDS] : [];
  const positiveScenarios = hasTraceableSource
    ? [scenario('QAP-001', 'POSITIVE', functionalReferences, technicalReferences)]
    : [];
  const negativeScenarios = hasTraceableSource
    ? [scenario('QAN-001', 'NEGATIVE', functionalReferences, technicalReferences)]
    : [];
  const edgeCases = hasTraceableSource
    ? [scenario('QAE-001', 'EDGE', functionalReferences, technicalReferences)]
    : [];

  const candidate = {
    readiness,
    title: 'Plano canônico de qualidade',
    summary: 'Especificação de QA compilada deterministicamente a partir das fontes aprovadas.',
    objective: 'Garantir cobertura rastreável das exigências funcionais e técnicas.',
    testStrategy: {
      approach:
        'Aplicar cenários determinísticos com rastreabilidade integral das fontes exigidas.',
      objectives: ['Validar o comportamento funcional e os compromissos técnicos rastreados.'],
      scope: ['Comportamentos e contratos descritos nas especificações de origem.'],
      outOfScope: ['Execução dos testes e alterações no código da aplicação.'],
      testTypes: ['UNIT', 'INTEGRATION', 'CONTRACT', 'ACCESSIBILITY', 'REGRESSION'],
      environments: ['Ambiente isolado com dependências controladas.'],
      preconditions: ['As especificações de origem foram validadas pelo pipeline.'],
      testDataGuidelines: ['Usar somente dados sintéticos, mínimos e não sensíveis.'],
      entryCriteria: ['Implementação e contratos estão disponíveis para validação.'],
      exitCriteria: ['Todos os cenários prioritários atendem aos resultados esperados.'],
    },
    traceability: {
      summary: {
        acceptanceCriteria: {
          total: acceptanceCriterionIds.length,
          covered: hasTraceableSource ? acceptanceCriterionIds.length : 0,
        },
        businessRules: {
          total: businessRuleIds.length,
          covered: hasTraceableSource ? businessRuleIds.length : 0,
        },
        technicalDecisions: {
          total: decisionIds.length,
          covered: hasTraceableSource ? decisionIds.length : 0,
        },
        definitionOfDone: {
          total: definitionOfDoneIds.length,
          covered: hasTraceableSource ? definitionOfDoneIds.length : 0,
        },
      },
      functionalCoverage: functionalReferences.map((sourceId) => ({ sourceId, scenarioIds })),
      technicalCoverage: requiredTechnicalReferences.map((sourceId) => ({
        sourceId,
        scenarioIds,
      })),
      matrix: hasTraceableSource
        ? [
            {
              id: 'QTR-001',
              functionalSourceIds: functionalReferences,
              technicalSourceIds: technicalReferences,
              scenarioIds,
            },
          ]
        : [],
    },
    positiveScenarios,
    negativeScenarios,
    edgeCases,
    risks: [],
    approvalCriteria: hasTraceableSource
      ? [
          {
            id: 'QAPR-001',
            criterion: 'Todos os cenários prioritários devem atender aos resultados esperados.',
            scenarioIds,
          },
        ]
      : [],
    blockingItems: [],
    priorityTests: scenarioIds.map((scenarioId, index) => ({
      id: `QPT-${String(index + 1).padStart(3, '0')}`,
      rank: index + 1,
      scenarioId,
      rationale: 'Ordem canônica baseada na categoria do cenário.',
    })),
    automationRecommendations: hasTraceableSource
      ? [
          {
            id: 'QAUT-001',
            scenarioIds,
            target: 'INTEGRATION',
            priority: 'HIGH',
            rationale: 'Os cenários compilados são estáveis, rastreáveis e repetíveis.',
            prerequisites: ['Implementação e ambiente de testes disponíveis.'],
          },
        ]
      : [],
    assumptions: [],
    openQuestions: [],
    outOfScope: [
      {
        id: 'QOOS-001',
        description: 'Execução de testes, geração de código e chamadas a provedores externos.',
      },
    ],
  };
  const specification = qaSpecificationStructureSchema.parse(candidate) as QASpecification;
  const businessValidation = validateQABusinessRules(
    specification,
    productOwnerSpecification,
    technicalSpecification,
  );

  if (!businessValidation.valid) {
    throw new Error('O compilador canônico produziu uma especificação incompatível.');
  }

  return deepFreeze(specification);
}
