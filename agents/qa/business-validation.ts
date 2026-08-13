import { READINESS_DECISION_VERSION } from '@brq/shared/schemas/readiness-decision.schema';
import type { ReadinessDecision } from '@brq/shared/types/readiness-decision';

import { deepFreeze } from './immutability';

export const QA_BUSINESS_VALIDATION_ISSUE_CODES = {
  INVALID_SPECIFICATION_STRUCTURE: 'QA_INVALID_SPECIFICATION_STRUCTURE',
  DUPLICATE_ID: 'QA_DUPLICATE_ID',
  DUPLICATE_REFERENCE: 'QA_DUPLICATE_REFERENCE',
  UNKNOWN_REFERENCE: 'QA_UNKNOWN_REFERENCE',
  CATEGORY_MISMATCH: 'QA_CATEGORY_MISMATCH',
  INCOMPLETE_TRACEABILITY: 'QA_INCOMPLETE_TRACEABILITY',
  MISSING_ACCEPTANCE_CRITERION_COVERAGE: 'QA_MISSING_ACCEPTANCE_CRITERION_COVERAGE',
  MISSING_BUSINESS_RULE_COVERAGE: 'QA_MISSING_BUSINESS_RULE_COVERAGE',
  MISSING_TECHNICAL_DECISION_COVERAGE: 'QA_MISSING_TECHNICAL_DECISION_COVERAGE',
  MISSING_DEFINITION_OF_DONE_COVERAGE: 'QA_MISSING_DEFINITION_OF_DONE_COVERAGE',
  COVERAGE_SUMMARY_MISMATCH: 'QA_COVERAGE_SUMMARY_MISMATCH',
  INVALID_PRIORITY_ORDER: 'QA_INVALID_PRIORITY_ORDER',
  READINESS_MISMATCH: 'QA_READINESS_MISMATCH',
  INCOMPLETE_SPECIFICATION: 'QA_INCOMPLETE_SPECIFICATION',
} as const;

export const QA_READINESS_VALUES = ['READY', 'PARTIALLY_READY', 'REQUIRES_CLARIFICATION'] as const;

export const QA_BUSINESS_VALIDATION_MAX_ISSUES = 100;

export type QAReadiness = (typeof QA_READINESS_VALUES)[number];
export type QABusinessValidationIssueCode =
  (typeof QA_BUSINESS_VALIDATION_ISSUE_CODES)[keyof typeof QA_BUSINESS_VALIDATION_ISSUE_CODES];

