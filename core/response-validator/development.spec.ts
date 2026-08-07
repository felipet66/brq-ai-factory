import type { AgentRunResult } from '@brq/agent-runner';
import type { JsonObject, JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it, vi } from 'vitest';

import * as productionApi from '@brq/response-validator';
import {
  STRUCTURED_OUTPUT_DEBUG_VERSION,
  createDevelopmentResponseValidator,
  type StructuredOutputDebugEnvironment,
  type StructuredOutputDebugReport,
} from '@brq/response-validator/development';

import type { ValidationRequest } from './contracts';
import { calculateCanonicalHash } from './hashing';
import { createResponseValidator } from './response-validator';
import { validationResultSchema } from './schemas';
import {
  contractFor,
  createJsonRunResult,
  deterministicNow,
  quietLogger,
} from './testing/response-validator-fixtures';

function requestWithSchema(
  schema: JsonObject,
  content: JsonValue,
  structuredData: JsonValue | null = content,
): ValidationRequest {
  const runResult = createJsonRunResult();
  if (runResult.outputContract.format !== 'JSON_SCHEMA') {
    throw new TypeError('Contrato JSON esperado.');
  }

  const outputContract = { ...runResult.outputContract, schema };
  const outputContractHash = calculateCanonicalHash(outputContract as unknown as JsonValue);
  const updated: AgentRunResult = {
    ...runResult,
    prompt: {
      ...runResult.prompt,
      metadata: { ...runResult.prompt.metadata, outputContractHash },
    },
    outputContract,
    output: {
      ...runResult.output,
      content: JSON.stringify(content),
      structuredData,
    },
  };

  return { runResult: updated, contract: contractFor(updated) };
}

function createDebugHarness(
  environment: StructuredOutputDebugEnvironment,
  reporter: (report: StructuredOutputDebugReport) => void | PromiseLike<void> = () => undefined,
  configuration?: { readonly maxIssues?: number },
) {
  return createDevelopmentResponseValidator({
    environment,
    reporter,
    logger: quietLogger(),
    now: deterministicNow(),
    ...(configuration === undefined ? {} : { configuration }),
  });
}

const REQUIRED_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['requiredValue'],
  properties: { requiredValue: { type: 'string' } },
};

