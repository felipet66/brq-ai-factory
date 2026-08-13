import { READINESS_DECISION_VERSION } from '@brq/shared/schemas/readiness-decision.schema';
import type { ReadinessDecision } from '@brq/shared/types/readiness-decision';

import { deepFreeze } from './immutability';

export const PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES = {
  DUPLICATE_ID: 'PRODUCT_OWNER_DUPLICATE_ID',
  DUPLICATE_REFERENCE: 'PRODUCT_OWNER_DUPLICATE_REFERENCE',
  UNKNOWN_ACCEPTANCE_CRITERION_REFERENCE: 'PRODUCT_OWNER_UNKNOWN_ACCEPTANCE_CRITERION_REFERENCE',
  UNKNOWN_DEPENDENCY_REFERENCE: 'PRODUCT_OWNER_UNKNOWN_DEPENDENCY_REFERENCE',
  INVALID_SPECIFICATION_STRUCTURE: 'PRODUCT_OWNER_INVALID_SPECIFICATION_STRUCTURE',
  READINESS_MISMATCH: 'PRODUCT_OWNER_READINESS_MISMATCH',
  INCOMPLETE_SPECIFICATION: 'PRODUCT_OWNER_INCOMPLETE_SPECIFICATION',
} as const;

export const PRODUCT_OWNER_READINESS_VALUES = [
  'READY',
  'PARTIALLY_READY',
  'REQUIRES_CLARIFICATION',
] as const;

export type ProductOwnerReadiness = (typeof PRODUCT_OWNER_READINESS_VALUES)[number];
export type ProductOwnerBusinessValidationIssueCode =
  (typeof PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES)[keyof typeof PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES];

