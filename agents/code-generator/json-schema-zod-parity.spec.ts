import type { AgentRunResult } from '@brq/agent-runner';
import { createResponseValidator } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import type { JsonObject, JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { loadCodeGeneratorPromptAssets } from './prompt-assets';
import { generatedCodeProposalSchema } from './schemas';
import { createGeneratedCodeProposal } from './testing/code-generator-fixtures';

const assets = loadCodeGeneratorPromptAssets();
const validator = createResponseValidator({
  logger: createLogger({ sink: () => undefined }),
  now: () => 0,
});

function runResult(candidate: JsonValue): AgentRunResult {
  const content = JSON.stringify(candidate);
  return {
    context: {
      execution: {
        executionId: 'execution-code-generator-schema-parity',
        agentExecutionId: 'agent-execution-code-generator-schema-parity',
        agent: 'CODE_GENERATOR',
        attempt: 1,
        agentVersion: '1.0.0',
      },
    },
    prompt: {
      metadata: {
        promptId: assets.template.id,
        agent: 'CODE_GENERATOR',
        version: assets.template.version,
        schemaVersion: assets.template.schemaVersion,
        templateHash: assets.hashes.templateHash,
        promptHash: '1'.repeat(64),
        instructionsHash: '2'.repeat(64),
        inputHash: '3'.repeat(64),
        outputContractHash: assets.hashes.outputContractHash,
        sectionHashes: [],
        ruleSetHashes: [],
        contextHashes: [],
      },
      budget: {
        maxBytes: 3,
        usedBytes: 3,
        instructionsBytes: 1,
        inputBytes: 1,
        outputContractBytes: 1,
      },
    },
    outputContract: assets.outputContract,
    output: {
      content,
      structuredData: structuredClone(candidate),
      finishReason: 'COMPLETED',
      responseHash: '4'.repeat(64),
    },
    provider: {
      provider: 'fake',
      requestedModel: 'fake-model',
      responseModel: 'fake-model',
      responseId: 'fake-code-generator-schema-parity',
    },
    metrics: {
      observed: {
        totalDurationMs: 0,
        promptBuilderDurationMs: 0,
        providerDurationMs: 0,
        bytesSent: 0,
        bytesReceived: Buffer.byteLength(content, 'utf8'),
      },
      reported: {
        durationMs: 0,
        attempts: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    },
  };
}

function decisions(candidate: JsonValue) {
  return {
    jsonSchema: validator.validate({
      runResult: runResult(candidate),
      contract: assets.validationContract,
    }).valid,
    zod: generatedCodeProposalSchema.safeParse(candidate).success,
  };
}

function expectParity(candidate: JsonValue, expected: boolean): void {
  expect(decisions(candidate)).toEqual({ jsonSchema: expected, zod: expected });
}

function base(): JsonObject {
  return structuredClone(createGeneratedCodeProposal()) as unknown as JsonObject;
}

function firstFile(overrides: JsonObject): JsonObject {
  const candidate = base();
  const files = candidate['files'] as JsonObject[];
  return { ...candidate, files: [{ ...files[0]!, ...overrides }] };
}

describe('Code Generator JSON Schema and Zod parity', () => {
  it('accepts the canonical proposal and an empty files array structurally', () => {
    expectParity(base(), true);
    expectParity({ ...base(), files: [] }, true);
  });

  it.each([
    ['unknown root property', { ...base(), hashes: {} }],
    ['unknown file property', firstFile({ byteLength: 10 })],
    ['invalid encoding', firstFile({ encoding: 'BASE64' })],
    ['unsupported media type', firstFile({ mediaType: 'application/octet-stream' })],
    ['unsupported purpose', firstFile({ purpose: 'BINARY' })],
    ['invalid module reference shape', firstFile({ sourceModuleIds: ['MODULE-001'] })],
    ['invalid plan reference shape', firstFile({ sourcePlanItemIds: ['ITEM-001'] })],
    ['empty entrypoints', { ...base(), entrypoints: [] }],
    ['too many entrypoints', { ...base(), entrypoints: Array(17).fill('index.ts') }],
    ['content above the structural ceiling', firstFile({ content: 'x'.repeat(65_537) })],
  ])('rejects %s in both contracts', (_name, candidate) => {
    expectParity(candidate as JsonValue, false);
  });

  it('keeps collection ceilings aligned', () => {
    const file = (base()['files'] as JsonObject[])[0]!;
    expectParity({ ...base(), files: Array.from({ length: 97 }, () => file) }, false);
    expectParity({ ...base(), files: Array.from({ length: 96 }, () => file) }, true);
  });

  it('documents that byte validation remains authoritative after structural character validation', () => {
    const candidate = firstFile({ content: '界'.repeat(30_000) });
    expect(decisions(candidate)).toEqual({ jsonSchema: true, zod: true });
    expect(Buffer.byteLength('界'.repeat(30_000), 'utf8')).toBeGreaterThan(65_536);
  });
});
