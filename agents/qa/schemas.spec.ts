import { describe, expect, it } from 'vitest';

import { QA_BUSINESS_VALIDATION_MAX_ISSUES } from './business-validation';
import {
  qaAgentRequestSchema,
  qaBusinessValidationResultSchema,
  qaCoverageSummaryItemSchema,
  qaPositiveScenarioSchema,
  qaSpecificationStructureSchema,
} from './schemas';
import { createQARequest, createQASpecification } from './testing/qa-fixtures';

describe('QA schemas', () => {
  it('aceita request e QASpecification canônicos', () => {
    expect(qaAgentRequestSchema.parse(createQARequest())).toEqual(createQARequest());
    expect(qaSpecificationStructureSchema.parse(createQASpecification())).toEqual(
      createQASpecification(),
    );
  });

  it('exige deliveryIntent host-owned no request', () => {
    const { deliveryIntent, ...withoutDeliveryIntent } = createQARequest();

    expect(deliveryIntent).toBeDefined();
    expect(qaAgentRequestSchema.safeParse(withoutDeliveryIntent).success).toBe(false);
  });

  it('rejeita propriedades adicionais no request e na specification', () => {
    expect(
      qaAgentRequestSchema.safeParse({ ...createQARequest(), orchestrator: true }).success,
    ).toBe(false);
    expect(
      qaSpecificationStructureSchema.safeParse({ ...createQASpecification(), executed: true })
        .success,
    ).toBe(false);
  });

  it('valida o prefixo da categoria do cenário', () => {
    const positive = createQASpecification().positiveScenarios[0]!;
    expect(qaPositiveScenarioSchema.safeParse({ ...positive, id: 'QAN-001' }).success).toBe(false);
  });

  it('exige passos, resultados esperados e ao menos um tipo de teste', () => {
    const positive = createQASpecification().positiveScenarios[0]!;
    expect(qaPositiveScenarioSchema.safeParse({ ...positive, steps: [] }).success).toBe(false);
    expect(qaPositiveScenarioSchema.safeParse({ ...positive, expectedResults: [] }).success).toBe(
      false,
    );
    expect(qaPositiveScenarioSchema.safeParse({ ...positive, testTypes: [] }).success).toBe(false);
  });

  it('impede covered maior que total', () => {
    expect(qaCoverageSummaryItemSchema.safeParse({ total: 1, covered: 2 }).success).toBe(false);
  });

  it('rejeita request com limites excessivos ou modelo normalizável', () => {
    expect(
      qaAgentRequestSchema.safeParse({
        ...createQARequest(),
        model: ' fake-model ',
        limits: { timeoutMs: 999 },
      }).success,
    ).toBe(false);
  });

  it('preserva coerência do resultado de Business Validation', () => {
    expect(
      qaBusinessValidationResultSchema.safeParse({
        valid: true,
        expectedReadiness: 'READY',
        issues: [],
        issuesTruncated: false,
      }).success,
    ).toBe(true);
    expect(
      qaBusinessValidationResultSchema.safeParse({
        valid: false,
        expectedReadiness: 'READY',
        issues: [],
        issuesTruncated: false,
      }).success,
    ).toBe(false);
  });

  it('exige o limite completo quando issuesTruncated é verdadeiro', () => {
    const issue = {
      code: 'QA_UNKNOWN_REFERENCE',
      path: ['traceability'],
      message: 'Referência desconhecida.',
    };
    expect(
      qaBusinessValidationResultSchema.safeParse({
        valid: false,
        expectedReadiness: 'READY',
        issues: Array.from({ length: QA_BUSINESS_VALIDATION_MAX_ISSUES }, () => issue),
        issuesTruncated: true,
      }).success,
    ).toBe(true);
    expect(
      qaBusinessValidationResultSchema.safeParse({
        valid: false,
        expectedReadiness: 'READY',
        issues: [issue],
        issuesTruncated: true,
      }).success,
    ).toBe(false);
  });
});
