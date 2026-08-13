import {
  calculateAIResponseHash,
  createCachedAIProvider,
  type AIResponseCache,
  type AIResponseCacheCompleteInput,
  type AIResponseCacheEntry,
  type AIResponseCacheKey,
} from '@brq/ai-provider';
import { FakeAIProvider } from '@brq/ai-provider/fake';
import { describe, expect, it } from 'vitest';

import { createAgentRunner } from './agent-runner';
import {
  createAgentRunRequest,
  quietLogger,
  runnerDependencies,
} from './testing/agent-runner-fixtures';

function memoryCache(): AIResponseCache & {
  readonly entries: Map<string, AIResponseCacheEntry>;
} {
  const entries = new Map<string, AIResponseCacheEntry>();
  const claims = new Map<string, { key: AIResponseCacheKey; claimToken: string }>();
  let sequence = 0;
  const id = (value: Pick<AIResponseCacheKey, 'executionId' | 'agent'>) =>
    `${value.executionId}:${value.agent}`;
  return {
    entries,
    async get(key) {
      return structuredClone(entries.get(id(key)) ?? null);
    },
    async claim(key) {
      const cacheId = id(key);
      const entry = entries.get(cacheId);
      if (entry !== undefined) return structuredClone({ status: 'COMPLETED' as const, entry });
      if (claims.has(cacheId)) return structuredClone({ status: 'IN_PROGRESS' as const, ...key });
      const claimToken = `claim-${++sequence}`;
      claims.set(cacheId, { key: structuredClone(key), claimToken });
      return structuredClone({ status: 'CLAIMED' as const, ...key, claimToken });
    },
    async complete(input: AIResponseCacheCompleteInput) {
      const cacheId = id(input);
      if (claims.get(cacheId)?.claimToken !== input.claimToken) {
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
      claims.delete(cacheId);
      entries.set(cacheId, entry);
      return structuredClone(entry);
    },
    async fail(input) {
      const cacheId = id(input);
      if (claims.get(cacheId)?.claimToken === input.claimToken) claims.delete(cacheId);
    },
  };
}

describe('Agent Runner exact AI cache correlation', () => {
  it('reuses the exact response across A → B → C with one provider call and zero replay cost', async () => {
    const backingProvider = new FakeAIProvider();
    const cache = memoryCache();
    const cachedProvider = createCachedAIProvider({
      provider: backingProvider,
      cache,
      logger: quietLogger(),
    });
    const runner = createAgentRunner(runnerDependencies(cachedProvider));
    const original = createAgentRunRequest();
    const rerunB = {
      ...structuredClone(original),
      context: {
        execution: {
          ...original.context.execution,
          executionId: 'execution-rerun-2',
          agentExecutionId: 'agent-execution-rerun-2',
        },
        requestId: 'request-rerun-2',
        traceId: 'trace-rerun-2',
      },
    };
    const rerunC = {
      ...structuredClone(original),
      context: {
        execution: {
          ...original.context.execution,
          executionId: 'execution-rerun-3',
          agentExecutionId: 'agent-execution-rerun-3',
        },
        requestId: 'request-rerun-3',
        traceId: 'trace-rerun-3',
      },
    };

    const first = await runner.run(original);
    const second = await runner.run(rerunB, {
      cacheMode: 'REQUIRE_HIT',
      sourceExecutionId: original.context.execution.executionId,
    });
    const third = await runner.run(rerunC, {
      cacheMode: 'REQUIRE_HIT',
      sourceExecutionId: rerunB.context.execution.executionId,
    });

    expect(cachedProvider.capabilities).toEqual({ exactResponseCache: true });
    expect(backingProvider.calls).toHaveLength(1);
    expect(second.context).toEqual(rerunB.context);
    expect(third.context).toEqual(rerunC.context);
    expect(second.output).toEqual(first.output);
    expect(third.output).toEqual(first.output);
    for (const replay of [second, third]) {
      expect(replay.metrics.observed.providerDurationMs).toBe(0);
      expect(replay.metrics.reported).toMatchObject({
        durationMs: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    }
    const originalCheckpoint = cache.entries.get(
      `${original.context.execution.executionId}:PRODUCT_OWNER`,
    );
    const secondCheckpoint = cache.entries.get(
      `${rerunB.context.execution.executionId}:PRODUCT_OWNER`,
    );
    const thirdCheckpoint = cache.entries.get(
      `${rerunC.context.execution.executionId}:PRODUCT_OWNER`,
    );
    expect(secondCheckpoint?.response).toEqual(originalCheckpoint?.response);
    expect(thirdCheckpoint?.response).toEqual(originalCheckpoint?.response);
    expect(secondCheckpoint?.responseHash).toBe(originalCheckpoint?.responseHash);
    expect(thirdCheckpoint?.responseHash).toBe(originalCheckpoint?.responseHash);
    expect(originalCheckpoint?.response.usage).not.toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
