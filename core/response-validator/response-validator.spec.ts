import type { AgentRunResult } from '@brq/agent-runner';
import type { JsonObject, JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import type { ValidationContract, ValidationRequest } from './contracts';
import { RESPONSE_VALIDATOR_ERROR_CODES } from './errors';
import { calculateCanonicalHash } from './hashing';
import { createResponseValidator } from './response-validator';
import { VALIDATION_ISSUE_CODES } from './schemas';
import {
  contractFor,
  createJsonRunResult,
  createTextRunResult,
  deterministicNow,
  quietLogger,
} from './testing/response-validator-fixtures';

function request(runResult: AgentRunResult): ValidationRequest {
  return { runResult, contract: contractFor(runResult) };
}

function withJsonSchema(
  runResult: AgentRunResult,
  schema: JsonObject,
): { runResult: AgentRunResult; contract: ValidationContract } {
  if (runResult.outputContract.format !== 'JSON_SCHEMA') throw new TypeError('JSON esperado.');

  const outputContract = { ...runResult.outputContract, schema };
  const outputContractHash = calculateCanonicalHash(outputContract as unknown as JsonValue);
  const updated: AgentRunResult = {
    ...runResult,
    prompt: {
      ...runResult.prompt,
      metadata: { ...runResult.prompt.metadata, outputContractHash },
    },
    outputContract,
  };

  return { runResult: updated, contract: contractFor(updated) };
}

describe('ResponseValidator', () => {
  it('validates JSON from content, reports provenance hashes and freezes the result', () => {
    const original = createJsonRunResult();
    const snapshot = structuredClone(original);
    const validator = createResponseValidator({ logger: quietLogger(), now: deterministicNow() });

    const result = validator.validate(request(original));

    expect(result).toMatchObject({
      valid: true,
      validatedOutput: { format: 'JSON_SCHEMA', data: { summary: 'ok' } },
      issues: [],
      metadata: {
        source: {
          executionId: 'execution-1',
          agentExecutionId: 'agent-execution-1',
          requestId: 'request-1',
          traceId: 'trace-1',
          provider: 'fake',
          model: 'test-model-v1',
          responseHash: original.output.responseHash,
        },
      },
    });
    expect(result.metadata.schemaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metadata.validatedValueHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metadata.validationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.validatedOutput)).toBe(true);
    expect(Object.isFrozen(original)).toBe(false);
    expect(original).toEqual(snapshot);
  });

  it('preserves TEXT exactly and ignores structuredData', () => {
    const content = '  texto sem normalização  ';
    const runResult = createTextRunResult({ content, structuredData: { ignored: true } });

    const result = createResponseValidator({ logger: quietLogger() }).validate(request(runResult));

    expect(result).toMatchObject({
      valid: true,
      validatedOutput: { format: 'TEXT', content },
      issues: [],
      metadata: { schemaHash: null },
    });
    expect(result.metadata.validatedValueHash).toBe(result.metadata.contentHash);
  });

  it.each([
    ['MAX_OUTPUT_TOKENS', VALIDATION_ISSUE_CODES.FINISH_REASON_MAX_OUTPUT_TOKENS],
    ['CONTENT_FILTER', VALIDATION_ISSUE_CODES.FINISH_REASON_CONTENT_FILTER],
    ['REFUSAL', VALIDATION_ISSUE_CODES.FINISH_REASON_REFUSAL],
  ] as const)('short-circuits %s before content validation', (finishReason, issueCode) => {
    const runResult = createJsonRunResult({ content: '{', structuredData: null, finishReason });

    const result = createResponseValidator({ logger: quietLogger() }).validate(request(runResult));

    expect(result.valid).toBe(false);
    expect(result.validatedOutput).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toEqual([issueCode]);
  });

  it('rejects missing content without modifying it', () => {
    const runResult = createTextRunResult({ content: '   ' });
    const result = createResponseValidator({ logger: quietLogger() }).validate(request(runResult));

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: VALIDATION_ISSUE_CODES.CONTENT_MISSING }),
    ]);
    expect(runResult.output.content).toBe('   ');
  });

  it('classifies malformed JSON without trusting structuredData', () => {
    const runResult = createJsonRunResult({
      content: '{not-json',
      structuredData: { summary: 'parece válido' },
    });
    const result = createResponseValidator({ logger: quietLogger() }).validate(request(runResult));

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      VALIDATION_ISSUE_CODES.MALFORMED_JSON,
    ]);
  });

  it('normalizes JSON Schema errors without response values', () => {
    const runResult = createJsonRunResult({ content: '{}', structuredData: {} });
    const result = createResponseValidator({ logger: quietLogger() }).validate(request(runResult));

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: VALIDATION_ISSUE_CODES.SCHEMA_MISMATCH,
        severity: 'ERROR',
        instancePath: '/summary',
        schemaPath: '#/required',
        keyword: 'required',
      }),
    );
    expect(JSON.stringify(result.issues)).not.toContain('{}');
  });

  it('validates standard formats through local Draft 2020-12 references', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['email'],
      properties: { email: { $ref: '#/$defs/email' } },
      $defs: { email: { type: 'string', format: 'email' } },
    };
    const valid = withJsonSchema(
      createJsonRunResult({
        content: JSON.stringify({ email: 'valid@example.com' }),
        structuredData: { email: 'valid@example.com' },
      }),
      schema,
    );
    const invalid = withJsonSchema(
      createJsonRunResult({
        content: JSON.stringify({ email: 'not-an-email' }),
        structuredData: { email: 'not-an-email' },
      }),
      schema,
    );
    const validator = createResponseValidator({ logger: quietLogger() });

    expect(validator.validate(valid).valid).toBe(true);
    expect(validator.validate(invalid).issues).toContainEqual(
      expect.objectContaining({
        code: VALIDATION_ISSUE_CODES.SCHEMA_MISMATCH,
        keyword: 'format',
      }),
    );
  });

  it('does not apply JSON Schema defaults, coercion or property removal', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { count: { type: 'integer', default: 7 } },
    };
    const validator = createResponseValidator({ logger: quietLogger() });
    const withoutDefault = withJsonSchema(
      createJsonRunResult({ content: '{}', structuredData: {} }),
      schema,
    );
    const untrustedValue = { count: '7', extra: true };
    const incompatible = withJsonSchema(
      createJsonRunResult({
        content: JSON.stringify(untrustedValue),
        structuredData: untrustedValue,
      }),
      schema,
    );

    expect(validator.validate(withoutDefault)).toMatchObject({
      valid: true,
      validatedOutput: { format: 'JSON_SCHEMA', data: {} },
    });
    expect(validator.validate(incompatible).issues.map((issue) => issue.keyword)).toEqual(
      expect.arrayContaining(['additionalProperties', 'type']),
    );
    expect(untrustedValue).toEqual({ count: '7', extra: true });
  });

  it('bounds diagnostic paths without exposing rejected values', () => {
    const longProperty = `field-${'x'.repeat(1_100)}`;
    const schema = {
      type: 'object',
      required: [longProperty],
      properties: { [longProperty]: { type: 'string' } },
    };
    const prepared = withJsonSchema(
      createJsonRunResult({ content: '{}', structuredData: {} }),
      schema,
    );
    const result = createResponseValidator({ logger: quietLogger() }).validate(prepared);

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.instancePath).toHaveLength(1_024);
    expect(JSON.stringify(result.issues)).not.toContain('{}');
  });

  it('keeps valid reparsed content with a warning when structuredData is unavailable', () => {
    const runResult = createJsonRunResult({ structuredData: null });
    const result = createResponseValidator({ logger: quietLogger() }).validate(request(runResult));

    expect(result.valid).toBe(true);
    expect(result.validatedOutput).toEqual({ format: 'JSON_SCHEMA', data: { summary: 'ok' } });
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: VALIDATION_ISSUE_CODES.STRUCTURED_DATA_UNAVAILABLE,
        severity: 'WARNING',
      }),
    ]);
  });

  it('does not warn when both parsed JSON and structuredData are literal null', () => {
    const schema = { type: 'null' };
    const prepared = withJsonSchema(
      createJsonRunResult({ content: 'null', structuredData: null }),
      schema,
    );
    const result = createResponseValidator({ logger: quietLogger() }).validate(prepared);

    expect(result).toMatchObject({
      valid: true,
      validatedOutput: { format: 'JSON_SCHEMA', data: null },
      issues: [],
    });
  });

  it('invalidates incompatible non-null structuredData', () => {
    const runResult = createJsonRunResult({ structuredData: { unexpected: true } });
    const result = createResponseValidator({ logger: quietLogger() }).validate(request(runResult));

    expect(result.valid).toBe(false);
    expect(result.validatedOutput).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        VALIDATION_ISSUE_CODES.STRUCTURED_DATA_SCHEMA_MISMATCH,
        VALIDATION_ISSUE_CODES.STRUCTURED_DATA_MISMATCH,
      ]),
    );
  });

  it('invalidates different structuredData even when both values satisfy the schema', () => {
    const runResult = createJsonRunResult({ structuredData: { summary: 'outro' } });
    const result = createResponseValidator({ logger: quietLogger() }).validate(request(runResult));

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      VALIDATION_ISSUE_CODES.STRUCTURED_DATA_MISMATCH,
    );
  });

  it('applies configurable content size and nesting limits as functional issues', () => {
    const oversized = createResponseValidator({
      logger: quietLogger(),
      configuration: { maxContentBytes: 4 },
    }).validate(request(createJsonRunResult()));
    expect(oversized.issues[0]?.code).toBe(VALIDATION_ISSUE_CODES.CONTENT_TOO_LARGE);

    const deepValue = { level1: { level2: { level3: 'fim' } } };
    const tooDeepRun = createJsonRunResult({
      content: JSON.stringify(deepValue),
      structuredData: deepValue,
    });
    const tooDeep = createResponseValidator({
      logger: quietLogger(),
      configuration: { maxNestingDepth: 2 },
    }).validate(request(tooDeepRun));
    expect(tooDeep.issues[0]?.code).toBe(VALIDATION_ISSUE_CODES.CONTENT_NESTING_TOO_DEEP);
  });

  it('rejects non-finite parsed numbers as unsupported JSON values', () => {
    const prepared = withJsonSchema(
      createJsonRunResult({ content: '1e400', structuredData: null }),
      {},
    );
    const result = createResponseValidator({ logger: quietLogger() }).validate(prepared);

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe(VALIDATION_ISSUE_CODES.MALFORMED_JSON);
  });

  it('invalidates non-null structuredData that exceeds the nesting limit', () => {
    const content = { accepted: true };
    const structuredData = { level1: { level2: { level3: true } } };
    const prepared = withJsonSchema(
      createJsonRunResult({ content: JSON.stringify(content), structuredData }),
      {},
    );
    const result = createResponseValidator({
      logger: quietLogger(),
      configuration: { maxNestingDepth: 2 },
    }).validate(prepared);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        VALIDATION_ISSUE_CODES.STRUCTURED_DATA_NESTING_TOO_DEEP,
        VALIDATION_ISSUE_CODES.STRUCTURED_DATA_MISMATCH,
      ]),
    );
  });

  it('caps issues and records truncation deterministically', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['a', 'b', 'c', 'd'],
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
        d: { type: 'string' },
      },
    };
    const prepared = withJsonSchema(
      createJsonRunResult({ content: '{}', structuredData: {} }),
      schema,
    );
    const result = createResponseValidator({
      logger: quietLogger(),
      configuration: { maxIssues: 2 },
    }).validate(prepared);

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.metadata.issuesTruncated).toBe(true);
  });

  it('rejects a contract that does not match the run result', () => {
    const runResult = createJsonRunResult();
    const contract = { ...contractFor(runResult), expectedOutputContractHash: 'c'.repeat(64) };

    expect(() =>
      createResponseValidator({ logger: quietLogger() }).validate({ runResult, contract }),
    ).toThrowError(
      expect.objectContaining({
        code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONTRACT,
        stage: 'CONTRACT',
      }),
    );
  });

  it('rejects a validation schema that diverges from the prompt output contract', () => {
    const runResult = createJsonRunResult();
    const originalContract = contractFor(runResult);
    if (originalContract.format !== 'JSON_SCHEMA') throw new TypeError('JSON esperado.');
    const contract: ValidationContract = {
      ...originalContract,
      schema: { type: 'object' },
    };

    expect(() =>
      createResponseValidator({ logger: quietLogger() }).validate({ runResult, contract }),
    ).toThrowError(
      expect.objectContaining({ code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONTRACT }),
    );
  });

  it('rejects invalid, asynchronous and remote JSON schemas as contract errors', () => {
    const validator = createResponseValidator({ logger: quietLogger() });
    const invalidSchemas: JsonObject[] = [
      { type: 'unknown-type' },
      { $async: true, type: 'object' },
      { $ref: 'https://example.invalid/schema.json' },
    ];

    for (const schema of invalidSchemas) {
      const prepared = withJsonSchema(createJsonRunResult(), schema);
      expect(() => validator.validate(prepared)).toThrowError(
        expect.objectContaining({ code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONTRACT }),
      );
    }
  });

  it('treats an oversized validation contract as a technical error', () => {
    const prepared = request(createJsonRunResult());
    expect(() =>
      createResponseValidator({
        logger: quietLogger(),
        configuration: { maxSchemaBytes: 32 },
      }).validate(prepared),
    ).toThrowError(
      expect.objectContaining({ code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONTRACT }),
    );
  });

  it('produces stable hashes independently of object key order and clock duration', () => {
    const firstRun = createJsonRunResult({
      content: '{"summary":"ok"}',
      structuredData: { summary: 'ok' },
    });
    const secondRun = createJsonRunResult({
      content: '{"summary":"ok"}',
      structuredData: { summary: 'ok' },
    });
    const first = createResponseValidator({
      logger: quietLogger(),
      now: deterministicNow(5),
    }).validate(request(firstRun));
    const second = createResponseValidator({
      logger: quietLogger(),
      now: deterministicNow(50),
    }).validate(request(secondRun));

    expect(first.metadata.validationHash).toBe(second.metadata.validationHash);
    expect(first).toEqual(second);
  });

  it('rejects a structurally invalid request with a canonical technical error', () => {
    const validator = createResponseValidator({ logger: quietLogger() });

    expect(() => validator.validate({} as ValidationRequest)).toThrowError(
      expect.objectContaining({
        code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_REQUEST,
        stage: 'REQUEST',
      }),
    );
  });
});
