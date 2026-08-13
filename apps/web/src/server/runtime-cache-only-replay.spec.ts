// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  calculateAIResponseHash,
  type AIResponseCache,
  type AIResponseCacheCompleteInput,
  type AIResponseCacheEntry,
  type AIResponseCacheKey,
} from '@brq/ai-provider';
import { FakeAIProvider } from '@brq/ai-provider/fake';
import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import { deriveExecutionIdentity } from '@brq/execution-engine';
import { createRerunExecutionRequest } from '@brq/execution-worker';
import { createInMemoryFactoryExecutionHistory } from '@brq/observability';
import {
  DEFAULT_SANDBOX_LIMITS,
  finalizeSandboxRunResult,
  type SandboxRunRequest,
} from '@brq/sandbox-runner';
import {
  createSandboxRuntimeObservationFixture,
  createSandboxStepResultsFixture,
} from '@brq/sandbox-runner/testing';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it, vi } from 'vitest';

import {
  createCodeGeneratorAIResponse,
  createCodeGeneratorTechnicalSpecification,
  createGeneratedCodeProposal,
} from '../../../../agents/code-generator/testing/code-generator-fixtures';
import { createDeveloperAIResponse } from '../../../../agents/developer/testing/developer-fixtures';
import {
  createProductOwnerAIResponse,
  createProductOwnerSpecification,
} from '../../../../agents/product-owner/testing/product-owner-fixtures';
import { createExecutionRequestFixture } from '../../../../core/execution-engine/testing/execution-engine-fixtures';
import { FACTORY_SANDBOX_POLICY } from './factory-sandbox-runtime-configuration';
import { createApplicationFactoryRuntime } from './runtime';

const REPLAY_B_ID = '11111111-1111-4111-8111-111111111111';
const REPLAY_C_ID = '22222222-2222-4222-8222-222222222222';
const CACHED_AGENTS = ['PRODUCT_OWNER', 'DEVELOPER', 'CODE_GENERATOR'] as const;

function sameCoordinates(left: AIResponseCacheKey, right: AIResponseCacheKey): boolean {
  return (
    left.executionId === right.executionId &&
    left.agent === right.agent &&
    left.provider === right.provider &&
    left.requestHash === right.requestHash
  );
}

function createAtomicMemoryCache(): AIResponseCache & {
  readonly entries: Map<string, AIResponseCacheEntry>;
} {
  const entries = new Map<string, AIResponseCacheEntry>();
  const claims = new Map<string, { key: AIResponseCacheKey; claimToken: string }>();
  let sequence = 0;
  const id = (value: Pick<AIResponseCacheKey, 'executionId' | 'agent'>): string =>
    `${value.executionId}:${value.agent}`;

  return {
    entries,
    async get(key) {
      const entry = entries.get(id(key));
      return entry !== undefined && sameCoordinates(entry, key) ? structuredClone(entry) : null;
    },
    async claim(key) {
      const checkpointId = id(key);
      const entry = entries.get(checkpointId);
      if (entry !== undefined) {
        if (!sameCoordinates(entry, key)) throw new Error('completed checkpoint conflict');
        return structuredClone({ status: 'COMPLETED' as const, entry });
      }
      const pending = claims.get(checkpointId);
      if (pending !== undefined) {
        if (!sameCoordinates(pending.key, key)) throw new Error('pending checkpoint conflict');
        return structuredClone({ status: 'IN_PROGRESS' as const, ...key });
      }
      const claimToken = `claim-${++sequence}`;
      claims.set(checkpointId, { key: structuredClone(key), claimToken });
      return structuredClone({ status: 'CLAIMED' as const, ...key, claimToken });
    },
    async complete(input: AIResponseCacheCompleteInput) {
      const checkpointId = id(input);
      const claim = claims.get(checkpointId);
      if (claim?.claimToken !== input.claimToken || !sameCoordinates(claim.key, input)) {
        throw new Error('claim owner mismatch');
      }
      const entry: AIResponseCacheEntry = {
        executionId: input.executionId,
        agent: input.agent,
        provider: input.provider,
        requestHash: input.requestHash,
        responseHash: calculateAIResponseHash(input.response),
        response: structuredClone(input.response),
      };
      claims.delete(checkpointId);
      entries.set(checkpointId, entry);
      return structuredClone(entry);
    },
    async fail(input) {
      const checkpointId = id(input);
      const claim = claims.get(checkpointId);
      if (claim?.claimToken === input.claimToken && sameCoordinates(claim.key, input)) {
        claims.delete(checkpointId);
      }
    },
  };
}

function codeProposal() {
  return createGeneratedCodeProposal({
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html><html><body><script type="module" src="./core/order-query/index.js"></script></body></html>\n',
        encoding: 'UTF-8',
        mediaType: 'text/html',
        purpose: 'SOURCE',
        sourceModuleIds: [],
        sourcePlanItemIds: ['PLAN-001'],
      },
      {
        path: 'core/order-query/index.ts',
        content: 'export const ready = true;\n',
        encoding: 'UTF-8',
        mediaType: 'text/typescript',
        purpose: 'SOURCE',
        sourceModuleIds: ['MOD-001'],
        sourcePlanItemIds: ['PLAN-001'],
      },
      {
        path: 'core/order-query/index.test.ts',
        content:
          'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { ready } from "./index.js";\ntest("ready", () => assert.equal(ready, true));\n',
        encoding: 'UTF-8',
        mediaType: 'text/typescript',
        purpose: 'TEST',
        sourceModuleIds: ['MOD-001'],
        sourcePlanItemIds: ['PLAN-001'],
      },
    ],
    entrypoints: ['index.html'],
  });
}