export interface QABusinessValidationIssue {
  readonly code: QABusinessValidationIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export interface QABusinessValidationResult {
  readonly valid: boolean;
  readonly expectedReadiness: QAReadiness | null;
  readonly issues: readonly QABusinessValidationIssue[];
  readonly issuesTruncated: boolean;
}

export interface QASpecificationStructureIssue {
  readonly path: readonly PropertyKey[];
}

interface IdentifiedValue {
  readonly id: string;
}

interface QAQuestion extends IdentifiedValue {
  readonly impact: 'BLOCKING' | 'NON_BLOCKING';
}

interface QAAssumption extends IdentifiedValue {
  readonly requiresValidation: boolean;
}

interface QABlocker extends IdentifiedValue {
  readonly sourceIds: readonly string[];
}

interface QAScenario extends IdentifiedValue {
  readonly functionalReferences: readonly string[];
  readonly technicalReferences: readonly string[];
}

interface QACoverageEntry {
  readonly sourceId: string;
  readonly scenarioIds: readonly string[];
}

export interface QAProductOwnerSpecificationInput {
  readonly readiness: QAReadiness;
  readonly acceptanceCriteria: readonly IdentifiedValue[];
  readonly businessRules: readonly IdentifiedValue[];
}

export interface QATechnicalSpecificationInput {
  readonly readiness: QAReadiness;
  readonly components: readonly IdentifiedValue[];
  readonly modules: readonly IdentifiedValue[];
  readonly flows: readonly IdentifiedValue[];
  readonly contracts: readonly IdentifiedValue[];
  readonly apis: readonly IdentifiedValue[];
  readonly events: readonly IdentifiedValue[];
  readonly dataModel: {
    readonly entities: readonly IdentifiedValue[];
    readonly relations: readonly IdentifiedValue[];
  };
  readonly decisions: readonly IdentifiedValue[];
  readonly definitionOfDone: readonly IdentifiedValue[];
}

export interface QABusinessValidationInput {
  readonly readiness: QAReadiness;
  readonly testStrategy: {
    readonly objectives: readonly string[];
    readonly scope: readonly string[];
    readonly testTypes: readonly string[];
    readonly entryCriteria: readonly string[];
    readonly exitCriteria: readonly string[];
  };
  readonly traceability: {
    readonly summary: {
      readonly acceptanceCriteria: { readonly total: number; readonly covered: number };
      readonly businessRules: { readonly total: number; readonly covered: number };
      readonly technicalDecisions: { readonly total: number; readonly covered: number };
      readonly definitionOfDone: { readonly total: number; readonly covered: number };
    };
    readonly functionalCoverage: readonly QACoverageEntry[];
    readonly technicalCoverage: readonly QACoverageEntry[];
    readonly matrix: readonly (IdentifiedValue & {
      readonly functionalSourceIds: readonly string[];
      readonly technicalSourceIds: readonly string[];
      readonly scenarioIds: readonly string[];
    })[];
  };
  readonly positiveScenarios: readonly QAScenario[];
  readonly negativeScenarios: readonly QAScenario[];
  readonly edgeCases: readonly QAScenario[];
  readonly risks: readonly (IdentifiedValue & { readonly scenarioIds: readonly string[] })[];
  readonly approvalCriteria: readonly (IdentifiedValue & {
    readonly scenarioIds: readonly string[];
  })[];
  readonly blockingItems: readonly QABlocker[];
  readonly priorityTests: readonly (IdentifiedValue & {
    readonly rank: number;
    readonly scenarioId: string;
  })[];
  readonly automationRecommendations: readonly (IdentifiedValue & {
    readonly scenarioIds: readonly string[];
  })[];
  readonly assumptions: readonly QAAssumption[];
  readonly openQuestions: readonly QAQuestion[];
  readonly outOfScope: readonly IdentifiedValue[];
}

type IssueCollector = QABusinessValidationIssue[];

function sanitizedPath(path: readonly PropertyKey[]): readonly (string | number)[] {
  const result: (string | number)[] = [];
  for (const segment of path.slice(0, 32)) {
    if (typeof segment === 'string') result.push(segment);
    if (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0) {
      result.push(segment);
    }
  }
  return result;
}

export function createQABusinessStructureRejection(
  structureIssues: readonly QASpecificationStructureIssue[],
): QABusinessValidationResult {
  const sourceIssues =
    structureIssues.length === 0
      ? [{ path: [] }]
      : structureIssues.slice(0, QA_BUSINESS_VALIDATION_MAX_ISSUES);
  return deepFreeze({
    valid: false,
    expectedReadiness: null,
    issues: sourceIssues.map(({ path }) => ({
      code: QA_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_SPECIFICATION_STRUCTURE,
      path: sanitizedPath(path),
      message: 'A especificação não atende à estrutura de qualidade esperada.',
    })),
    issuesTruncated: structureIssues.length > sourceIssues.length,
  });
}

function addIssue(
  issues: IssueCollector,
  code: QABusinessValidationIssueCode,
  path: readonly (string | number)[],
  message: string,
): void {
  issues.push({ code, path, message });
}

function validateUniqueIds(
  issues: IssueCollector,
  collectionName: string,
  values: readonly IdentifiedValue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_ID,
        [collectionName, index, 'id'],
        'O ID deve ser único dentro da coleção.',
      );
    }
    seen.add(value.id);
  });
}

