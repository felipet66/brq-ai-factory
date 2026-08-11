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

const THREE_BUSINESS_RULES = [
  {
    id: 'BR-001',
    description: 'O texto deve ser obrigatório.',
    source: 'Escopo funcional.',
    condition: 'Texto informado.',
    impact: 'HIGH',
  },
  {
    id: 'BR-002',
    description: 'Espaços também contam como caracteres.',
    source: 'Escopo funcional.',
    condition: 'Texto contém espaços.',
    impact: 'MEDIUM',
  },
  {
    id: 'BR-003',
    description: 'O resultado deve ser atualizado para o texto atual.',
    source: 'Escopo funcional.',
    condition: 'Texto alterado.',
    impact: 'HIGH',
  },
] as const;

function createThreeBusinessRuleSpecification() {
  const base = createQASpecification();
  const functionalSourceIds = ['AC-001', 'BR-001', 'BR-002', 'BR-003'] as const;
  return createQASpecification({
    positiveScenarios: [
      { ...base.positiveScenarios[0]!, functionalReferences: functionalSourceIds },
    ],
    traceability: {
      ...base.traceability,
      summary: {
        ...base.traceability.summary,
        businessRules: { total: 3, covered: 3 },
      },
      functionalCoverage: functionalSourceIds.map((sourceId) => ({
        sourceId,
        scenarioIds: ['QAP-001' as const],
      })),
      matrix: [
        {
          ...base.traceability.matrix[0]!,
          functionalSourceIds,
        },
      ],
    },
  });
}

function validateThreeBusinessRuleSpecification(
  specification = createThreeBusinessRuleSpecification(),
) {
  return validateQABusinessRules(
    specification,
    createProductOwnerSpecification({ businessRules: THREE_BUSINESS_RULES }),
    createTechnicalSpecification(),
  );
}

function createMultipleSourceProductOwnerSpecification() {
  const base = createProductOwnerSpecification();
  return createProductOwnerSpecification({
    acceptanceCriteria: [
      base.acceptanceCriteria[0]!,
      {
        id: 'AC-002',
        given: 'que o cliente possui outro pedido nacional',
        when: 'ele consulta o segundo pedido',
        then: 'o andamento correspondente é apresentado',
      },
    ],
    businessRules: [
      {
        id: 'BR-001',
        description: 'Somente pedidos nacionais podem ser consultados.',
        source: 'Escopo funcional.',
        condition: 'O pedido deve ser nacional.',
        impact: 'HIGH',
      },
      {
        id: 'BR-002',
        description: 'O cliente deve consultar apenas pedidos próprios.',
        source: 'Escopo funcional.',
        condition: 'O pedido pertence ao cliente autenticado.',
        impact: 'HIGH',
      },
    ],
  });
}

function createMultipleSourceTechnicalSpecification() {
  const base = createTechnicalSpecification();
  return createTechnicalSpecification({
    decisions: [
      base.decisions[0]!,
      {
        ...base.decisions[0]!,
        id: 'DEC-002',
        title: 'Manter o contrato de resposta explícito',
      },
    ],
    definitionOfDone: [
      base.definitionOfDone[0]!,
      {
        id: 'DOD-002',
        criterion: 'Os dois critérios funcionais possuem rastreabilidade técnica.',
        acceptanceCriteriaIds: ['AC-002'],
      },
    ],
  });
}

function createMultipleSourceQASpecification() {
  const base = createQASpecification();
  const functionalSourceIds = ['AC-001', 'AC-002', 'BR-001', 'BR-002'] as const;
  const technicalSourceIds = ['DEC-001', 'DEC-002', 'DOD-001', 'DOD-002'] as const;
  return createQASpecification({
    positiveScenarios: [
      {
        ...base.positiveScenarios[0]!,
        functionalReferences: functionalSourceIds,
        technicalReferences: technicalSourceIds,
      },
    ],
    traceability: {
      summary: {
        acceptanceCriteria: { total: 2, covered: 2 },
        businessRules: { total: 2, covered: 2 },
        technicalDecisions: { total: 2, covered: 2 },
        definitionOfDone: { total: 2, covered: 2 },
      },
      functionalCoverage: functionalSourceIds.map((sourceId) => ({
        sourceId,
        scenarioIds: ['QAP-001' as const],
      })),
      technicalCoverage: technicalSourceIds.map((sourceId) => ({
        sourceId,
        scenarioIds: ['QAP-001' as const],
      })),
      matrix: [
        {
          id: 'QTR-001',
          functionalSourceIds,
          technicalSourceIds,
          scenarioIds: ['QAP-001'],
        },
      ],
    },
  });
}

