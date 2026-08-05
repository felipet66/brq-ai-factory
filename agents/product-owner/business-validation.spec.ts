import { describe, expect, it } from 'vitest';

import {
  createProductOwnerBusinessStructureRejection,
  deriveProductOwnerReadiness,
  PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES,
  type ProductOwnerBusinessValidationInput,
  validateProductOwnerBusinessRules,
} from './business-validation';

function validSpecification(
  overrides: Partial<ProductOwnerBusinessValidationInput> = {},
): ProductOwnerBusinessValidationInput {
  return {
    readiness: 'READY',
    userStory: { asA: 'Pessoa', iWant: 'obter valor', soThat: 'atinja um objetivo' },
    acceptanceCriteria: [{ id: 'AC-001' }],
    businessRules: [{ id: 'BR-001' }],
    scenarios: [{ id: 'SCN-001', type: 'MAIN', acceptanceCriteriaIds: ['AC-001'] }],
    assumptions: [{ id: 'ASM-001', requiresValidation: false }],
    dependencies: [{ id: 'DEP-001' }],
    risks: [{ id: 'RSK-001' }],
    openQuestions: [],
    outOfScope: [{ id: 'OOS-001' }],
    definitionOfReady: [{ id: 'DOR-001' }],
    backlogItems: [
      {
        id: 'BL-001',
        dependencyIds: ['DEP-001'],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    ...overrides,
  };
}

describe('Product Owner Business Validation', () => {
  it('derives readiness from blocking questions and assumptions requiring validation', () => {
    expect(deriveProductOwnerReadiness([])).toBe('READY');
    expect(deriveProductOwnerReadiness([{ id: 'Q-001', impact: 'NON_BLOCKING' }])).toBe(
      'PARTIALLY_READY',
    );
    expect(deriveProductOwnerReadiness([], [{ id: 'ASM-001', requiresValidation: true }])).toBe(
      'PARTIALLY_READY',
    );
    expect(
      deriveProductOwnerReadiness(
        [
          { id: 'Q-001', impact: 'NON_BLOCKING' },
          { id: 'Q-002', impact: 'BLOCKING' },
        ],
        [{ id: 'ASM-001', requiresValidation: true }],
      ),
    ).toBe('REQUIRES_CLARIFICATION');
  });

  it('accepts and deeply freezes a complete READY specification report', () => {
    const result = validateProductOwnerBusinessRules(validSpecification());

    expect(result).toEqual({
      valid: true,
      expectedReadiness: 'READY',
      issues: [],
      issuesTruncated: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
  });

  it('accepts incomplete content only when a blocking question requires clarification', () => {
    const result = validateProductOwnerBusinessRules(
      validSpecification({
        readiness: 'REQUIRES_CLARIFICATION',
        userStory: null,
        acceptanceCriteria: [],
        scenarios: [],
        definitionOfReady: [],
        backlogItems: [],
        openQuestions: [{ id: 'Q-001', impact: 'BLOCKING' }],
      }),
    );

    expect(result).toEqual({
      valid: true,
      expectedReadiness: 'REQUIRES_CLARIFICATION',
      issues: [],
      issuesTruncated: false,
    });
  });

  it('rejects readiness that diverges from the deterministic derivation', () => {
    const result = validateProductOwnerBusinessRules(
      validSpecification({
        readiness: 'READY',
        openQuestions: [{ id: 'Q-001', impact: 'NON_BLOCKING' }],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.expectedReadiness).toBe('PARTIALLY_READY');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH,
        path: ['readiness'],
      }),
    );
  });

  it('requires minimum functional content for READY and PARTIALLY_READY', () => {
    const result = validateProductOwnerBusinessRules(
      validSpecification({
        readiness: 'PARTIALLY_READY',
        userStory: null,
        acceptanceCriteria: [],
        scenarios: [],
        definitionOfReady: [],
        backlogItems: [],
        openQuestions: [{ id: 'Q-001', impact: 'NON_BLOCKING' }],
      }),
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.filter(
        (issue) =>
          issue.code === PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_SPECIFICATION,
      ),
    ).toHaveLength(5);
  });

  it('detects duplicate IDs, duplicate references and unknown cross-references', () => {
    const result = validateProductOwnerBusinessRules(
      validSpecification({
        acceptanceCriteria: [{ id: 'AC-001' }, { id: 'AC-001' }],
        scenarios: [
          {
            id: 'SCN-001',
            type: 'MAIN',
            acceptanceCriteriaIds: ['AC-999', 'AC-999'],
          },
        ],
        backlogItems: [
          {
            id: 'BL-001',
            dependencyIds: ['DEP-999'],
            acceptanceCriteriaIds: ['AC-999'],
          },
        ],
      }),
    );
    const codes = result.issues.map((issue) => issue.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_ID,
        PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_ACCEPTANCE_CRITERION_REFERENCE,
        PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_DEPENDENCY_REFERENCE,
      ]),
    );
  });

  it('does not mutate the specification while validating it', () => {
    const specification = validSpecification();
    const snapshot = structuredClone(specification);

    validateProductOwnerBusinessRules(specification);

    expect(specification).toEqual(snapshot);
    expect(Object.isFrozen(specification)).toBe(false);
  });

  it('maps structural parser issues to sanitized Business Validation issues', () => {
    const result = createProductOwnerBusinessStructureRejection([
      { path: ['acceptanceCriteria', 3, 'id'] },
      { path: ['unknown', Symbol('not-public')] },
    ]);

    expect(result).toEqual({
      valid: false,
      expectedReadiness: null,
      issues: [
        {
          code: PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_SPECIFICATION_STRUCTURE,
          path: ['acceptanceCriteria', 3, 'id'],
          message: 'A especificação não atende à estrutura funcional esperada.',
        },
        {
          code: PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_SPECIFICATION_STRUCTURE,
          path: ['unknown'],
          message: 'A especificação não atende à estrutura funcional esperada.',
        },
      ],
      issuesTruncated: false,
    });
    expect(Object.isFrozen(result.issues)).toBe(true);
  });

  it('limits issues deterministically and reports truncation', () => {
    const unknownReferences = Array.from(
      { length: 120 },
      (_, index) => `AC-${String(index + 100).padStart(3, '0')}`,
    );
    const result = validateProductOwnerBusinessRules(
      validSpecification({
        scenarios: [
          {
            id: 'SCN-001',
            type: 'MAIN',
            acceptanceCriteriaIds: unknownReferences,
          },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(100);
    expect(result.issuesTruncated).toBe(true);
    expect(result.issues[0]?.path).toEqual(['scenarios', 0, 'acceptanceCriteriaIds', 0]);
    expect(result.issues[99]?.path).toEqual(['scenarios', 0, 'acceptanceCriteriaIds', 99]);
  });
});