function validateReferences(
  issues: IssueCollector,
  references: readonly string[],
  knownIds: ReadonlySet<string>,
  path: readonly (string | number)[],
): void {
  const seen = new Set<string>();
  references.forEach((reference, index) => {
    if (seen.has(reference)) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        [...path, index],
        'Uma referência não pode ser repetida na mesma lista.',
      );
    }
    if (!knownIds.has(reference)) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE,
        [...path, index],
        'A referência deve apontar para um ID existente.',
      );
    }
    seen.add(reference);
  });
}

export function explainQAReadiness(
  productOwnerReadiness: QAReadiness,
  technicalReadiness: QAReadiness,
  openQuestions: readonly QAQuestion[],
  assumptions: readonly QAAssumption[],
  blockingItems: readonly QABlocker[],
): ReadinessDecision {
  if (
    productOwnerReadiness === 'REQUIRES_CLARIFICATION' ||
    technicalReadiness === 'REQUIRES_CLARIFICATION' ||
    blockingItems.length > 0 ||
    openQuestions.some((question) => question.impact === 'BLOCKING')
  ) {
    const decisiveFactors: ReadinessDecision['decisiveFactors'][number][] = [];
    if (productOwnerReadiness === 'REQUIRES_CLARIFICATION') {
      decisiveFactors.push({
        sourceStage: 'PRODUCT_OWNER',
        code: 'SOURCE_REQUIRES_CLARIFICATION',
      });
    }
    if (technicalReadiness === 'REQUIRES_CLARIFICATION') {
      decisiveFactors.push({ sourceStage: 'DEVELOPER', code: 'SOURCE_REQUIRES_CLARIFICATION' });
    }
    if (openQuestions.some((question) => question.impact === 'BLOCKING')) {
      decisiveFactors.push({ sourceStage: 'QA', code: 'BLOCKING_QUESTION_PRESENT' });
    }
    if (blockingItems.length > 0) {
      decisiveFactors.push({ sourceStage: 'QA', code: 'BLOCKING_ITEM_PRESENT' });
    }
    return deepFreeze({
      version: READINESS_DECISION_VERSION,
      readiness: 'REQUIRES_CLARIFICATION',
      decisiveFactors,
    });
  }

  const decisiveFactors: ReadinessDecision['decisiveFactors'][number][] = [];
  if (productOwnerReadiness === 'PARTIALLY_READY') {
    decisiveFactors.push({
      sourceStage: 'PRODUCT_OWNER',
      code: 'SOURCE_PARTIALLY_READY',
    });
  }
  if (technicalReadiness === 'PARTIALLY_READY') {
    decisiveFactors.push({ sourceStage: 'DEVELOPER', code: 'SOURCE_PARTIALLY_READY' });
  }
  if (openQuestions.length > 0) {
    decisiveFactors.push({ sourceStage: 'QA', code: 'NON_BLOCKING_QUESTION_PRESENT' });
  }
  if (assumptions.some((assumption) => assumption.requiresValidation)) {
    decisiveFactors.push({
      sourceStage: 'QA',
      code: 'VALIDATION_REQUIRED_ASSUMPTION_PRESENT',
    });
  }

  return deepFreeze(
    decisiveFactors.length > 0
      ? {
          version: READINESS_DECISION_VERSION,
          readiness: 'PARTIALLY_READY',
          decisiveFactors,
        }
      : {
          version: READINESS_DECISION_VERSION,
          readiness: 'READY',
          decisiveFactors: [
            { sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_READY' },
            { sourceStage: 'DEVELOPER', code: 'SOURCE_READY' },
            { sourceStage: 'QA', code: 'NO_LOCAL_READINESS_CONCERNS' },
          ],
        },
  );
}

export function deriveQAReadiness(
  productOwnerReadiness: QAReadiness,
  technicalReadiness: QAReadiness,
  openQuestions: readonly QAQuestion[],
  assumptions: readonly QAAssumption[],
  blockingItems: readonly QABlocker[],
): QAReadiness {
  return explainQAReadiness(
    productOwnerReadiness,
    technicalReadiness,
    openQuestions,
    assumptions,
    blockingItems,
  ).readiness;
}

function coveredSourceIds(
  scenarios: readonly QAScenario[],
  field: 'functionalReferences' | 'technicalReferences',
): Set<string> {
  return new Set(scenarios.flatMap((scenario) => scenario[field]));
}

function validateRequiredCoverage(
  issues: IssueCollector,
  sourceIds: ReadonlySet<string>,
  scenarioCoverage: ReadonlySet<string>,
  mappedCoverage: ReadonlySet<string>,
  matrixCoverage: ReadonlySet<string>,
  code: QABusinessValidationIssueCode,
  path: readonly (string | number)[],
): void {
  for (const sourceId of sourceIds) {
    if (
      !scenarioCoverage.has(sourceId) ||
      !mappedCoverage.has(sourceId) ||
      !matrixCoverage.has(sourceId)
    ) {
      addIssue(issues, code, path, 'A fonte deve possuir cenário, cobertura e rastreabilidade.');
    }
  }
}

function validateCompleteness(
  specification: QABusinessValidationInput,
  readiness: QAReadiness,
  issues: IssueCollector,
): void {
  if (readiness === 'REQUIRES_CLARIFICATION') return;
  const requirements: readonly [boolean, readonly (string | number)[]][] = [
    [specification.testStrategy.objectives.length > 0, ['testStrategy', 'objectives']],
    [specification.testStrategy.scope.length > 0, ['testStrategy', 'scope']],
    [specification.testStrategy.testTypes.length > 0, ['testStrategy', 'testTypes']],
    [specification.testStrategy.entryCriteria.length > 0, ['testStrategy', 'entryCriteria']],
    [specification.testStrategy.exitCriteria.length > 0, ['testStrategy', 'exitCriteria']],
    [specification.positiveScenarios.length > 0, ['positiveScenarios']],
    [specification.negativeScenarios.length > 0, ['negativeScenarios']],
    [specification.edgeCases.length > 0, ['edgeCases']],
    [specification.approvalCriteria.length > 0, ['approvalCriteria']],
    [specification.priorityTests.length > 0, ['priorityTests']],
    [specification.automationRecommendations.length > 0, ['automationRecommendations']],
  ];
  for (const [satisfied, path] of requirements) {
    if (!satisfied) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_SPECIFICATION,
        path,
        'READY e PARTIALLY_READY exigem os elementos mínimos de qualidade.',
      );
    }
  }
}

