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
  it('derives readiness without upgrading the Product Owner readiness', () => {
    expect(deriveDeveloperReadiness('READY', [], [])).toBe('READY');
    expect(deriveDeveloperReadiness('PARTIALLY_READY', [], [])).toBe('PARTIALLY_READY');
    expect(deriveDeveloperReadiness('READY', [{ id: 'TQ-001', impact: 'NON_BLOCKING' }], [])).toBe(
      'PARTIALLY_READY',
    );
    expect(
      deriveDeveloperReadiness('READY', [], [{ id: 'TASM-001', requiresValidation: true }]),
    ).toBe('PARTIALLY_READY');
    expect(
      deriveDeveloperReadiness(
        'REQUIRES_CLARIFICATION',
        [{ id: 'TQ-001', impact: 'BLOCKING' }],
        [],
      ),
    ).toBe('REQUIRES_CLARIFICATION');
  });

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