function validateMultipleSourceQASpecification(
  specification = createMultipleSourceQASpecification(),
) {
  return validateQABusinessRules(
    specification,
    createMultipleSourceProductOwnerSpecification(),
    createMultipleSourceTechnicalSpecification(),
  );
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

  it('aceita três Business Rules cobertas em cenários, mapa e matriz com summary 3/3', () => {
    expect(validateThreeBusinessRuleSpecification()).toEqual({
      valid: true,
      expectedReadiness: 'READY',
      issues: [],
      issuesTruncated: false,
    });
  });

  it('detecta Business Rule omitida das referências dos cenários', () => {
    const base = createThreeBusinessRuleSpecification();
    const specification = createQASpecification({
      ...base,
      positiveScenarios: [
        {
          ...base.positiveScenarios[0]!,
          functionalReferences: base.positiveScenarios[0]!.functionalReferences.filter(
            (id) => id !== 'BR-002',
          ),
        },
      ],
      traceability: {
        ...base.traceability,
        summary: {
          ...base.traceability.summary,
          businessRules: { total: 3, covered: 2 },
        },
      },
    });

    expect(issueCodes(validateThreeBusinessRuleSpecification(specification))).toEqual(
      expect.arrayContaining([
        QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_BUSINESS_RULE_COVERAGE,
      ]),
    );
  });

  it('detecta Business Rule omitida do functionalCoverage', () => {
    const base = createThreeBusinessRuleSpecification();
    const specification = createQASpecification({
      ...base,
      traceability: {
        ...base.traceability,
        summary: {
          ...base.traceability.summary,
          businessRules: { total: 3, covered: 2 },
        },
        functionalCoverage: base.traceability.functionalCoverage.filter(
          ({ sourceId }) => sourceId !== 'BR-002',
        ),
      },
    });
    const codes = issueCodes(validateThreeBusinessRuleSpecification(specification));

    expect(codes).toEqual([QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_BUSINESS_RULE_COVERAGE]);
  });

  it('detecta Business Rule omitida da matriz', () => {
    const base = createThreeBusinessRuleSpecification();
    const specification = createQASpecification({
      ...base,
      traceability: {
        ...base.traceability,
        summary: {
          ...base.traceability.summary,
          businessRules: { total: 3, covered: 2 },
        },
        matrix: [
          {
            ...base.traceability.matrix[0]!,
            functionalSourceIds: base.traceability.matrix[0]!.functionalSourceIds.filter(
              (id) => id !== 'BR-002',
            ),
          },
        ],
      },
    });
    const codes = issueCodes(validateThreeBusinessRuleSpecification(specification));

    expect(codes).toEqual([QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_BUSINESS_RULE_COVERAGE]);
  });

  it('detecta summary incorreto mesmo com as três superfícies completas', () => {
    const base = createThreeBusinessRuleSpecification();
    const specification = createQASpecification({
      ...base,
      traceability: {
        ...base.traceability,
        summary: {
          ...base.traceability.summary,
          businessRules: { total: 3, covered: 2 },
        },
      },
    });
    const codes = issueCodes(validateThreeBusinessRuleSpecification(specification));

    expect(codes).toEqual([QA_BUSINESS_VALIDATION_ISSUE_CODES.COVERAGE_SUMMARY_MISMATCH]);
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

  it('aceita DOD presente em cenário, technicalCoverage, matriz e summary recalculado', () => {
    const result = validateQABusinessRules(
      createQASpecification(),
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejeita DOD ausente de technicalReferences dos cenários', () => {
    const base = createQASpecification();
    function withoutDOD<T extends { readonly technicalReferences: readonly string[] }>(
      scenario: T,
    ) {
      return {
        ...scenario,
        technicalReferences: scenario.technicalReferences.filter((id) => id !== 'DOD-001'),
      };
    }
    const specification = createQASpecification({
      positiveScenarios: base.positiveScenarios.map(withoutDOD),
      negativeScenarios: base.negativeScenarios.map(withoutDOD),
      edgeCases: base.edgeCases.map(withoutDOD),
      traceability: {
        ...base.traceability,
        summary: {
          ...base.traceability.summary,
          definitionOfDone: { total: 1, covered: 0 },
        },
      },
    });

    expect(
      issueCodes(
        validateQABusinessRules(
          specification,
          createProductOwnerSpecification(),
          createTechnicalSpecification(),
        ),
      ),
    ).toContain(QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_DEFINITION_OF_DONE_COVERAGE);
  });

  it('rejeita DOD ausente de technicalCoverage', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        summary: {
          ...base.traceability.summary,
          definitionOfDone: { total: 1, covered: 0 },
        },
        technicalCoverage: base.traceability.technicalCoverage.filter(
          ({ sourceId }) => sourceId !== 'DOD-001',
        ),
      },
    });

    expect(
      issueCodes(
        validateQABusinessRules(
          specification,
          createProductOwnerSpecification(),
          createTechnicalSpecification(),
        ),
      ),
    ).toContain(QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_DEFINITION_OF_DONE_COVERAGE);
  });

  it('rejeita DOD ausente de technicalSourceIds da matriz', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        summary: {
          ...base.traceability.summary,
          definitionOfDone: { total: 1, covered: 0 },
        },
        matrix: [
          {
            ...base.traceability.matrix[0]!,
            technicalSourceIds: base.traceability.matrix[0]!.technicalSourceIds.filter(
              (id) => id !== 'DOD-001',
            ),
            scenarioIds: base.traceability.matrix[0]!.scenarioIds.filter((id) => id !== 'QAE-001'),
          },
        ],
      },
    });

    expect(
      issueCodes(
        validateQABusinessRules(
          specification,
          createProductOwnerSpecification(),
          createTechnicalSpecification(),
        ),
      ),
    ).toContain(QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_DEFINITION_OF_DONE_COVERAGE);
  });

  it('rejeita summary DOD total quando a cobertura real está incompleta', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        matrix: [
          {
            ...base.traceability.matrix[0]!,
            technicalSourceIds: base.traceability.matrix[0]!.technicalSourceIds.filter(
              (id) => id !== 'DOD-001',
            ),
            scenarioIds: base.traceability.matrix[0]!.scenarioIds.filter((id) => id !== 'QAE-001'),
          },
        ],
      },
    });
    const codes = issueCodes(
      validateQABusinessRules(
        specification,
        createProductOwnerSpecification(),
        createTechnicalSpecification(),
      ),
    );

    expect(codes).toEqual(
      expect.arrayContaining([
        QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_DEFINITION_OF_DONE_COVERAGE,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.COVERAGE_SUMMARY_MISMATCH,
      ]),
    );
  });

  it('aceita DEC presente nas três superfícies e com summary consistente', () => {
    const result = validateQABusinessRules(
      createQASpecification(),
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejeita DEC ausente de uma superfície obrigatória', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        summary: {
          ...base.traceability.summary,
          technicalDecisions: { total: 1, covered: 0 },
        },
        matrix: [
          {
            ...base.traceability.matrix[0]!,
            technicalSourceIds: base.traceability.matrix[0]!.technicalSourceIds.filter(
              (id) => id !== 'DEC-001',
            ),
            scenarioIds: base.traceability.matrix[0]!.scenarioIds.filter((id) => id !== 'QAN-001'),
          },
        ],
      },
    });

    expect(
      issueCodes(
        validateQABusinessRules(
          specification,
          createProductOwnerSpecification(),
          createTechnicalSpecification(),
        ),
      ),
    ).toContain(QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_TECHNICAL_DECISION_COVERAGE);
  });

  it('rejeita summary DEC total quando a cobertura real está incompleta', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        matrix: [
          {
            ...base.traceability.matrix[0]!,
            technicalSourceIds: base.traceability.matrix[0]!.technicalSourceIds.filter(
              (id) => id !== 'DEC-001',
            ),
            scenarioIds: base.traceability.matrix[0]!.scenarioIds.filter((id) => id !== 'QAN-001'),
          },
        ],
      },
    });
    const codes = issueCodes(
      validateQABusinessRules(
        specification,
        createProductOwnerSpecification(),
        createTechnicalSpecification(),
      ),
    );

    expect(codes).toEqual(
      expect.arrayContaining([
        QA_BUSINESS_VALIDATION_ISSUE_CODES.MISSING_TECHNICAL_DECISION_COVERAGE,
        QA_BUSINESS_VALIDATION_ISSUE_CODES.COVERAGE_SUMMARY_MISMATCH,
      ]),
    );
  });

  it('rastreia múltiplos AC, BR, DEC e DOD individualmente na matriz combinada', () => {
    expect(validateMultipleSourceQASpecification()).toEqual({
      valid: true,
      expectedReadiness: 'READY',
      issues: [],
      issuesTruncated: false,
    });

    const complete = createMultipleSourceQASpecification();
    const incomplete = createQASpecification({
      ...complete,
      traceability: {
        ...complete.traceability,
        summary: {
          ...complete.traceability.summary,
          definitionOfDone: { total: 2, covered: 1 },
        },
        matrix: [
          {
            ...complete.traceability.matrix[0]!,
            technicalSourceIds: complete.traceability.matrix[0]!.technicalSourceIds.filter(
              (id) => id !== 'DOD-002',
            ),
          },
        ],
      },
    });

    expect(issueCodes(validateMultipleSourceQASpecification(incomplete))).toContain(
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

  it('rejeita mapas funcionais duplicados para o mesmo sourceId', () => {
    const base = createQASpecification();
    const duplicatedEntry = base.traceability.functionalCoverage[0]!;
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        functionalCoverage: [...base.traceability.functionalCoverage, duplicatedEntry],
      },
    });
    const result = validateQABusinessRules(
      specification,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: QA_BUSINESS_VALIDATION_ISSUE_CODES.DUPLICATE_REFERENCE,
        path: ['traceability', 'functionalCoverage', 1, 'sourceId'],
      }),
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
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH,
        path: ['traceability', 'functionalCoverage', 0, 'scenarioIds'],
      }),
    );
  });

  it('rejeita mapa técnico que aponta para cenário sem a mesma fonte', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        technicalCoverage: [
          { sourceId: 'DEC-001', scenarioIds: ['QAE-001'] },
          { sourceId: 'DOD-001', scenarioIds: ['QAP-001', 'QAE-001'] },
        ],
      },
    });
    const result = validateQABusinessRules(
      specification,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH,
        path: ['traceability', 'technicalCoverage', 0, 'scenarioIds'],
      }),
    );
  });

  it('rejeita linha da matriz cujo cenário não declara nenhuma fonte relacionada', () => {
    const base = createQASpecification();
    const specification = createQASpecification({
      traceability: {
        ...base.traceability,
        matrix: [
          {
            id: 'QTR-001',
            functionalSourceIds: ['AC-001'],
            technicalSourceIds: [],
            scenarioIds: ['QAN-001'],
          },
          {
            id: 'QTR-002',
            functionalSourceIds: [],
            technicalSourceIds: ['DEC-001', 'DOD-001'],
            scenarioIds: ['QAP-001', 'QAN-001', 'QAE-001'],
          },
        ],
      },
    });
    const result = validateQABusinessRules(
      specification,
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: QA_BUSINESS_VALIDATION_ISSUE_CODES.CATEGORY_MISMATCH,
        path: ['traceability', 'matrix', 0, 'scenarioIds'],
      }),
    );
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

  it('deriva READY somente quando as fontes e coleções finais não possuem pendências', () => {
    expect(deriveQAReadiness('READY', 'READY', [], [], [])).toBe('READY');
    expect(
      deriveQAReadiness('READY', 'READY', [], [{ id: 'QASM-001', requiresValidation: false }], []),
    ).toBe('READY');
  });

  it('deriva PARTIALLY_READY de qualquer fonte parcial, dúvida ou premissa pendente', () => {
    expect(deriveQAReadiness('PARTIALLY_READY', 'READY', [], [], [])).toBe('PARTIALLY_READY');
    expect(deriveQAReadiness('READY', 'PARTIALLY_READY', [], [], [])).toBe('PARTIALLY_READY');
    expect(
      deriveQAReadiness('READY', 'READY', [{ id: 'QQ-001', impact: 'NON_BLOCKING' }], [], []),
    ).toBe('PARTIALLY_READY');
    expect(
      deriveQAReadiness('READY', 'READY', [], [{ id: 'QASM-001', requiresValidation: true }], []),
    ).toBe('PARTIALLY_READY');
  });

  it('deriva REQUIRES_CLARIFICATION com precedência para fontes, bloqueios e dúvidas bloqueantes', () => {
    expect(deriveQAReadiness('REQUIRES_CLARIFICATION', 'READY', [], [], [])).toBe(
      'REQUIRES_CLARIFICATION',
    );
    expect(deriveQAReadiness('READY', 'REQUIRES_CLARIFICATION', [], [], [])).toBe(
      'REQUIRES_CLARIFICATION',
    );
    expect(
      deriveQAReadiness('READY', 'READY', [], [], [{ id: 'QBLK-001', sourceIds: ['AC-001'] }]),
    ).toBe('REQUIRES_CLARIFICATION');
    expect(
      deriveQAReadiness('READY', 'READY', [{ id: 'QQ-001', impact: 'BLOCKING' }], [], []),
    ).toBe('REQUIRES_CLARIFICATION');
    expect(
      deriveQAReadiness(
        'PARTIALLY_READY',
        'PARTIALLY_READY',
        [{ id: 'QQ-001', impact: 'BLOCKING' }],
        [{ id: 'QASM-001', requiresValidation: true }],
        [],
      ),
    ).toBe('REQUIRES_CLARIFICATION');
  });

  it('rejeita readiness declarada diferente da derivada', () => {
    const result = validateQABusinessRules(
      createQASpecification({ readiness: 'PARTIALLY_READY' }),
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );
    expect(issueCodes(result)).toContain(QA_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH);
  });

  it('reproduz a regressão real quando uma dúvida não bloqueante exige readiness parcial', () => {
    const result = validateQABusinessRules(
      createQASpecification({
        readiness: 'READY',
        openQuestions: [
          {
            id: 'QQ-001',
            question: 'Qual será o volume esperado em produção?',
            impact: 'NON_BLOCKING',
          },
        ],
      }),
      createProductOwnerSpecification(),
      createTechnicalSpecification(),
    );

    expect(result.expectedReadiness).toBe('PARTIALLY_READY');
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