describe('application Factory cache-only replay integration', () => {
  it(
    'runs A normally and replays A → B → C without another provider call',
    { timeout: 90_000 },
    async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'brq-runtime-cache-replay-'));
      try {
        const technicalSpecification = createCodeGeneratorTechnicalSpecification();
        const backingProvider = new FakeAIProvider([
          {
            type: 'success',
            response: createProductOwnerAIResponse(createProductOwnerSpecification()),
          },
          { type: 'success', response: createDeveloperAIResponse(technicalSpecification) },
          { type: 'success', response: createCodeGeneratorAIResponse(codeProposal()) },
        ]);
        const cache = createAtomicMemoryCache();
        let time = 1_786_320_000_000;
        const now = (): number => ++time;
        const logger = createLogger({ sink: () => undefined });
        const history = createInMemoryFactoryExecutionHistory({ now });
        const sandboxRun = vi.fn(async (request: SandboxRunRequest) =>
          finalizeSandboxRunResult({
            request,
            policy: FACTORY_SANDBOX_POLICY,
            effectiveLimits: DEFAULT_SANDBOX_LIMITS,
            runtime: {
              ...createSandboxRuntimeObservationFixture(),
              runtimeVersion: '24.19.0',
              toolchainVersions: { TYPESCRIPT: '6.0.3' },
            },
            status: 'SUCCESS',
            startedAt: '2026-08-12T00:00:00.000Z',
            finishedAt: '2026-08-12T00:00:01.000Z',
            durationMs: 1_000,
            steps: createSandboxStepResultsFixture(),
            resourceOutcome: 'NONE',
            failure: null,
          }),
        );
        const pipeline = await createApplicationFactoryRuntime({
          aiProvider: backingProvider,
          aiResponseCache: cache,
          environment: { NODE_ENV: 'test' },
          controlledWorkspace: createFilesystemControlledWorkspace({
            rootPath: workspaceRoot,
            logger,
            now,
          }),
          sandboxRunner: { run: sandboxRun },
          factoryExecutionHistory: history,
          logger,
          now,
        });
        const requestA = createExecutionRequestFixture({
          demand: {
            title: 'Jogo da Velha',
            description: 'Crie um jogo da velha web para dois jogadores locais.',
          },
        });
        const requestB = createRerunExecutionRequest(requestA, 'request-replay-b', REPLAY_B_ID);
        const requestC = createRerunExecutionRequest(requestB, 'request-replay-c', REPLAY_C_ID);
        const executionA = deriveExecutionIdentity(requestA).executionId;
        const executionB = deriveExecutionIdentity(requestB).executionId;
        const executionC = deriveExecutionIdentity(requestC).executionId;

        const resultA = await pipeline.execute(requestA);
        const resultB = await pipeline.execute(requestB, {
          cacheMode: 'REQUIRE_HIT',
          sourceExecutionId: executionA,
        });
        const resultC = await pipeline.execute(requestC, {
          cacheMode: 'REQUIRE_HIT',
          sourceExecutionId: executionB,
        });

        expect([resultA.status, resultB.status, resultC.status]).toEqual([
          'SUCCESS',
          'SUCCESS',
          'SUCCESS',
        ]);
        expect(backingProvider.calls).toHaveLength(3);
        expect(backingProvider.calls.map(({ options }) => options.agent)).toEqual([
          'PRODUCT_OWNER',
          'DEVELOPER',
          'CODE_GENERATOR',
        ]);
        expect(
          backingProvider.calls.every(({ options }) => options.executionId === executionA),
        ).toBe(true);
        expect(sandboxRun).toHaveBeenCalledTimes(3);
        expect(cache.entries.size).toBe(9);

        for (const agent of CACHED_AGENTS) {
          const checkpointA = cache.entries.get(`${executionA}:${agent}`);
          const checkpointB = cache.entries.get(`${executionB}:${agent}`);
          const checkpointC = cache.entries.get(`${executionC}:${agent}`);
          expect(checkpointA).toBeDefined();
          expect(checkpointB).toEqual({ ...checkpointA, executionId: executionB });
          expect(checkpointC).toEqual({ ...checkpointA, executionId: executionC });
        }
        expect([...cache.entries.keys()].some((checkpoint) => checkpoint.endsWith(':QA'))).toBe(
          false,
        );

        for (const executionId of [executionA, executionB, executionC]) {
          expect(history.get(executionId)?.stageMetrics[2]).toMatchObject({
            stageId: 'QA',
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          });
        }
        for (const replay of [resultB, resultC]) {
          expect(history.get(replay.executionId)?.stageMetrics.slice(0, 2)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ stageId: 'PRODUCT_OWNER', totalTokens: 0 }),
              expect.objectContaining({ stageId: 'DEVELOPER', totalTokens: 0 }),
            ]),
          );
        }
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    },
  );
});
