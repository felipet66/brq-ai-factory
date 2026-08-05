import { describe, expect, it } from 'vitest';

import { createResponseValidator } from './response-validator';
import {
  jsonSchemaDialectSchema,
  validationContractSchema,
  validationIssueSeveritySchema,
  validationResultSchema,
} from './schemas';
import {
  contractFor,
  createJsonRunResult,
  quietLogger,
} from './testing/response-validator-fixtures';

describe('response validator schemas', () => {
  it('requires the canonical JSON Schema dialect and rejects unknown fields', () => {
    const runResult = createJsonRunResult();
    const contract = contractFor(runResult);

    expect(validationContractSchema.safeParse(contract).success).toBe(true);
    expect(jsonSchemaDialectSchema.safeParse('DRAFT_2020_12').success).toBe(true);
    expect(validationContractSchema.safeParse({ ...contract, dialect: 'DRAFT_07' }).success).toBe(
      false,
    );
    expect(validationContractSchema.safeParse({ ...contract, extra: true }).success).toBe(false);
  });

  it('keeps INFO reserved in the public severity schema', () => {
    expect(validationIssueSeveritySchema.options).toEqual(['ERROR', 'WARNING', 'INFO']);
    expect(validationIssueSeveritySchema.safeParse('INFO').success).toBe(true);
  });

  it('keeps INFO reserved without producing it in the Sprint 7 pipeline', () => {
    const validator = createResponseValidator({ logger: quietLogger() });
    const warningRun = createJsonRunResult({ structuredData: null });
    const errorRun = createJsonRunResult({ content: '{', structuredData: null });
    const issues = [warningRun, errorRun].flatMap(
      (runResult) => validator.validate({ runResult, contract: contractFor(runResult) }).issues,
    );

    expect(issues.map((issue) => issue.severity)).toEqual(['WARNING', 'ERROR']);
    expect(issues.some((issue) => issue.severity === 'INFO')).toBe(false);
  });

  it('enforces result invariants between valid, issues and validatedOutput', () => {
    const runResult = createJsonRunResult();
    const result = createResponseValidator({ logger: quietLogger() }).validate({
      runResult,
      contract: contractFor(runResult),
    });

    expect(validationResultSchema.safeParse(result).success).toBe(true);
    expect(
      validationResultSchema.safeParse({ ...result, valid: false, validatedOutput: null }).success,
    ).toBe(false);
    expect(validationResultSchema.safeParse({ ...result, validatedOutput: null }).success).toBe(
      false,
    );
  });
});