export interface ProductOwnerBusinessValidationIssue {
  readonly code: ProductOwnerBusinessValidationIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export interface ProductOwnerBusinessValidationResult {
  readonly valid: boolean;
  readonly expectedReadiness: ProductOwnerReadiness | null;
  readonly issues: readonly ProductOwnerBusinessValidationIssue[];
  readonly issuesTruncated: boolean;
}

export const PRODUCT_OWNER_BUSINESS_VALIDATION_MAX_ISSUES = 100;

export interface ProductOwnerSpecificationStructureIssue {
  readonly path: readonly PropertyKey[];
}

interface IdentifiedValue {
  readonly id: string;
}

export interface ProductOwnerBusinessValidationInput {
  readonly readiness: ProductOwnerReadiness;
  readonly userStory: object | null;
  readonly acceptanceCriteria: readonly IdentifiedValue[];
  readonly businessRules: readonly IdentifiedValue[];
  readonly scenarios: readonly (IdentifiedValue & {
    readonly type: 'MAIN' | 'ALTERNATIVE' | 'ERROR';
    readonly acceptanceCriteriaIds: readonly string[];
  })[];
  readonly assumptions: readonly (IdentifiedValue & {
    readonly requiresValidation: boolean;
  })[];
  readonly dependencies: readonly IdentifiedValue[];
  readonly risks: readonly IdentifiedValue[];
  readonly openQuestions: readonly (IdentifiedValue & {
    readonly impact: 'BLOCKING' | 'NON_BLOCKING';
  })[];
  readonly outOfScope: readonly IdentifiedValue[];
  readonly definitionOfReady: readonly IdentifiedValue[];
  readonly backlogItems: readonly (IdentifiedValue & {
    readonly dependencyIds: readonly string[];
    readonly acceptanceCriteriaIds: readonly string[];
  })[];
}

type IssueCollector = ProductOwnerBusinessValidationIssue[];

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

export function createProductOwnerBusinessStructureRejection(
  structureIssues: readonly ProductOwnerSpecificationStructureIssue[],
): ProductOwnerBusinessValidationResult {
  const sourceIssues =
    structureIssues.length === 0
      ? [{ path: [] }]
      : structureIssues.slice(0, PRODUCT_OWNER_BUSINESS_VALIDATION_MAX_ISSUES);
  const issues = sourceIssues.map(({ path }) => ({
    code: PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_SPECIFICATION_STRUCTURE,
    path: sanitizedPath(path),
    message: 'A especificação não atende à estrutura funcional esperada.',
  }));

  return deepFreeze({
    valid: false,
    expectedReadiness: null,
    issues,
    issuesTruncated: structureIssues.length > sourceIssues.length,
  });
}

function addIssue(
  issues: IssueCollector,
  code: ProductOwnerBusinessValidationIssueCode,
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
        PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_ID,
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
  unknownCode:
    | typeof PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_ACCEPTANCE_CRITERION_REFERENCE
    | typeof PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_DEPENDENCY_REFERENCE,
): void {
  const seen = new Set<string>();

  references.forEach((reference, index) => {
    if (seen.has(reference)) {
      addIssue(
        issues,
        PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        [...path, index],
        'Uma referência não pode ser repetida na mesma lista.',
      );
    }
    if (!knownIds.has(reference)) {
      addIssue(
        issues,
        unknownCode,
        [...path, index],
        'A referência deve apontar para um ID existente.',
      );
    }
    seen.add(reference);
  });
}

export function explainProductOwnerReadiness(
  openQuestions: ProductOwnerBusinessValidationInput['openQuestions'],
  assumptions: ProductOwnerBusinessValidationInput['assumptions'] = [],
): ReadinessDecision {
  if (openQuestions.some((question) => question.impact === 'BLOCKING')) {
    return deepFreeze({
      version: READINESS_DECISION_VERSION,
      readiness: 'REQUIRES_CLARIFICATION',
      decisiveFactors: [{ sourceStage: 'PRODUCT_OWNER', code: 'BLOCKING_QUESTION_PRESENT' }],
    });
  }

  const decisiveFactors: ReadinessDecision['decisiveFactors'][number][] = [];
  if (openQuestions.length > 0) {
    decisiveFactors.push({
      sourceStage: 'PRODUCT_OWNER',
      code: 'NON_BLOCKING_QUESTION_PRESENT',
    });
  }
  if (assumptions.some((assumption) => assumption.requiresValidation)) {
    decisiveFactors.push({
      sourceStage: 'PRODUCT_OWNER',
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
          decisiveFactors: [{ sourceStage: 'PRODUCT_OWNER', code: 'NO_LOCAL_READINESS_CONCERNS' }],
        },
  );
}

export function deriveProductOwnerReadiness(
  openQuestions: ProductOwnerBusinessValidationInput['openQuestions'],
  assumptions: ProductOwnerBusinessValidationInput['assumptions'] = [],
): ProductOwnerReadiness {
  return explainProductOwnerReadiness(openQuestions, assumptions).readiness;
}

function validateCompleteness(
  specification: ProductOwnerBusinessValidationInput,
  expectedReadiness: ProductOwnerReadiness,
  issues: IssueCollector,
): void {
  if (expectedReadiness === 'REQUIRES_CLARIFICATION') return;

  const requirements: readonly [boolean, readonly (string | number)[]][] = [
    [specification.userStory !== null, ['userStory']],
    [specification.acceptanceCriteria.length > 0, ['acceptanceCriteria']],
    [specification.scenarios.some((scenario) => scenario.type === 'MAIN'), ['scenarios']],
    [specification.definitionOfReady.length > 0, ['definitionOfReady']],
    [specification.backlogItems.length > 0, ['backlogItems']],
  ];

  for (const [satisfied, path] of requirements) {
    if (!satisfied) {
      addIssue(
        issues,
        PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_SPECIFICATION,
        path,
        'READY e PARTIALLY_READY exigem os elementos funcionais mínimos.',
      );
    }
  }
}

export function validateProductOwnerBusinessRules(
  specification: ProductOwnerBusinessValidationInput,
): ProductOwnerBusinessValidationResult {
  const issues: ProductOwnerBusinessValidationIssue[] = [];
  const collections: readonly [string, readonly IdentifiedValue[]][] = [
    ['acceptanceCriteria', specification.acceptanceCriteria],
    ['businessRules', specification.businessRules],
    ['scenarios', specification.scenarios],
    ['assumptions', specification.assumptions],
    ['dependencies', specification.dependencies],
    ['risks', specification.risks],
    ['openQuestions', specification.openQuestions],
    ['outOfScope', specification.outOfScope],
    ['definitionOfReady', specification.definitionOfReady],
    ['backlogItems', specification.backlogItems],
  ];

  for (const [name, values] of collections) validateUniqueIds(issues, name, values);

  const acceptanceCriterionIds = new Set(
    specification.acceptanceCriteria.map((criterion) => criterion.id),
  );
  const dependencyIds = new Set(specification.dependencies.map((dependency) => dependency.id));

  specification.scenarios.forEach((scenario, index) => {
    validateReferences(
      issues,
      scenario.acceptanceCriteriaIds,
      acceptanceCriterionIds,
      ['scenarios', index, 'acceptanceCriteriaIds'],
      PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_ACCEPTANCE_CRITERION_REFERENCE,
    );
  });

  specification.backlogItems.forEach((item, index) => {
    validateReferences(
      issues,
      item.acceptanceCriteriaIds,
      acceptanceCriterionIds,
      ['backlogItems', index, 'acceptanceCriteriaIds'],
      PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_ACCEPTANCE_CRITERION_REFERENCE,
    );
    validateReferences(
      issues,
      item.dependencyIds,
      dependencyIds,
      ['backlogItems', index, 'dependencyIds'],
      PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_DEPENDENCY_REFERENCE,
    );
  });

  const expectedReadiness = deriveProductOwnerReadiness(
    specification.openQuestions,
    specification.assumptions,
  );
  if (specification.readiness !== expectedReadiness) {
    addIssue(
      issues,
      PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH,
      ['readiness'],
      'readiness deve corresponder deterministicamente às dúvidas e premissas pendentes.',
    );
  }

  validateCompleteness(specification, expectedReadiness, issues);

  const boundedIssues = issues.slice(0, PRODUCT_OWNER_BUSINESS_VALIDATION_MAX_ISSUES);

  return deepFreeze({
    valid: boundedIssues.length === 0,
    expectedReadiness,
    issues: boundedIssues,
    issuesTruncated: issues.length > boundedIssues.length,
  });
}
