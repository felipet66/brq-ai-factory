import { createTechnicalSpecification } from '../developer/testing/developer-fixtures';
import { createProductOwnerSpecification } from '../product-owner/testing/product-owner-fixtures';
import { describe, expect, it } from 'vitest';

import {
  QA_BUSINESS_VALIDATION_ISSUE_CODES,
  createQABusinessStructureRejection,
  deriveQAReadiness,
  validateQABusinessRules,
} from './business-validation';
import { createQASpecification } from './testing/qa-fixtures';

function issueCodes(result: ReturnType<typeof validateQABusinessRules>) {
  return result.issues.map(({ code }) => code);
}

describe('QA Business Validation', () => {
  it('aceita uma especificação com cobertura funcional e técnica integral', () => {
    const result = validateQABusinessRules(
      createQASpecification(),
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );

    expect(result).toEqual({
      valid: true,
      expectedReadiness: 'READY',
      issues: [],
      issuesTruncated: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    [
      'Acceptance Criterion',
      'functionalCoverage',
      QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_ACCEPTANCE_CRITERION_COVERAGE,
    ],
    [
      'decisão técnica',
      'technicalCoverage',
      QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_TECHNICAL_DECISION_COVERAGE,
    ],
  ] as const)('rejeita ausência de cobertura para %s', (_label, field, code) => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: { ...base.traceability, [field]: [] },
    });
    const result = validateQABusinessRules(
      specification,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).toContain(code);
  });

  it('exige cobertura de toda Business Rule fornecida', () => {
    const productOwner = createProductOwnerSpecification({
      businessRules: [
        {
          id: 'BR-001',
          description: 'Somente pedidos nacionais podem ser consultados.',
          source: 'Escopo funcional.',
          condition: 'O pedido deve ser nacional.',
          impact: 'HIGH',
        },
      ],
    });
    const result = validateQABusinessRules(
      createQASpecification(),
      productOwner,
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).toContain(
      QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_BUSINESS_RULE_COVERAGE,
    );
  });

  it('exige cobertura de todo item de Definition of Done', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        technicalCoverage: base.traceability.technicalCoverage.filter(
          ({ sourceId }) => sourceId !== 'DOD-001',
        ),
      },
    });
    const result = validateQABusinessRules(
      specification,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).toContain(
      QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_DEFINITION_OF_DONE_COVERAGE,
    );
  });

  it('rejeita referências desconhecidas e duplicadas', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      positiveScenarios: [
        {
          ...base.positiveScenarios[0]!,
          functionalReferences: ['AC-001', 'AC-001', 'AC-999'],
        },
      ],
    });
    const result = validateQABusinessRules(
      specification,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        QA_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE,
      ]),
    );
  });

  it('rejeita mapa de cobertura que aponta para cenário sem a mesma fonte', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        functionalCoverage: [{ sourceId: 'AC-001', scenarioIds: ['QAN-001'] }],
      },
    });
    const result = validateQABusinessRules(
      specification,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).toContain(QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH);
  });

  it('recalcula o resumo de cobertura', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        summary: { ...base.traceability.summary, acceptanceCriteria: { total: 1, covered: 0 } },
      },
    });
    const result = validateQABusinessRules(
      specification,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).toContain(
      QA_BUSINESS_VALIDATION_ISSUE_CODES.COVERAGE_SUMMARY_MISMATCH,
    );
  });

  it('exige ranking prioritário contíguo e cenário conhecido', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      priorityTests: [{ ...base.priorityTests[0]!, rank: 2, scenarioId: 'QAP-999' }],
    });
    const result = validateQABusinessRules(
      specification,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        QA_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_PRIORITY_ORDER,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.UNKNOWN_REFERENCE,
      ]),
    );
  });

  it('deriva readiness com precedência determinística', () => {
    expect(deriveQAReadiness('READY', 'READY', [], [], [])).toBe('READY');
    expect(
      deriveQAReadiness('READY', 'READY', [{ id: 'QQ-001', impact: 'NON_BLOCKING' }], [], []),
    ).toBe('PARTIALLY_READY');
    expect(
      deriveQAReadiness('READY', 'READY', [], [], [{ id: 'QBLK-001', sourceIds: ['AC-001'] }]),
    ).toBe('REQUIRES_CLARIFICATION');
    expect(deriveQAReadiness('REQUIRES_CLARIFICATION', 'READY', [], [], [])).toBe(
      'REQUIRES_CLARIFICATION',
    );
  });

  it('rejeita readiness declarada diferente da derivada', () => {
    const result = validateQABusinessRules(
      createQASpecification({ readiness: 'PARTIALLY_READY' }),
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).toContain(QA_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH);
  });

  it('permite coleções mínimas vazias somente quando requer esclarecimento', () => {
    const base = createQASpecification();
    const minimal = createQASpecification({
      readiness: 'REQUIRES_CLARIFICATION',
      positiveScenarios: [],
      negativeScenarios: [],
      edgeCases: [],
      approvalCriteria: [],
      priorityTests: [],
      automationRecommendations: [],
      blockingItems: [
        {
          id: 'QBLK-001',
          description: 'Falta decisão.',
          sourceIds: ['AC-001'],
          resolution: 'Definir a decisão.',
        },
      ],
      traceability: {
        ...base.traceability,
        summary: {
          acceptanceCriteria: { total: 1, covered: 0 },
          businessRules: { total: 0, covered: 0 },
          technicalDecisions: { total: 1, covered: 0 },
          definitionOfDone: { total: 1, covered: 0 },
        },
        functionalCoverage: [],
        technicalCoverage: [],
        matrix: [],
      },
    });
    const result = validateQABusinessRules(
      minimal,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).not.toContain(
      QA_BUSINESS_VALIDATION_ISSUE_CODES.INCOMPLETE_SPECIFICATION,
    );
    expect(result.valid).toBe(false);
  });

  it('cria rejeição estrutural sanitizada e truncada', () => {
    const result = createQABusinessStructureRejection(
      Array.from({ length: 105 }, (_, index) => ({ path: ['payload', index, Symbol('unsafe')] })),
    );
    expect(result.valid).toBe(false);
    expect(result.expectedReadiness).toBeNull();
    expect(result.issues).toHaveLength(100);
    expect(result.issuesTruncated).toBe(true);
    expect(result.issues[0]?.path).toEqual(['payload', 0]);
  });
});