describe('development-only structured output diagnostics', () => {
  it.each([
    [{}, 'missing environment values'],
    [{ NODE_ENV: 'test', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' }, 'test environment'],
    [
      { NODE_ENV: 'production', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      'production environment',
    ],
    [{ NODE_ENV: 'development' }, 'missing flag'],
    [
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'TRUE' },
      'non-exact flag casing',
    ],
    [{ NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: '1' }, 'non-exact flag value'],
  ] satisfies readonly (readonly [StructuredOutputDebugEnvironment, string])[])(
    'does not report with %s (%s)',
    (environment, label) => {
      const reporter = vi.fn().mockName(label);
      const result = createDebugHarness(environment, reporter).validate(
        requestWithSchema(REQUIRED_SCHEMA, {}),
      );

      expect(result.valid).toBe(false);
      expect(reporter).not.toHaveBeenCalled();
    },
  );

  it('reports only immutable allowlisted metadata and safe value types when explicitly enabled', () => {
    const reports: StructuredOutputDebugReport[] = [];
    const schema: JsonObject = {
      type: 'object',
      additionalProperties: false,
      required: [
        'missingValue',
        'nullValue',
        'arrayValue',
        'objectValue',
        'stringValue',
        'integerValue',
        'numberValue',
        'booleanValue',
        'patternValue',
      ],
      properties: {
        missingValue: { type: 'string' },
        nullValue: { type: 'string' },
        arrayValue: { type: 'string' },
        objectValue: { type: 'string' },
        stringValue: { type: 'integer' },
        integerValue: { type: 'string' },
        numberValue: { type: 'string' },
        booleanValue: { type: 'string' },
        patternValue: {
          type: 'string',
          pattern: '^NEVER_LOG_THIS_SCHEMA_PATTERN$',
        },
      },
    };
    const candidate = {
      nullValue: null,
      arrayValue: ['SECRET_ARRAY_VALUE'],
      objectValue: { private: 'SECRET_OBJECT_VALUE' },
      stringValue: 'SECRET_STRING_VALUE',
      integerValue: 7,
      numberValue: 1.5,
      booleanValue: true,
      patternValue: 'SECRET_PATTERN_VALUE',
    };

    const result = createDebugHarness(
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      (report) => {
        reports.push(report);
      },
    ).validate(requestWithSchema(schema, candidate));

    expect(result.valid).toBe(false);
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report).toMatchObject({
      diagnosticVersion: STRUCTURED_OUTPUT_DEBUG_VERSION,
      executionId: 'execution-1',
      agentExecutionId: 'agent-execution-1',
      requestId: 'request-1',
      traceId: 'trace-1',
      contract: {
        id: 'contract:generic-output',
        version: '1.0.0',
        contractHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        schemaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      responseHash: 'a'.repeat(64),
      issueCount: 9,
      issuesTruncated: false,
    });
    expect(
      Object.fromEntries(report.issues.map((issue) => [issue.instancePath, issue.foundType])),
    ).toEqual({
      '/missingValue': 'MISSING',
      '/nullValue': 'NULL',
      '/arrayValue': 'ARRAY',
      '/objectValue': 'OBJECT',
      '/stringValue': 'STRING',
      '/integerValue': 'INTEGER',
      '/numberValue': 'NUMBER',
      '/booleanValue': 'BOOLEAN',
      '/patternValue': 'STRING',
    });
    expect(report.issues.find((issue) => issue.keyword === 'pattern')).toMatchObject({
      sanitizedMessage: 'must match the configured pattern',
      schemaPath: '#/properties/patternValue/pattern',
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.contract)).toBe(true);
    expect(Object.isFrozen(report.issues)).toBe(true);
    expect(report.issues.every(Object.isFrozen)).toBe(true);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('SECRET_');
    expect(serialized).not.toContain('NEVER_LOG_THIS_SCHEMA_PATTERN');
    expect(serialized).not.toContain('"schema":');
    expect(serialized).not.toContain('structuredData');
    expect(serialized).not.toContain('content');
  });

  it('resolves escaped JSON Pointer segments without exposing the rejected value', () => {
    const reports: StructuredOutputDebugReport[] = [];
    const schema: JsonObject = {
      type: 'object',
      additionalProperties: false,
      required: ['a/b'],
      properties: {
        'a/b': {
          type: 'object',
          additionalProperties: false,
          required: ['x~y'],
          properties: { 'x~y': { type: 'integer' } },
        },
      },
    };

    createDebugHarness(
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      (report) => {
        reports.push(report);
      },
    ).validate(requestWithSchema(schema, { 'a/b': { 'x~y': 'SECRET_POINTER_VALUE' } }));

    expect(reports[0]?.issues).toEqual([
      expect.objectContaining({
        instancePath: '/a~1b/x~0y',
        schemaPath: '#/properties/a~1b/properties/x~0y/type',
        keyword: 'type',
        foundType: 'STRING',
      }),
    ]);
    expect(JSON.stringify(reports)).not.toContain('SECRET_POINTER_VALUE');
  });

  it('uses the safe root sentinel and never reports an additional property name or value', () => {
    const reports: StructuredOutputDebugReport[] = [];
    const validator = createDebugHarness(
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      (report) => {
        reports.push(report);
      },
    );

    validator.validate(
      requestWithSchema(
        { type: 'object', additionalProperties: false, properties: {} },
        { SECRET_ADDITIONAL_PROPERTY: 'SECRET_ADDITIONAL_VALUE' },
      ),
    );

    expect(reports[0]?.issues).toEqual([
      expect.objectContaining({
        instancePath: '/',
        schemaPath: '#/additionalProperties',
        keyword: 'additionalProperties',
        foundType: 'OBJECT',
        sanitizedMessage: 'must not contain properties outside the configured schema',
      }),
    ]);
    expect(JSON.stringify(reports)).not.toContain('SECRET_ADDITIONAL');
  });

  it('keeps the public result and every deterministic hash identical with diagnostics on or off', () => {
    const request = requestWithSchema(REQUIRED_SCHEMA, {});
    const standard = createResponseValidator({
      logger: quietLogger(),
      now: deterministicNow(),
    }).validate(request);
    const reporter = vi.fn();
    const diagnostic = createDebugHarness(
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      reporter,
    ).validate(request);

    expect(diagnostic).toEqual(standard);
    expect(diagnostic.metadata.validationHash).toBe(standard.metadata.validationHash);
    expect(validationResultSchema.safeParse(diagnostic).success).toBe(true);
    expect(diagnostic).not.toHaveProperty('diagnostics');
    expect(JSON.stringify(diagnostic)).not.toContain('foundType');
    expect(JSON.stringify(diagnostic)).not.toContain('sanitizedMessage');
    expect(reporter).toHaveBeenCalledOnce();
  });

  it('does not emit a diagnostic report for non-schema rejection classes', () => {
    const reporter = vi.fn();
    const validator = createDebugHarness(
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      reporter,
    );
    const malformed = createJsonRunResult({ content: '{', structuredData: null });

    const result = validator.validate({ runResult: malformed, contract: contractFor(malformed) });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe('MALFORMED_JSON');
    expect(reporter).not.toHaveBeenCalled();
  });

  it('diagnoses structuredData schema mismatches without trusting or exposing structuredData', () => {
    const reports: StructuredOutputDebugReport[] = [];
    const schema: JsonObject = {
      type: 'object',
      additionalProperties: false,
      required: ['summary'],
      properties: { summary: { type: 'string' } },
    };
    const request = requestWithSchema(
      schema,
      { summary: 'accepted' },
      { summary: 42, private: 'SECRET_STRUCTURED_DATA' },
    );

    const result = createDebugHarness(
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      (report) => {
        reports.push(report);
      },
    ).validate(request);

    expect(result.valid).toBe(false);
    expect(reports[0]?.issues.map((issue) => issue.code)).toEqual([
      'STRUCTURED_DATA_SCHEMA_MISMATCH',
      'STRUCTURED_DATA_SCHEMA_MISMATCH',
    ]);
    expect(reports[0]?.issues.map((issue) => issue.keyword)).toEqual(
      expect.arrayContaining(['additionalProperties', 'type']),
    );
    expect(reports[0]?.issueCount).toBe(2);
    expect(reports[0]?.issues).toHaveLength(2);
    expect(result.issues).toHaveLength(3);
    expect(JSON.stringify(reports)).not.toContain('SECRET_STRUCTURED_DATA');
  });

  it('caps diagnostics with the functional issue budget and preserves truncation', () => {
    const reports: StructuredOutputDebugReport[] = [];
    const schema: JsonObject = {
      type: 'object',
      required: ['a', 'b', 'c'],
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
      },
    };

    const result = createDebugHarness(
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      (report) => {
        reports.push(report);
      },
      { maxIssues: 1 },
    ).validate(requestWithSchema(schema, {}));

    expect(result.issues).toHaveLength(1);
    expect(result.metadata.issuesTruncated).toBe(true);
    expect(reports[0]).toMatchObject({ issueCount: 1, issuesTruncated: true });
    expect(reports[0]?.issues).toHaveLength(1);
  });

  it('keeps validation fail-open for synchronous and asynchronous reporter failures', async () => {
    const synchronous = createDebugHarness(
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      () => {
        throw new Error('REPORTER_SECRET_FAILURE');
      },
    );
    const asynchronous = createDebugHarness(
      { NODE_ENV: 'development', AI_FACTORY_STRUCTURED_OUTPUT_DEBUG: 'true' },
      async () => Promise.reject(new Error('ASYNC_REPORTER_SECRET_FAILURE')),
    );
    const request = requestWithSchema(REQUIRED_SCHEMA, {});

    expect(() => synchronous.validate(request)).not.toThrow();
    expect(() => asynchronous.validate(request)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('keeps the production root entrypoint free of development diagnostics', async () => {
    expect(productionApi).not.toHaveProperty('createDevelopmentResponseValidator');
    expect(productionApi).not.toHaveProperty('STRUCTURED_OUTPUT_DEBUG_VERSION');

    const developmentApi = await import('@brq/response-validator/development');
    expect(developmentApi.createDevelopmentResponseValidator).toBeTypeOf('function');
    expect(developmentApi.STRUCTURED_OUTPUT_DEBUG_VERSION).toBe('1.0.0');
  });
});
