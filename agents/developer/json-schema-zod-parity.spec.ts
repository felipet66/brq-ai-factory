import type { AgentRunResult } from '@brq/agent-runner';
import { createResponseValidator } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';
import type { JsonObject, JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { loadDeveloperPromptAssets } from './prompt-assets';
import { technicalSpecificationSchema } from './schemas';
import { createTechnicalSpecification } from './testing/developer-fixtures';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const MODULE_PATH_MAX_CHARACTERS = 512;
const TITLE_MAX_CHARACTERS = 160;
const DESCRIPTION_MAX_CHARACTERS = 2_000;

const assets = loadDeveloperPromptAssets();
const responseValidator = createResponseValidator({
  logger: createLogger({ sink: () => undefined }),
  now: () => 0,
});

function asObject(value: JsonValue | undefined, name: string): JsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`Expected ${name} to be a JSON object.`);
  }
  return value;
}

function asArray(value: JsonValue | undefined, name: string): JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError(`Expected ${name} to be a JSON array.`);
  return value;
}

function baseSpecification(): JsonObject {
  return structuredClone(createTechnicalSpecification()) as unknown as JsonObject;
}

function withTopLevel(overrides: JsonObject): JsonObject {
  return { ...baseSpecification(), ...overrides };
}

function withFirstCollectionItem(collectionName: string, overrides: JsonObject): JsonObject {
  const specification = baseSpecification();
  const collection = asArray(specification[collectionName], collectionName);
  const first = asObject(collection[0], `${collectionName}[0]`);

  return {
    ...specification,
    [collectionName]: [{ ...first, ...overrides }, ...collection.slice(1)],
  };
}

function withArchitecture(overrides: JsonObject): JsonObject {
  const specification = baseSpecification();
  const architecture = asObject(specification['architecture'], 'architecture');
  return { ...specification, architecture: { ...architecture, ...overrides } };
}

function withFirstFlowStep(overrides: JsonObject): JsonObject {
  const specification = baseSpecification();
  const flows = asArray(specification['flows'], 'flows');
  const firstFlow = asObject(flows[0], 'flows[0]');
  const steps = asArray(firstFlow['steps'], 'flows[0].steps');
  const firstStep = asObject(steps[0], 'flows[0].steps[0]');

  return {
    ...specification,
    flows: [
      {
        ...firstFlow,
        steps: [{ ...firstStep, ...overrides }, ...steps.slice(1)],
      },
      ...flows.slice(1),
    ],
  };
}

