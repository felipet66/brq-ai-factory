import type { AgentRunResult } from '@brq/agent-runner';
import { createLogger, type Logger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { ValidationContract } from '../contracts';
import { calculateCanonicalHash } from '../hashing';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const JSON_OUTPUT_CONTRACT = {
  id: 'contract:generic-output',
  version: '1.0.0',
  format: 'JSON_SCHEMA' as const,
  instructions: ['Retorne um objeto JSON válido.'],
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary'],
    properties: { summary: { type: 'string', minLength: 1 } },
  },
};

const TEXT_OUTPUT_CONTRACT = {
  id: 'contract:text-output',
  version: '1.0.0',
  format: 'TEXT' as const,
  instructions: ['Retorne texto não vazio.'],
};

function baseRunResult(
  outputContract: AgentRunResult['outputContract'],
  output: AgentRunResult['output'],
): AgentRunResult {
  const outputContractHash = calculateCanonicalHash(outputContract as unknown as JsonValue);

  return {
    context: {
      execution: {
        executionId: 'execution-1',
        agentExecutionId: 'agent-execution-1',
        agent: 'DEVELOPER',
        attempt: 1,
        agentVersion: '1.0.0',
      },
      requestId: 'request-1',
      traceId: 'trace-1',
    },
    prompt: {
      metadata: {
        promptId: 'prompt:developer',
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
    output,
    provider: {
      provider: 'fake',
      requestedModel: 'test-model',
      responseModel: 'test-model-v1',
      responseId: 'response-1',
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
  };
}

export function createJsonRunResult(
  output: Partial<AgentRunResult['output']> = {},
): AgentRunResult {
  return baseRunResult(JSON_OUTPUT_CONTRACT, {
    content: JSON.stringify({ summary: 'ok' }),
    structuredData: { summary: 'ok' },
    finishReason: 'COMPLETED',
    responseHash: HASH_A,
    ...output,
  });
}

export function createTextRunResult(
  output: Partial<AgentRunResult['output']> = {},
): AgentRunResult {
  return baseRunResult(TEXT_OUTPUT_CONTRACT, {
    content: '  Resultado preservado.  ',
    structuredData: null,
    finishReason: 'COMPLETED',
    responseHash: HASH_B,
    ...output,
  });
}

export function contractFor(runResult: AgentRunResult): ValidationContract {
  const outputContract = runResult.outputContract;
  const base = {
    id: outputContract.id,
    version: outputContract.version,
    expectedOutputContractHash: runResult.prompt.metadata.outputContractHash,
  };

  return outputContract.format === 'TEXT'
    ? { ...base, format: 'TEXT' }
    : {
        ...base,
        format: 'JSON_SCHEMA',
        dialect: 'DRAFT_2020_12',
        schema: outputContract.schema,
      };
}

export function quietLogger(lines: string[] = []): Logger {
  return createLogger({
    sink: (line) => lines.push(line),
    now: () => new Date('2026-08-05T12:00:00.000Z'),
  });
}

export function deterministicNow(step = 10): () => number {
  let value = 0;
  return () => {
    const current = value;
    value += step;
    return current;
  };
}