function validateCoverageEntryConsistency(
  issues: IssueCollector,
  entries: readonly QACoverageEntry[],
  scenariosById: ReadonlyMap<string, QAScenario>,
  sourceField: 'functionalReferences' | 'technicalReferences',
  path: 'functionalCoverage' | 'technicalCoverage',
): void {
  entries.forEach((entry, index) => {
    entry.scenarioIds.forEach((scenarioId) => {
      const scenario = scenariosById.get(scenarioId);
      if (scenario !== undefined && !scenario[sourceField].includes(entry.sourceId)) {
        addIssue(
          issues,
          QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH,
          ['traceability', path, index, 'scenarioIds'],
          'O cenário deve declarar a fonte associada pelo mapa de cobertura.',
        );
      }
    });
  });
}

export function validateQABusinessRules(
  specification: QABusinessValidationInput,
  productOwnerSpecification: QAProductOwnerSpecificationInput,
  technicalSpecification: QATechnicalSpecificationInput,
): QABusinessValidationResult {
  const issues: IssueCollector = [];
  const scenarios = [
    ...specification.positiveScenarios,
    ...specification.negativeScenarios,
    ...specification.edgeCases,
  ];
  const scenarioIds = new Set(scenarios.map(({ id }) => id));
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const acceptanceCriteriaIds = new Set(
    productOwnerSpecification.acceptanceCriteria.map(({ id }) => id),
  );
  const businessRuleIds = new Set(productOwnerSpecification.businessRules.map(({ id }) => id));
  const functionalIds = new Set([...acceptanceCriteriaIds, ...businessRuleIds]);
  const decisionIds = new Set(technicalSpecification.decisions.map(({ id }) => id));
  const definitionOfDoneIds = new Set(technicalSpecification.definitionOfDone.map(({ id }) => id));
  const technicalIds = new Set([
    ...technicalSpecification.components.map(({ id }) => id),
    ...technicalSpecification.modules.map(({ id }) => id),
    ...technicalSpecification.flows.map(({ id }) => id),
    ...technicalSpecification.contracts.map(({ id }) => id),
    ...technicalSpecification.apis.map(({ id }) => id),
    ...technicalSpecification.events.map(({ id }) => id),
    ...technicalSpecification.dataModel.entities.map(({ id }) => id),
    ...technicalSpecification.dataModel.relations.map(({ id }) => id),
    ...decisionIds,
    ...definitionOfDoneIds,
  ]);
  const allSourceIds = new Set([...functionalIds, ...technicalIds]);

  const identifiedCollections: readonly [string, readonly IdentifiedValue[]][] = [
    ['positiveScenarios', specification.positiveScenarios],
    ['negativeScenarios', specification.negativeScenarios],
    ['edgeCases', specification.edgeCases],
    ['traceability.matrix', specification.traceability.matrix],
    ['risks', specification.risks],
    ['approvalCriteria', specification.approvalCriteria],
    ['blockingItems', specification.blockingItems],
    ['priorityTests', specification.priorityTests],
    ['automationRecommendations', specification.automationRecommendations],
    ['assumptions', specification.assumptions],
    ['openQuestions', specification.openQuestions],
    ['outOfScope', specification.outOfScope],
  ];
  identifiedCollections.forEach(([name, values]) => validateUniqueIds(issues, name, values));
  if (scenarioIds.size !== scenarios.length) {
    addIssue(
      issues,
      QA_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_ID,
      ['positiveScenarios'],
      'IDs de cenários devem ser únicos entre as três categorias.',
    );
  }

  scenarios.forEach((scenario, index) => {
    const collection = scenario.id.startsWith('QAP-')
      ? 'positiveScenarios'
      : scenario.id.startsWith('QAN-')
        ? 'negativeScenarios'
        : 'edgeCases';
    validateReferences(issues, scenario.functionalReferences, functionalIds, [
      collection,
      index,
      'functionalReferences',
    ]);
    validateReferences(issues, scenario.technicalReferences, technicalIds, [
      collection,
      index,
      'technicalReferences',
    ]);
    if (scenario.functionalReferences.length + scenario.technicalReferences.length === 0) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_TRACEABILITY,
        [collection, index],
        'Todo cenário deve referenciar pelo menos uma fonte funcional ou técnica.',
      );
    }
  });

  const functionalCoverageIds = new Set<string>();
  specification.traceability.functionalCoverage.forEach((entry, index) => {
    validateReferences(issues, [entry.sourceId], functionalIds, [
      'traceability',
      'functionalCoverage',
      index,
      'sourceId',
    ]);
    validateReferences(issues, entry.scenarioIds, scenarioIds, [
      'traceability',
      'functionalCoverage',
      index,
      'scenarioIds',
    ]);
    if (functionalCoverageIds.has(entry.sourceId)) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        ['traceability', 'functionalCoverage', index, 'sourceId'],
        'Cada fonte deve possuir um único mapa de cobertura.',
      );
    }
    if (entry.scenarioIds.length > 0) functionalCoverageIds.add(entry.sourceId);
  });

  const technicalCoverageIds = new Set<string>();
  specification.traceability.technicalCoverage.forEach((entry, index) => {
    validateReferences(issues, [entry.sourceId], technicalIds, [
      'traceability',
      'technicalCoverage',
      index,
      'sourceId',
    ]);
    validateReferences(issues, entry.scenarioIds, scenarioIds, [
      'traceability',
      'technicalCoverage',
      index,
      'scenarioIds',
    ]);
    if (technicalCoverageIds.has(entry.sourceId)) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        ['traceability', 'technicalCoverage', index, 'sourceId'],
        'Cada fonte deve possuir um único mapa de cobertura.',
      );
    }
    if (entry.scenarioIds.length > 0) technicalCoverageIds.add(entry.sourceId);
  });

  validateCoverageEntryConsistency(
    issues,
    specification.traceability.functionalCoverage,
    scenariosById,
    'functionalReferences',
    'functionalCoverage',
  );
  validateCoverageEntryConsistency(
    issues,
    specification.traceability.technicalCoverage,
    scenariosById,
    'technicalReferences',
    'technicalCoverage',
  );

  const matrixFunctionalIds = new Set<string>();
  const matrixTechnicalIds = new Set<string>();
  specification.traceability.matrix.forEach((row, index) => {
    validateReferences(issues, row.functionalSourceIds, functionalIds, [
      'traceability',
      'matrix',
      index,
      'functionalSourceIds',
    ]);
    validateReferences(issues, row.technicalSourceIds, technicalIds, [
      'traceability',
      'matrix',
      index,
      'technicalSourceIds',
    ]);
    validateReferences(issues, row.scenarioIds, scenarioIds, [
      'traceability',
      'matrix',
      index,
      'scenarioIds',
    ]);
    if (
      row.functionalSourceIds.length + row.technicalSourceIds.length === 0 ||
      row.scenarioIds.length === 0
    ) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_TRACEABILITY,
        ['traceability', 'matrix', index],
        'Uma linha deve relacionar fontes a pelo menos um cenário.',
      );
    }
    for (const scenarioId of row.scenarioIds) {
      const scenario = scenariosById.get(scenarioId);
      if (
        scenario !== undefined &&
        !row.functionalSourceIds.some((id) => scenario.functionalReferences.includes(id)) &&
        !row.technicalSourceIds.some((id) => scenario.technicalReferences.includes(id))
      ) {
        addIssue(
          issues,
          QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH,
          ['traceability', 'matrix', index, 'scenarioIds'],
          'Cada cenário da linha deve declarar ao menos uma das fontes relacionadas.',
        );
      }
    }
    row.functionalSourceIds.forEach((id) => matrixFunctionalIds.add(id));
    row.technicalSourceIds.forEach((id) => matrixTechnicalIds.add(id));
  });

  const scenarioFunctionalIds = coveredSourceIds(scenarios, 'functionalReferences');
  const scenarioTechnicalIds = coveredSourceIds(scenarios, 'technicalReferences');
  validateRequiredCoverage(
    issues,
    acceptanceCriteriaIds,
    scenarioFunctionalIds,
    functionalCoverageIds,
    matrixFunctionalIds,
    QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_ACCEPTANCE_CRITERION_COVERAGE,
    ['traceability', 'functionalCoverage'],
  );
  validateRequiredCoverage(
    issues,
    businessRuleIds,
    scenarioFunctionalIds,
    functionalCoverageIds,
    matrixFunctionalIds,
    QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_BUSINESS_RULE_COVERAGE,
    ['traceability', 'functionalCoverage'],
  );
  validateRequiredCoverage(
    issues,
    decisionIds,
    scenarioTechnicalIds,
    technicalCoverageIds,
    matrixTechnicalIds,
    QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_TECHNICAL_DECISION_COVERAGE,
    ['traceability', 'technicalCoverage'],
  );
  validateRequiredCoverage(
    issues,
    definitionOfDoneIds,
    scenarioTechnicalIds,
    technicalCoverageIds,
    matrixTechnicalIds,
    QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_DEFINITION_OF_DONE_COVERAGE,
    ['traceability', 'technicalCoverage'],
  );

  const expectedSummary = {
    acceptanceCriteria: {
      total: acceptanceCriteriaIds.size,
      covered: [...acceptanceCriteriaIds].filter(
        (id) =>
          scenarioFunctionalIds.has(id) &&
          functionalCoverageIds.has(id) &&
          matrixFunctionalIds.has(id),
      ).length,
    },
    businessRules: {
      total: businessRuleIds.size,
      covered: [...businessRuleIds].filter(
        (id) =>
          scenarioFunctionalIds.has(id) &&
          functionalCoverageIds.has(id) &&
          matrixFunctionalIds.has(id),
      ).length,
    },
    technicalDecisions: {
      total: decisionIds.size,
      covered: [...decisionIds].filter(
        (id) =>
          scenarioTechnicalIds.has(id) &&
          technicalCoverageIds.has(id) &&
          matrixTechnicalIds.has(id),
      ).length,
    },
    definitionOfDone: {
      total: definitionOfDoneIds.size,
      covered: [...definitionOfDoneIds].filter(
        (id) =>
          scenarioTechnicalIds.has(id) &&
          technicalCoverageIds.has(id) &&
          matrixTechnicalIds.has(id),
      ).length,
    },
  };
  for (const key of Object.keys(expectedSummary) as (keyof typeof expectedSummary)[]) {
    const actual = specification.traceability.summary[key];
    const expected = expectedSummary[key];
    if (actual.total !== expected.total || actual.covered !== expected.covered) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.COVERAGE_SUMMARY_MISMATCH,
        ['traceability', 'summary', key],
        'Os totais devem ser derivados das fontes e da cobertura efetiva.',
      );
    }
  }

  const prioritizedScenarioIds = new Set<string>();
  specification.priorityTests.forEach((item, index) => {
    if (item.rank !== index + 1) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_PRIORITY_ORDER,
        ['priorityTests', index, 'rank'],
        'O ranking deve ser único e contíguo, iniciando em 1.',
      );
    }
    validateReferences(issues, [item.scenarioId], scenarioIds, [
      'priorityTests',
      index,
      'scenarioId',
    ]);
    if (prioritizedScenarioIds.has(item.scenarioId)) {
      addIssue(
        issues,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        ['priorityTests', index, 'scenarioId'],
        'Um cenário deve aparecer uma única vez no ranking prioritário.',
      );
    }
    prioritizedScenarioIds.add(item.scenarioId);
  });
  specification.risks.forEach((item, index) =>
    validateReferences(issues, item.scenarioIds, scenarioIds, ['risks', index, 'scenarioIds']),
  );
  specification.approvalCriteria.forEach((item, index) =>
    validateReferences(issues, item.scenarioIds, scenarioIds, [
      'approvalCriteria',
      index,
      'scenarioIds',
    ]),
  );
  specification.automationRecommendations.forEach((item, index) =>
    validateReferences(issues, item.scenarioIds, scenarioIds, [
      'automationRecommendations',
      index,
      'scenarioIds',
    ]),
  );
  specification.blockingItems.forEach((item, index) =>
    validateReferences(issues, item.sourceIds, allSourceIds, ['blockingItems', index, 'sourceIds']),
  );

  const expectedReadiness = deriveQAReadiness(
    productOwnerSpecification.readiness,
    technicalSpecification.readiness,
    specification.openQuestions,
    specification.assumptions,
    specification.blockingItems,
  );
  if (specification.readiness !== expectedReadiness) {
    addIssue(
      issues,
      QA_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH,
      ['readiness'],
      'readiness deve ser derivada das duas fontes, bloqueios, dúvidas e premissas.',
    );
  }
  validateCompleteness(specification, expectedReadiness, issues);

  const visibleIssues = issues.slice(0, QA_BUSINESS_VALIDATION_MAX_ISSUES);
  return deepFreeze({
    valid: issues.length === 0,
    expectedReadiness,
    issues: visibleIssues,
    issuesTruncated: issues.length > visibleIssues.length,
  });
}