function runResult(candidate: JsonValue): AgentRunResult {
  const content = JSON.stringify(candidate);

  return {
    context: {
      execution: {
        executionId: 'execution-developer-schema-parity',
        agentExecutionId: 'agent-execution-developer-schema-parity',
        agent: 'DEVELOPER',
        attempt: 1,
        agentVersion: '1.0.0',
      },
      requestId: 'request-developer-schema-parity',
      traceId: 'trace-developer-schema-parity',
    },
    prompt: {
      metadata: {
        promptId: assets.template.id,
        agent: assets.template.agent,
        version: assets.template.version,
        schemaVersion: assets.template.schemaVersion,
        templateHash: assets.hashes.templateHash,
        promptHash: HASH_A,
        instructionsHash: HASH_B,
        inputHash: HASH_C,
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
      responseHash: HASH_B,
    },
    provider: {
      provider: 'fake',
      requestedModel: 'fake-model',
      responseModel: 'fake-model',
      responseId: 'fake-developer-schema-parity-response',
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

function validationDecisions(candidate: JsonValue): {
  readonly jsonSchema: boolean;
  readonly zod: boolean;
} {
  const jsonSchema = responseValidator.validate({
    runResult: runResult(candidate),
    contract: assets.validationContract,
  }).valid;
  const zod = technicalSpecificationSchema.safeParse(candidate).success;
  return { jsonSchema, zod };
}

function expectParity(candidate: JsonValue, expected: boolean): void {
  expect(validationDecisions(candidate)).toEqual({ jsonSchema: expected, zod: expected });
}

describe('Developer JSON Schema and Zod parity', () => {
  describe('accepted contract boundaries', () => {
    it('accepts the complete canonical TechnicalSpecification fixture', () => {
      expect(assets.manifest.version).toBe('1.0.3');
      expectParity(baseSpecification(), true);
    });

    it.each([
      ['a simple relative module path', withFirstCollectionItem('modules', { path: 'core' })],
      [
        'a multi-segment relative module path',
        withFirstCollectionItem('modules', { path: 'core/order-query' }),
      ],
      [
        'a module path at its maximum length',
        withFirstCollectionItem('modules', { path: 'x'.repeat(MODULE_PATH_MAX_CHARACTERS) }),
      ],
      ['a title at its minimum length', withTopLevel({ title: 'x' })],
      ['a title at its maximum length', withTopLevel({ title: 'x'.repeat(TITLE_MAX_CHARACTERS) })],
      ['minimum story points', withTopLevel({ estimatedStoryPoints: 1 })],
      ['maximum story points', withTopLevel({ estimatedStoryPoints: 100 })],
      ['minimum flow-step order', withFirstFlowStep({ order: 1 })],
      ['maximum safe flow-step order', withFirstFlowStep({ order: Number.MAX_SAFE_INTEGER })],
      [
        'maximum safe implementation-phase order',
        withFirstCollectionItem('implementationPhases', { order: Number.MAX_SAFE_INTEGER }),
      ],
      [
        'maximum safe implementation-plan order',
        withFirstCollectionItem('implementationPlan', { order: Number.MAX_SAFE_INTEGER }),
      ],
    ])('accepts %s', (_name, candidate) => {
      expectParity(candidate, true);
    });
  });

  describe('rejected contract boundaries', () => {
    it.each([
      [
        'a module path above its maximum length',
        withFirstCollectionItem('modules', {
          path: 'x'.repeat(MODULE_PATH_MAX_CHARACTERS + 1),
        }),
      ],
      ['a title above its maximum length', withTopLevel({ title: 'x'.repeat(161) })],
      [
        'a description above its maximum length',
        withFirstCollectionItem('modules', {
          responsibility: 'x'.repeat(DESCRIPTION_MAX_CHARACTERS + 1),
        }),
      ],
      ['story points below the minimum', withTopLevel({ estimatedStoryPoints: 0 })],
      ['story points above the maximum', withTopLevel({ estimatedStoryPoints: 101 })],
      ['a zero flow-step order', withFirstFlowStep({ order: 0 })],
      ['a fractional flow-step order', withFirstFlowStep({ order: 1.5 })],
      ['an unknown top-level property', withTopLevel({ sourceCode: 'not allowed' })],
      ['an unknown nested property', withArchitecture({ tests: ['not allowed'] })],
      ['an invalid top-level enum', withTopLevel({ complexity: 'EXTREME' })],
      ['an invalid nested enum', withFirstCollectionItem('apis', { method: 'TRACE' })],
      ['an absolute module path', withFirstCollectionItem('modules', { path: '/absolute/path' })],
      ['a drive-prefixed module path', withFirstCollectionItem('modules', { path: 'C:/core' })],
      ['a leading traversal segment', withFirstCollectionItem('modules', { path: '../escape' })],
      [
        'an internal traversal segment',
        withFirstCollectionItem('modules', { path: 'core/../escape' }),
      ],
      ['a backslash separator', withFirstCollectionItem('modules', { path: 'core\\module' })],
      ['an empty middle segment', withFirstCollectionItem('modules', { path: 'core//module' })],
      ['an empty final segment', withFirstCollectionItem('modules', { path: 'core/' })],
      ['a current-directory segment', withFirstCollectionItem('modules', { path: '.' })],
      ['a parent-directory segment', withFirstCollectionItem('modules', { path: '..' })],
      [
        'a control character in a module path',
        withFirstCollectionItem('modules', { path: 'core/\u0000module' }),
      ],
      ['an unsafe flow-step order', withFirstFlowStep({ order: Number.MAX_SAFE_INTEGER + 1 })],
      [
        'an unsafe implementation-phase order',
        withFirstCollectionItem('implementationPhases', {
          order: Number.MAX_SAFE_INTEGER + 1,
        }),
      ],
      [
        'an unsafe implementation-plan order',
        withFirstCollectionItem('implementationPlan', { order: Number.MAX_SAFE_INTEGER + 1 }),
      ],
    ])('rejects %s', (_name, candidate) => {
      expectParity(candidate, false);
    });
  });

  describe('documented JSON Schema semantic limitations', () => {
    // JSON Schema pattern cannot assert Unicode normalization form. The prompt states NFC
    // normatively and the public Zod schema remains the authoritative final guard.
    it('documents the remaining NFC normalization limitation for module paths', () => {
      const path = 'cafe\u0301';
      expect(validationDecisions(withFirstCollectionItem('modules', { path }))).toEqual({
        jsonSchema: true,
        zod: false,
      });
    });

    // Draft 2020-12 maxLength counts Unicode code points, while JavaScript/Zod counts UTF-16
    // code units. The divergence is pinned so it cannot become an accidental contract promise.
    it('documents Unicode length semantics at the transport boundary', () => {
      expect(
        validationDecisions(withTopLevel({ title: '😀'.repeat(TITLE_MAX_CHARACTERS) })),
      ).toEqual({ jsonSchema: true, zod: false });
    });
  });
});
