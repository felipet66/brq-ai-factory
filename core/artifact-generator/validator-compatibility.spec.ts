import { agentRunResultSchema, type AgentRunResult } from '@brq/agent-runner';
import { calculatePromptHash, canonicalizeJson } from '@brq/prompt-builder';
import { createResponseValidator, type ValidationContract } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { createArtifactGenerator } from './artifact-generator';
import {
  createArtifactSpecification,
  createSummaryTemplate,
} from './testing/artifact-generator-fixtures';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function createRealValidationResult() {
  const outputContract = {
    id: 'contract:validator-generator-compatibility',
    version: '1.0.0',
    format: 'JSON_SCHEMA' as const,
    instructions: ['Retorne um objeto JSON conforme o schema.'],
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary'],
      properties: { summary: { type: 'string', minLength: 1 } },
    },
  };
  const outputContractHash = calculatePromptHash(
    canonicalizeJson(outputContract as unknown as JsonValue),
  );
  const data = { summary: 'Valor validado pela fronteira pública.' };
  const runResult = agentRunResultSchema.parse({
    context: {
      execution: {
        executionId: 'execution-contract-test',
        agentExecutionId: 'agent-execution-contract-test',
        agent: 'DEVELOPER',
        attempt: 1,
        agentVersion: '1.0.0',
      },
      requestId: 'request-contract-test',
      traceId: 'trace-contract-test',
    },
    prompt: {
      metadata: {
        promptId: 'prompt:contract-test',
        agent: 'DEVELOPER',
        version: '1.0.0',
        schemaVersion: '1.0.0',
        templateHash: HASH_A,
        promptHash: HASH_B,
        instructionsHash: HASH_A,
        inputHash: HASH_B,
        outputContractHash,
        sectionHashes: [],
        ruleSetHashes: [],
        contextHashes: [],
      },
      budget: {
        maxBytes: 4_096,
        usedBytes: 256,
        instructionsBytes: 128,
        inputBytes: 64,
        outputContractBytes: 64,
      },
    },
    outputContract,
    output: {
      content: JSON.stringify(data),
      structuredData: data,
      finishReason: 'COMPLETED',
      responseHash: HASH_A,
    },
    provider: {
      provider: 'fake',
      requestedModel: 'test-model',
      responseModel: 'test-model-v1',
      responseId: 'response-contract-test',
    },
    metrics: {
      observed: {
        totalDurationMs: 30,
        promptBuilderDurationMs: 10,
        providerDurationMs: 20,
        bytesSent: 200,
        bytesReceived: 100,
      },
      reported: {
        durationMs: 18,
        attempts: 1,
        usage: { inputTokens: 20, outputTokens: 10 },
      },
    },
  }) as AgentRunResult;
  const contract: ValidationContract = {
    id: outputContract.id,
    version: outputContract.version,
    format: outputContract.format,
    dialect: 'DRAFT_2020_12',
    schema: outputContract.schema,
    expectedOutputContractHash: outputContractHash,
  };
  const logger = createLogger({ sink: () => undefined });

  return createResponseValidator({ logger, now: () => 0 }).validate({ runResult, contract });
}

describe('Response Validator to Artifact Generator contract', () => {
  it('accepts a ValidationResult and validatedValueHash produced by the public Validator API', () => {
    const validation = createRealValidationResult();
    const specification = createArtifactSpecification({
      sourceContract: validation.metadata.contract,
      templates: [
        createSummaryTemplate({
          bindings: [{ id: 'summary', path: ['summary'] }],
          fragments: [{ kind: 'BINDING', bindingId: 'summary', serialization: 'TEXT' }],
        }),
      ],
    });
    const result = createArtifactGenerator({
      logger: createLogger({ sink: () => undefined }),
    }).generate({
      validation,
      specification,
    });

    expect(validation.valid).toBe(true);
    expect(result.artifacts[0]?.draft.content).toBe('Valor validado pela fronteira pública.');
    expect(result.metadata.source.validatedValueHash).toBe(validation.metadata.validatedValueHash);
  });
});
