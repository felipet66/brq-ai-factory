import {
  productOwnerSpecificationSchema,
  type ProductOwnerSpecification,
} from '@brq/product-owner-agent';
import { describe, expect, it } from 'vitest';

import {
  createDeveloperBusinessStructureRejection,
  deriveDeveloperReadiness,
  DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES,
  type DeveloperBusinessValidationInput,
  validateDeveloperBusinessRules,
} from './business-validation';

function sourceSpecification(overrides: Record<string, unknown> = {}): ProductOwnerSpecification {
  return productOwnerSpecificationSchema.parse({
    readiness: 'READY',
    title: 'Demanda funcional',
    summary: 'Resumo funcional.',
    objective: 'Entregar comportamento verificável.',
    context: 'Contexto funcional conhecido.',
    userStory: { asA: 'pessoa', iWant: 'agir', soThat: 'obtenha valor' },
    acceptanceCriteria: [
      { id: 'AC-001', given: 'um estado', when: 'uma ação', then: 'um resultado' },
    ],
    businessRules: [
      {
        id: 'BR-001',
        description: 'Regra conhecida.',
        source: null,
        condition: null,
        impact: 'LOW',
      },
    ],
    scenarios: [
      {
        id: 'SCN-001',
        title: 'Fluxo principal',
        type: 'MAIN',
        given: ['um estado'],
        when: ['uma ação'],
        then: ['um resultado'],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    assumptions: [],
    dependencies: [],
    risks: [],
    openQuestions: [],
    outOfScope: [],
    definitionOfReady: [{ id: 'DOR-001', criterion: 'Especificação revisada.' }],
    backlogItems: [
      {
        id: 'BL-001',
        title: 'Entregar valor',
        description: 'Implementar o fluxo funcional.',
        priority: 'HIGH',
        dependencyIds: [],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    ...overrides,
  }) as ProductOwnerSpecification;
}

function validSpecification(
  overrides: Partial<DeveloperBusinessValidationInput> = {},
): DeveloperBusinessValidationInput {
  return {
    readiness: 'READY',
    architecture: {},
    components: [{ id: 'CMP-001', moduleIds: ['MOD-001'], dependsOnComponentIds: [] }],
    modules: [
      {
        id: 'MOD-001',
        path: 'core/example',
        componentId: 'CMP-001',
        dependsOnModuleIds: [],
      },
    ],
    flows: [
      {
        id: 'FLW-001',
        steps: [{ order: 1, componentId: 'CMP-001', moduleId: 'MOD-001' }],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    contracts: [{ id: 'CTR-001', ownerComponentId: 'CMP-001', consumerComponentIds: [] }],
    apis: [
      {
        id: 'API-001',
        componentId: 'CMP-001',
        requestContractId: 'CTR-001',
        responseContractId: 'CTR-001',
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    events: [
      {
        id: 'EVT-001',
        producerComponentId: 'CMP-001',
        consumerComponentIds: [],
        payloadContractId: 'CTR-001',
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    dataModel: { changesRequired: false, migrationRequired: false, entities: [], relations: [] },
    internalDependencies: [{ id: 'IDEP-001', componentId: 'CMP-001' }],
    externalDependencies: [{ id: 'EDEP-001', componentId: 'CMP-001' }],
    risks: [{ id: 'TRSK-001', componentIds: ['CMP-001'] }],
    implementationPhases: [{ id: 'PH-001', order: 1, dependsOnPhaseIds: [] }],
    implementationPlan: [
      {
        id: 'PLAN-001',
        order: 1,
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
        implementationPlanIds: ['PLAN-001'],
        dependsOnBacklogItemIds: [],
        acceptanceCriteriaIds: ['AC-001'],
      },
    ],
    definitionOfDone: [{ id: 'DOD-001', acceptanceCriteriaIds: ['AC-001'] }],
    decisions: [{ id: 'DEC-001', componentIds: ['CMP-001'], moduleIds: ['MOD-001'] }],
    traceability: [
      {
        id: 'TRC-001',
        sourceIds: ['AC-001', 'BR-001', 'BL-001'],
        componentIds: ['CMP-001'],
        moduleIds: ['MOD-001'],
        flowIds: ['FLW-001'],
        contractIds: ['CTR-001'],
        apiIds: ['API-001'],
        eventIds: ['EVT-001'],
        implementationPlanIds: ['PLAN-001'],
        technicalBacklogIds: ['TBL-001'],
        definitionOfDoneIds: ['DOD-001'],
      },
    ],
    assumptions: [{ id: 'TASM-001', requiresValidation: false }],
    openQuestions: [],
    outOfScope: [{ id: 'TOOS-001' }],
    ...overrides,
  };
}

describe('Developer Business Validation', () => {
  it.each([
    ['ready source without pending items', 'READY', [], [], 'READY'],
    [
      'non-blocking question',
      'READY',
      [{ id: 'TQ-001', impact: 'NON_BLOCKING' }],
      [],
      'PARTIALLY_READY',
    ],
    [
      'assumption requiring validation',
      'READY',
      [],
      [{ id: 'TASM-001', requiresValidation: true }],
      'PARTIALLY_READY',
    ],
    ['validated assumption', 'READY', [], [{ id: 'TASM-001', requiresValidation: false }], 'READY'],
    ['partially ready source', 'PARTIALLY_READY', [], [], 'PARTIALLY_READY'],
    [
      'blocking question over partially ready source',
      'PARTIALLY_READY',
      [{ id: 'TQ-001', impact: 'BLOCKING' }],
      [],
      'REQUIRES_CLARIFICATION',
    ],
    [
      'requires-clarification source without local questions',
      'REQUIRES_CLARIFICATION',
      [],
      [],
      'REQUIRES_CLARIFICATION',
    ],
    [
      'blocking question over ready source',
      'READY',
      [{ id: 'TQ-001', impact: 'BLOCKING' }],
      [],
      'REQUIRES_CLARIFICATION',
    ],
    [
      'blocking question takes precedence in a mixed list',
      'READY',
      [
        { id: 'TQ-001', impact: 'NON_BLOCKING' },
        { id: 'TQ-002', impact: 'BLOCKING' },
      ],
      [],
      'REQUIRES_CLARIFICATION',
    ],
  ] as const)(
    'derives readiness deterministically for %s',
    (_case, sourceReadiness, openQuestions, assumptions, expectedReadiness) => {
      expect(deriveDeveloperReadiness(sourceReadiness, openQuestions, assumptions)).toBe(
        expectedReadiness,
      );
    },
  );

  it('accepts a coherent specification and deeply freezes the report', () => {
    const specification = validSpecification();
    const snapshot = structuredClone(specification);
    const result = validateDeveloperBusinessRules(specification, sourceSpecification());

    expect(result).toEqual({
      valid: true,
      expectedReadiness: 'READY',
      issues: [],
      issuesTruncated: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(specification).toEqual(snapshot);
    expect(Object.isFrozen(specification)).toBe(false);
  });

  it('accepts an explicit Data Model with no changes and empty collections', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        dataModel: {
          changesRequired: false,
          migrationRequired: false,
          entities: [],
          relations: [],
        },
      }),
      sourceSpecification(),
    );

    expect(result).toMatchObject({ valid: true, issues: [] });
  });

  it('accepts a coherent Data Model change with entities and an optional relation', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        dataModel: {
          changesRequired: true,
          migrationRequired: true,
          entities: [
            { id: 'ENT-001', moduleId: 'MOD-001' },
            { id: 'ENT-002', moduleId: 'MOD-001' },
          ],
          relations: [
            {
              id: 'REL-001',
              sourceEntityId: 'ENT-001',
              targetEntityId: 'ENT-002',
            },
          ],
        },
      }),
      sourceSpecification(),
    );

    expect(result).toMatchObject({ valid: true, issues: [] });
  });

  it('rejects a Module omitted by its declared owner Component', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        components: [{ id: 'CMP-001', moduleIds: [], dependsOnComponentIds: [] }],
      }),
      sourceSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCONSISTENT_OWNERSHIP,
        path: ['modules', 0, 'componentId'],
      }),
    );
  });

  it('rejects a Component that lists a Module owned by another Component', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        components: [
          { id: 'CMP-001', moduleIds: ['MOD-001'], dependsOnComponentIds: [] },
          { id: 'CMP-002', moduleIds: ['MOD-001'], dependsOnComponentIds: [] },
        ],
        modules: [
          {
            id: 'MOD-001',
            path: 'core/example',
            componentId: 'CMP-002',
            dependsOnModuleIds: [],
          },
        ],
        flows: [
          {
            id: 'FLW-001',
            steps: [{ order: 1, componentId: 'CMP-002', moduleId: 'MOD-001' }],
            acceptanceCriteriaIds: ['AC-001'],
          },
        ],
      }),
      sourceSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCONSISTENT_OWNERSHIP,
        path: ['components', 0, 'moduleIds', 0],
      }),
    );
  });

  it('rejects a flow step whose Module belongs to another Component', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        components: [
          { id: 'CMP-001', moduleIds: ['MOD-001'], dependsOnComponentIds: [] },
          { id: 'CMP-002', moduleIds: [], dependsOnComponentIds: [] },
        ],
        flows: [
          {
            id: 'FLW-001',
            steps: [{ order: 1, componentId: 'CMP-002', moduleId: 'MOD-001' }],
            acceptanceCriteriaIds: ['AC-001'],
          },
        ],
      }),
      sourceSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCONSISTENT_OWNERSHIP,
        path: ['flows', 0, 'steps', 0, 'moduleId'],
      }),
    );
  });

  it('rejects an unknown flow-step Component even when moduleId is null', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        flows: [
          {
            id: 'FLW-001',
            steps: [{ order: 1, componentId: 'CMP-999', moduleId: null }],
            acceptanceCriteriaIds: ['AC-001'],
          },
        ],
      }),
      sourceSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE,
        path: ['flows', 0, 'steps', 0, 'componentId'],
      }),
    );
  });

  it('rejects entities when Data Model changes are not required', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        dataModel: {
          changesRequired: false,
          migrationRequired: false,
          entities: [{ id: 'ENT-001', moduleId: 'MOD-001' }],
          relations: [],
        },
      }),
      sourceSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.DATA_MODEL_MISMATCH,
        path: ['dataModel'],
      }),
    );
  });

  it('rejects migration when Data Model changes are not required', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        dataModel: {
          changesRequired: false,
          migrationRequired: true,
          entities: [],
          relations: [],
        },
      }),
      sourceSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.DATA_MODEL_MISMATCH,
        path: ['dataModel'],
      }),
    );
  });

  it('rejects required Data Model changes without an Entity', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        dataModel: {
          changesRequired: true,
          migrationRequired: false,
          entities: [],
          relations: [],
        },
      }),
      sourceSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.DATA_MODEL_MISMATCH,
        path: ['dataModel'],
      }),
    );
  });

  it('rejects a Data Model Relation that references an undeclared Entity', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        dataModel: {
          changesRequired: true,
          migrationRequired: false,
          entities: [{ id: 'ENT-001', moduleId: 'MOD-001' }],
          relations: [
            {
              id: 'REL-001',
              sourceEntityId: 'ENT-001',
              targetEntityId: 'ENT-999',
            },
          ],
        },
      }),
      sourceSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE,
        path: ['dataModel', 'relations', 0, 'targetEntityId'],
      }),
    );
  });

  it('rejects unknown, duplicate and inconsistent references', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        components: [
          {
            id: 'CMP-001',
            moduleIds: ['MOD-001', 'MOD-001'],
            dependsOnComponentIds: ['CMP-999'],
          },
        ],
        modules: [
          {
            id: 'MOD-001',
            path: 'core/example',
            componentId: 'CMP-999',
            dependsOnModuleIds: [],
          },
        ],
      }),
      sourceSpecification(),
    );
    const codes = result.issues.map(({ code }) => code);

    expect(codes).toEqual(
      expect.arrayContaining([
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCONSISTENT_OWNERSHIP,
      ]),
    );
  });

  it('detects self-references and dependency cycles', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        components: [
          {
            id: 'CMP-001',
            moduleIds: ['MOD-001'],
            dependsOnComponentIds: ['CMP-002'],
          },
          { id: 'CMP-002', moduleIds: [], dependsOnComponentIds: ['CMP-001'] },
        ],
        modules: [
          {
            id: 'MOD-001',
            path: 'core/example',
            componentId: 'CMP-001',
            dependsOnModuleIds: ['MOD-001'],
          },
        ],
      }),
      sourceSpecification(),
    );
    const codes = result.issues.map(({ code }) => code);

    expect(codes).toContain(DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.SELF_REFERENCE);
    expect(codes).toContain(DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.CYCLIC_DEPENDENCY);
  });

  it('validates contiguous orders and data-model indicators', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        flows: [
          {
            id: 'FLW-001',
            steps: [{ order: 2, componentId: 'CMP-001', moduleId: 'MOD-001' }],
            acceptanceCriteriaIds: ['AC-001'],
          },
        ],
        implementationPhases: [{ id: 'PH-001', order: 2, dependsOnPhaseIds: [] }],
        dataModel: {
          changesRequired: false,
          migrationRequired: true,
          entities: [],
          relations: [],
        },
      }),
      sourceSpecification(),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_ORDER,
        DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.DATA_MODEL_MISMATCH,
      ]),
    );
  });

  it('requires integral acceptance-criterion coverage and rejects unknown functional sources', () => {
    const source = sourceSpecification({
      acceptanceCriteria: [
        { id: 'AC-001', given: 'um estado', when: 'uma ação', then: 'um resultado' },
        { id: 'AC-002', given: 'outro estado', when: 'outra ação', then: 'outro resultado' },
      ],
    });
    const trace = validSpecification().traceability[0]!;
    const result = validateDeveloperBusinessRules(
      validSpecification({
        traceability: [
          { ...trace, sourceIds: ['AC-001', 'AC-999'] },
          { ...trace, id: 'TRC-002', sourceIds: ['AC-001'] },
        ],
      }),
      source,
    );
    const codes = result.issues.map(({ code }) => code);

    expect(codes).toContain(DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE);
    expect(codes).toContain(
      DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_ACCEPTANCE_CRITERION_COVERAGE,
    );
  });

  it('allows minimum sections to be empty only when clarification is required', () => {
    const empty = {
      components: [],
      modules: [],
      implementationPhases: [],
      implementationPlan: [],
      technicalBacklog: [],
      definitionOfDone: [],
    } as const;
    const readyResult = validateDeveloperBusinessRules(
      validSpecification(empty),
      sourceSpecification(),
    );
    const clarificationResult = validateDeveloperBusinessRules(
      validSpecification({
        ...empty,
        readiness: 'REQUIRES_CLARIFICATION',
        openQuestions: [{ id: 'TQ-001', impact: 'BLOCKING' }],
        traceability: [],
      }),
      sourceSpecification({
        readiness: 'REQUIRES_CLARIFICATION',
        openQuestions: [
          { id: 'Q-001', question: 'Qual decisão funcional está pendente?', impact: 'BLOCKING' },
        ],
      }),
    );

    expect(
      readyResult.issues.filter(
        ({ code }) => code === DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_SPECIFICATION,
      ),
    ).toHaveLength(6);
    expect(
      clarificationResult.issues.some(
        ({ code }) => code === DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_SPECIFICATION,
      ),
    ).toBe(false);
  });

  it('rejects declared readiness that differs from deterministic derivation', () => {
    const result = validateDeveloperBusinessRules(
      validSpecification({
        readiness: 'READY',
        openQuestions: [{ id: 'TQ-001', impact: 'NON_BLOCKING' }],
      }),
      sourceSpecification(),
    );

    expect(result.expectedReadiness).toBe('PARTIALLY_READY');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH,
        path: ['readiness'],
      }),
    );
  });

  it('maps parser issues to sanitized structural rejections', () => {
    const result = createDeveloperBusinessStructureRejection([
      { path: ['components', 3, 'id'] },
      { path: ['hidden', Symbol('not-public')] },
    ]);

    expect(result.expectedReadiness).toBeNull();
    expect(result.issues).toEqual([
      {
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_SPECIFICATION_STRUCTURE,
        path: ['components', 3, 'id'],
        message: 'A especificação não atende à estrutura técnica esperada.',
      },
      {
        code: DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_SPECIFICATION_STRUCTURE,
        path: ['hidden'],
        message: 'A especificação não atende à estrutura técnica esperada.',
      },
    ]);
    expect(Object.isFrozen(result.issues)).toBe(true);
  });

  it('limits reports to 100 issues and exposes deterministic truncation', () => {
    const trace = validSpecification().traceability[0]!;
    const result = validateDeveloperBusinessRules(
      validSpecification({
        traceability: [
          {
            ...trace,
            sourceIds: Array.from(
              { length: 120 },
              (_, index) => `AC-${String(index + 100).padStart(3, '0')}`,
            ),
          },
        ],
      }),
      sourceSpecification(),
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(100);
    expect(result.issuesTruncated).toBe(true);
    expect(result.issues[0]?.path).toEqual(['traceability', 0, 'sourceIds', 0]);
    expect(result.issues[99]?.path).toEqual(['traceability', 0, 'sourceIds', 99]);
  });
});
