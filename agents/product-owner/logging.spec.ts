import type { AgentRunResult } from '@brq/agent-runner';
import { createArtifactGenerator } from '@brq/artifact-generator';
import type { KnowledgeContext } from '@brq/knowledge-loader';
import type { ValidationResult } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { createJsonRunResult } from '../../core/response-validator/testing/response-validator-fixtures';
import {
  createArtifactGenerationRequest,
  createArtifactSpecification,
  createSummaryTemplate,
  createValidatedJsonResult,
} from '../../core/artifact-generator/testing/artifact-generator-fixtures';
import type { ProductOwnerBusinessValidationResult } from './contracts';
import { PRODUCT_OWNER_AGENT_ERROR_CODES, ProductOwnerAgentError } from './errors';
import {
  businessValidationLogContext,
  errorLogContext,
  generationLogContext,
  knowledgeLogContext,
  requestLogContext,
  responseValidationLogContext,
  runLogContext,
} from './logging';
import { loadProductOwnerPromptAssets } from './prompt-assets';
import { createProductOwnerRequest } from './testing/product-owner-fixtures';

const SECRET = 'sk-logging-private-marker-9173';
const HASH = 'a'.repeat(64);

function allKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value === null || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, nestedValue]) => [key, ...allKeys(nestedValue)]);
}

function containsError(value: unknown): boolean {
  if (value instanceof Error) return true;
  if (Array.isArray(value)) return value.some(containsError);
  if (value === null || typeof value !== 'object') return false;
  return Object.values(value).some(containsError);
}

function sensitiveKnowledgeContext(): KnowledgeContext {
  return {
    context: 'PRODUCT_OWNER',
    manifestVersion: '1.0.0',
    policyVersion: '1.0.0',
    sourceId: 'knowledge-source-1',
    content: SECRET,
    contextHash: `sha256:${HASH}`,
    includedDocuments: [],
    ignoredDocuments: [],
    missingDocuments: [],
    budget: {
      maxDocuments: 10,
      maxBytes: 10_000,
      usedDocuments: 0,
      usedBytes: Buffer.byteLength(SECRET),
    },
  };
}

describe('Product Owner Agent logging', () => {
  it('projects only allowlisted technical metadata from every pipeline boundary', () => {
    const request = createProductOwnerRequest({
      demand: {
        title: SECRET,
        description: SECRET,
        constraints: [SECRET],
      },
      additionalContext: SECRET,
    });
    const assets = loadProductOwnerPromptAssets();
    const run: AgentRunResult = {
      ...createJsonRunResult({ content: SECRET, structuredData: { private: SECRET } }),
      outputContract: {
        id: 'contract:sensitive',
        version: '1.0.0',
        format: 'JSON_SCHEMA',
        instructions: [SECRET],
        schema: { description: SECRET },
      },
    };
    const responseValidation: ValidationResult = {
      ...createValidatedJsonResult({ private: SECRET }),
      issues: [
        {
          code: 'STRUCTURED_DATA_UNAVAILABLE',
          severity: 'WARNING',
          category: 'INTEGRITY',
          message: SECRET,
          instancePath: `/${SECRET}`,
          schemaPath: `#/${SECRET}`,
        },
      ],
    };
    const businessValidation: ProductOwnerBusinessValidationResult = {
      valid: false,
      expectedReadiness: 'READY',
      issuesTruncated: false,
      issues: [
        {
          code: 'PRODUCT_OWNER_READINESS_MISMATCH',
          path: [SECRET],
          message: SECRET,
        },
      ],
    };
    const generationValidation = createValidatedJsonResult({
      summary: { title: 'Title', body: SECRET },
      details: [],
    });
    const generation = createArtifactGenerator({
      logger: createLogger({ sink: () => undefined }),
    }).generate(
      createArtifactGenerationRequest({
        validation: generationValidation,
        specification: createArtifactSpecification({
          sourceContract: generationValidation.metadata.contract,
          templates: [
            createSummaryTemplate({
              name: SECRET,
              fragments: [{ kind: 'LITERAL', value: SECRET }],
              bindings: [],
            }),
          ],
        }),
      }),
    );
    const rawError = new Error(SECRET);
    rawError.stack = SECRET;
    const error = new ProductOwnerAgentError('Technical failure without payload.', {
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.RUN_FAILED,
      stage: 'RUNNER_EXECUTION',
      durationMs: 42,
      executionId: 'execution-1',
      agentExecutionId: 'agent-execution-1',
      requestId: 'request-1',
      traceId: 'trace-1',
      sourceCode: 'AI_PROVIDER_UNAVAILABLE',
      cause: rawError,
    });
    const contexts = [
      requestLogContext(request, assets),
      knowledgeLogContext(sensitiveKnowledgeContext()),
      runLogContext(run),
      responseValidationLogContext(responseValidation),
      businessValidationLogContext(businessValidation),
      generationLogContext(generation),
      errorLogContext(error),
    ];
    const forbiddenKeys = [
      'demand',
      'additionalContext',
      'content',
      'prompt',
      'response',
      'specification',
      'schema',
      'rules',
      'ruleSets',
      'cause',
      'stack',
      'message',
    ];

    expect(contexts[0]).toMatchObject({
      deliveryIntentVersion: '1.0.0',
      deliveryMode: 'GREENFIELD',
    });
    expect(JSON.stringify(contexts)).not.toContain(SECRET);
    expect(contexts.some(containsError)).toBe(false);
    expect(allKeys(contexts)).not.toEqual(expect.arrayContaining(forbiddenKeys));
  });

  it('emits sanitized JSON without raw content, rules, schemas, secrets or Error objects', () => {
    const lines: string[] = [];
    const logger = createLogger({
      sink: (line) => lines.push(line),
      now: () => new Date('2026-08-05T12:00:00.000Z'),
    });
    const request = createProductOwnerRequest({
      demand: { title: SECRET, description: SECRET },
      additionalContext: SECRET,
    });
    const error = new ProductOwnerAgentError('Safe technical failure.', {
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.RUN_FAILED,
      stage: 'RUNNER_EXECUTION',
      durationMs: 12,
      executionId: request.context.executionId,
      agentExecutionId: request.context.agentExecutionId,
      ...(request.context.requestId === undefined ? {} : { requestId: request.context.requestId }),
      ...(request.context.traceId === undefined ? {} : { traceId: request.context.traceId }),
      cause: new Error(SECRET),
    });

    logger.info(
      'product_owner.agent.started',
      requestLogContext(request, loadProductOwnerPromptAssets()),
    );
    logger.error('product_owner.agent.failed', errorLogContext(error));

    const serialized = lines.join('\n');
    expect(lines.map((line) => JSON.parse(line).event)).toEqual([
      'product_owner.agent.started',
      'product_owner.agent.failed',
    ]);
    expect(serialized).toContain(PRODUCT_OWNER_AGENT_ERROR_CODES.RUN_FAILED);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('demand');
    expect(serialized).not.toContain('additionalContext');
    expect(serialized).not.toContain('cause');
    expect(serialized).not.toContain('stack');
  });

  it('drops arbitrary source codes instead of treating uppercase text as safe metadata', () => {
    const error = new ProductOwnerAgentError('Safe technical failure.', {
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.RUN_FAILED,
      stage: 'RUNNER_EXECUTION',
      durationMs: 12,
      sourceCode: 'SK_PRIVATE_MARKER_9173',
    });

    expect(error.sourceCode).toBeUndefined();
    expect(errorLogContext(error)).not.toHaveProperty('sourceCode');
  });
});
