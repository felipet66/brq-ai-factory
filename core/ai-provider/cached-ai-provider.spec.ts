import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it, vi } from 'vitest';

import type { AIProvider } from './ai-provider';
import type {
  AIResponseCache,
  AIResponseCacheClaimResult,
  AIResponseCacheCompleteInput,
  AIResponseCacheEntry,
  AIResponseCacheFailInput,
  AIResponseCacheKey,
} from './cache-contracts';
import { createCachedAIProvider } from './cached-ai-provider';
import type { AIRequest, AIResponse } from './contracts';
import { calculateAIRequestHash, calculateAIResponseHash } from './hashing';

const REQUEST: AIRequest = {
  model: 'test-model',
  instructions: 'PRIVATE_INSTRUCTIONS_73d177',
  input: 'PRIVATE_INPUT_02d312',
  responseFormat: { type: 'text' },
};
const EXECUTION_ID = `execution-${'a'.repeat(32)}`;
const RERUN_EXECUTION_ID = `execution-${'b'.repeat(32)}`;
const BASE_OPTIONS = Object.freeze({ executionId: EXECUTION_ID, agent: 'PRODUCT_OWNER' as const });

function completedResponse(content = 'PRIVATE_RESPONSE_e2a5c4'): AIResponse & {
  finishReason: 'COMPLETED';
} {
  return {
    provider: 'fake',
    model: REQUEST.model,
    content,
    structuredData: null,
    finishReason: 'COMPLETED',
    usage: { inputTokens: 12, outputTokens: 7 },
    metadata: { responseId: 'response_1', durationMs: 31, attempts: 1 },
  };
}

function memoryCache(): AIResponseCache & {
  readonly entries: Map<string, AIResponseCacheEntry>;
  readonly claims: AIResponseCacheKey[];
  readonly completes: AIResponseCacheCompleteInput[];
  readonly failures: AIResponseCacheFailInput[];
} {
  const entries = new Map<string, AIResponseCacheEntry>();
  const inProgress = new Map<string, { key: AIResponseCacheKey; claimToken: string }>();
  const claims: AIResponseCacheKey[] = [];
  const completes: AIResponseCacheCompleteInput[] = [];
  const failures: AIResponseCacheFailInput[] = [];
  let claimSequence = 0;
  const cacheKey = (value: Pick<AIResponseCacheKey, 'executionId' | 'agent'>) =>
    `${value.executionId}:${value.agent}`;
  return {
    entries,
    claims,
    completes,
    failures,
    async get(key) {
      return structuredClone(entries.get(cacheKey(key)) ?? null);
    },
    async claim(key) {
      claims.push(structuredClone(key));
      const id = cacheKey(key);
      const completed = entries.get(id);
      if (completed !== undefined) {
        return structuredClone({ status: 'COMPLETED', entry: completed });
      }
      if (inProgress.has(id)) return structuredClone({ status: 'IN_PROGRESS', ...key });
      const claimToken = `claim-${++claimSequence}`;
      inProgress.set(id, { key: structuredClone(key), claimToken });
      return structuredClone({ status: 'CLAIMED', ...key, claimToken });
    },
    async complete(input) {
      completes.push(structuredClone(input));
      const id = cacheKey(input);
      const claim = inProgress.get(id);
      if (claim?.claimToken !== input.claimToken) throw new Error('claim owner mismatch');
      const entry: AIResponseCacheEntry = {
        executionId: input.executionId,
        agent: input.agent,
        provider: input.provider,
        requestHash: input.requestHash,
        responseHash: calculateAIResponseHash(input.response),
        response: structuredClone(input.response),
      };
      inProgress.delete(id);
      entries.set(id, entry);
      return structuredClone(entry);
    },
    async fail(input) {
      failures.push(structuredClone(input));
      const id = cacheKey(input);
      if (inProgress.get(id)?.claimToken === input.claimToken) inProgress.delete(id);
    },
  };
}

function cacheWith(overrides: Partial<AIResponseCache>): AIResponseCache {
  return Object.assign(memoryCache(), overrides);
}

function provider(generate: AIProvider['generate']): AIProvider {
  return { provider: 'fake', generate };
}

describe('cached AI provider', () => {
  it('persists a completed miss and serves the exact response without another provider call', async () => {
    const cache = memoryCache();
    const generate = vi.fn().mockResolvedValue(completedResponse());
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache,
      logger: createLogger({ sink: () => undefined }),
    });

    expect(cached.capabilities).toEqual({ exactResponseCache: true });
    expect(Object.isFrozen(cached.capabilities)).toBe(true);
    const first = await cached.generate(REQUEST, BASE_OPTIONS);
    const second = await cached.generate(REQUEST, BASE_OPTIONS);

    expect(first).toEqual(completedResponse());
    expect(second).toEqual(completedResponse());
    expect(generate).toHaveBeenCalledTimes(1);
    expect(cache.completes).toHaveLength(1);
    expect(cache.completes[0]).toMatchObject({
      provider: 'fake',
      executionId: EXECUTION_ID,
      agent: 'PRODUCT_OWNER',
      requestHash: calculateAIRequestHash(REQUEST),
      response: completedResponse(),
    });
    expect(cache.completes[0]).not.toHaveProperty('request');
  });

  it('uses one exact cache key when only correlation metadata changes', async () => {
    const cache = memoryCache();
    const generate = vi.fn().mockResolvedValue(completedResponse());
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache,
      logger: createLogger({ sink: () => undefined }),
    });

    await cached.generate(REQUEST, {
      requestId: 'request-original',
      traceId: 'trace-original',
      ...BASE_OPTIONS,
    });
    const replay = await cached.generate(REQUEST, {
      requestId: 'request-rerun',
      traceId: 'trace-rerun',
      cacheMode: 'REQUIRE_HIT',
      executionId: RERUN_EXECUTION_ID,
      sourceExecutionId: EXECUTION_ID,
      agent: 'PRODUCT_OWNER',
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(cache.completes).toHaveLength(2);
    expect(replay).toEqual(completedResponse());
  });

  it('fails closed without invoking the provider when an exact hit is required', async () => {
    const generate = vi.fn();
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache: memoryCache(),
      logger: createLogger({ sink: () => undefined }),
    });

    await expect(
      cached.generate(REQUEST, {
        cacheMode: 'REQUIRE_HIT',
        executionId: RERUN_EXECUTION_ID,
        sourceExecutionId: EXECUTION_ID,
        agent: 'PRODUCT_OWNER',
      }),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_CACHE_MISS',
      retryable: false,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('allows only the atomic claim owner to invoke the provider concurrently', async () => {
    const cache = memoryCache();
    let resolveProvider: ((response: ReturnType<typeof completedResponse>) => void) | undefined;
    const pendingProvider = new Promise<ReturnType<typeof completedResponse>>((resolve) => {
      resolveProvider = resolve;
    });
    const generate = vi.fn(() => pendingProvider);
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache,
      logger: createLogger({ sink: () => undefined }),
    });

    const owner = cached.generate(REQUEST, BASE_OPTIONS);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await expect(cached.generate(REQUEST, BASE_OPTIONS)).rejects.toMatchObject({
      code: 'AI_PROVIDER_CACHE_MISS',
      retryable: false,
    });
    expect(generate).toHaveBeenCalledOnce();

    resolveProvider?.(completedResponse());
    await expect(owner).resolves.toEqual(completedResponse());
    expect(cache.completes).toHaveLength(1);
  });

  it('claims the child atomically when two strict replays copy the same source', async () => {
    const cache = memoryCache();
    const response = completedResponse();
    const requestHash = calculateAIRequestHash(REQUEST);
    cache.entries.set(`${EXECUTION_ID}:PRODUCT_OWNER`, {
      executionId: EXECUTION_ID,
      agent: 'PRODUCT_OWNER',
      provider: 'fake',
      requestHash,
      responseHash: calculateAIResponseHash(response),
      response,
    });
    const complete = cache.complete.bind(cache);
    let copyStarted: (() => void) | undefined;
    let releaseCopy: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      copyStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    const generate = vi.fn();
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache: Object.assign(cache, {
        async complete(input: AIResponseCacheCompleteInput) {
          if (input.executionId === RERUN_EXECUTION_ID) {
            copyStarted?.();
            await release;
          }
          return complete(input);
        },
      }),
      logger: createLogger({ sink: () => undefined }),
    });
    const replayOptions = {
      cacheMode: 'REQUIRE_HIT' as const,
      executionId: RERUN_EXECUTION_ID,
      sourceExecutionId: EXECUTION_ID,
      agent: 'PRODUCT_OWNER' as const,
    };

    const owner = cached.generate(REQUEST, replayOptions);
    await started;
    await expect(cached.generate(REQUEST, replayOptions)).rejects.toMatchObject({
      code: 'AI_PROVIDER_CACHE_MISS',
    });
    expect(generate).not.toHaveBeenCalled();

    releaseCopy?.();
    await expect(owner).resolves.toEqual(response);
    expect(cache.entries.get(`${RERUN_EXECUTION_ID}:PRODUCT_OWNER`)?.response).toEqual(response);
  });

  it.each(['READ_FAILURE', 'INVALID_ENTRY'] as const)(
    'keeps required-hit mode closed for %s',
    async (scenario) => {
      const requestHash = calculateAIRequestHash(REQUEST);
      const invalidEntry: AIResponseCacheEntry = {
        executionId: EXECUTION_ID,
        agent: 'PRODUCT_OWNER',
        provider: 'fake',
        requestHash,
        responseHash: '0'.repeat(64),
        response: completedResponse(),
      };
      const generate = vi.fn();
      const cached = createCachedAIProvider({
        provider: provider(generate),
        cache: cacheWith({
          get:
            scenario === 'READ_FAILURE'
              ? vi.fn().mockRejectedValue(new Error('database unavailable'))
              : vi.fn().mockResolvedValue(invalidEntry),
        }),
        logger: createLogger({ sink: () => undefined }),
      });

      await expect(
        cached.generate(REQUEST, {
          cacheMode: 'REQUIRE_HIT',
          executionId: RERUN_EXECUTION_ID,
          sourceExecutionId: EXECUTION_ID,
          agent: 'PRODUCT_OWNER',
        }),
      ).rejects.toMatchObject({
        code: 'AI_PROVIDER_CACHE_MISS',
      });
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['executionId', RERUN_EXECUTION_ID],
    ['agent', 'DEVELOPER'],
  ] as const)(
    'rejects a source entry whose %s does not match the requested key',
    async (field, value) => {
      const requestHash = calculateAIRequestHash(REQUEST);
      const source: AIResponseCacheEntry = {
        executionId: EXECUTION_ID,
        agent: 'PRODUCT_OWNER',
        provider: 'fake',
        requestHash,
        responseHash: calculateAIResponseHash(completedResponse()),
        response: completedResponse(),
        [field]: value,
      };
      const generate = vi.fn();
      const claim = vi.fn();
      const cached = createCachedAIProvider({
        provider: provider(generate),
        cache: cacheWith({ get: vi.fn().mockResolvedValue(source), claim }),
        logger: createLogger({ sink: () => undefined }),
      });

      await expect(
        cached.generate(REQUEST, {
          cacheMode: 'REQUIRE_HIT',
          executionId: RERUN_EXECUTION_ID,
          sourceExecutionId: EXECUTION_ID,
          agent: 'PRODUCT_OWNER',
        }),
      ).rejects.toMatchObject({ code: 'AI_PROVIDER_CACHE_MISS' });
      expect(claim).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it('accepts a provider-resolved model while the request hash binds the requested alias', async () => {
    const cache = memoryCache();
    const response = { ...completedResponse(), model: 'test-model-2026-08-12' };
    const generate = vi.fn().mockResolvedValue(response);
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache,
      logger: createLogger({ sink: () => undefined }),
    });

    await expect(cached.generate(REQUEST, BASE_OPTIONS)).resolves.toEqual(response);
    await expect(cached.generate(REQUEST, BASE_OPTIONS)).resolves.toEqual(response);
    expect(generate).toHaveBeenCalledOnce();
    expect(cache.entries.get(`${EXECUTION_ID}:PRODUCT_OWNER`)?.requestHash).toBe(
      calculateAIRequestHash(REQUEST),
    );
  });

  it('rejects malformed claim coordinates before invoking the provider', async () => {
    const generate = vi.fn();
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache: cacheWith({
        claim: vi.fn(async (key): Promise<AIResponseCacheClaimResult> => ({
          status: 'CLAIMED',
          ...key,
          executionId: RERUN_EXECUTION_ID,
          claimToken: 'foreign-claim',
        })),
      }),
      logger: createLogger({ sink: () => undefined }),
    });

    await expect(cached.generate(REQUEST, BASE_OPTIONS)).rejects.toMatchObject({
      code: 'AI_PROVIDER_CACHE_MISS',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('validates the complete result coordinates, hashes and response before returning', async () => {
    const generate = vi.fn().mockResolvedValue(completedResponse());
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache: cacheWith({
        complete: vi.fn(async (input) => ({
          executionId: RERUN_EXECUTION_ID,
          agent: input.agent,
          provider: input.provider,
          requestHash: input.requestHash,
          responseHash: calculateAIResponseHash(input.response),
          response: input.response,
        })),
      }),
      logger: createLogger({ sink: () => undefined }),
    });

    await expect(cached.generate(REQUEST, BASE_OPTIONS)).rejects.toMatchObject({
      code: 'AI_PROVIDER_CACHE_MISS',
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('validates an atomic replay copy and preserves the exact persisted response', async () => {
    const sourceCache = memoryCache();
    const response = completedResponse();
    const requestHash = calculateAIRequestHash(REQUEST);
    sourceCache.entries.set(`${EXECUTION_ID}:PRODUCT_OWNER`, {
      executionId: EXECUTION_ID,
      agent: 'PRODUCT_OWNER',
      provider: 'fake',
      requestHash,
      responseHash: calculateAIResponseHash(response),
      response,
    });
    const invalidCopy = vi.fn(async (input: AIResponseCacheCompleteInput) => ({
      executionId: input.executionId,
      agent: input.agent,
      provider: input.provider,
      requestHash: input.requestHash,
      responseHash: calculateAIResponseHash(completedResponse('DIVERGENT_RESPONSE')),
      response: completedResponse('DIVERGENT_RESPONSE'),
    }));
    const cached = createCachedAIProvider({
      provider: provider(vi.fn()),
      cache: Object.assign(sourceCache, { complete: invalidCopy }),
      logger: createLogger({ sink: () => undefined }),
    });

    await expect(
      cached.generate(REQUEST, {
        cacheMode: 'REQUIRE_HIT',
        executionId: RERUN_EXECUTION_ID,
        sourceExecutionId: EXECUTION_ID,
        agent: 'PRODUCT_OWNER',
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_CACHE_MISS' });
    expect(invalidCopy).toHaveBeenCalledOnce();
    expect(invalidCopy.mock.calls.at(0)?.at(0)?.response).toEqual(response);
  });

  it.each(['MAX_OUTPUT_TOKENS', 'CONTENT_FILTER', 'REFUSAL'] as const)(
    'does not cache finish reason %s',
    async (finishReason) => {
      const cache = memoryCache();
      const response: AIResponse = { ...completedResponse(), finishReason };
      const generate = vi.fn().mockResolvedValue(response);
      const cached = createCachedAIProvider({
        provider: provider(generate),
        cache,
        logger: createLogger({ sink: () => undefined }),
      });

      await expect(cached.generate(REQUEST, BASE_OPTIONS)).resolves.toEqual(response);
      await expect(cached.generate(REQUEST, BASE_OPTIONS)).resolves.toEqual(response);
      expect(generate).toHaveBeenCalledTimes(2);
      expect(cache.completes).toHaveLength(0);
      expect(cache.failures).toHaveLength(2);
    },
  );

  it('rejects an invalid request before cache lookup or provider invocation', async () => {
    const get = vi.fn();
    const generate = vi.fn();
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache: cacheWith({ get }),
      logger: createLogger({ sink: () => undefined }),
    });

    await expect(cached.generate({ ...REQUEST, input: ' ' }, BASE_OPTIONS)).rejects.toMatchObject({
      code: 'AI_PROVIDER_INVALID_REQUEST',
    });
    expect(get).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('honors cancellation before cache lookup', async () => {
    const controller = new AbortController();
    controller.abort();
    const get = vi.fn();
    const generate = vi.fn();
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache: cacheWith({ get }),
      logger: createLogger({ sink: () => undefined }),
    });

    await expect(
      cached.generate(REQUEST, { ...BASE_OPTIONS, signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_CANCELLED',
    });
    expect(get).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not serve a cache entry with a divergent response hash', async () => {
    const response = completedResponse();
    const requestHash = calculateAIRequestHash(REQUEST);
    const generate = vi.fn().mockResolvedValue(response);
    const cache = memoryCache();
    cache.entries.set(`${EXECUTION_ID}:PRODUCT_OWNER`, {
      executionId: EXECUTION_ID,
      agent: 'PRODUCT_OWNER',
      provider: 'fake',
      requestHash,
      responseHash: '0'.repeat(64),
      response,
    });
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache,
      logger: createLogger({ sink: () => undefined }),
    });

    await expect(cached.generate(REQUEST, BASE_OPTIONS)).rejects.toMatchObject({
      code: 'AI_PROVIDER_CACHE_MISS',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('keeps claim and completion failures closed while returning only validated responses', async () => {
    const response = completedResponse();
    const generate = vi.fn().mockResolvedValue(response);
    const cached = createCachedAIProvider({
      provider: provider(generate),
      cache: cacheWith({ claim: vi.fn().mockRejectedValue(new Error('database unavailable')) }),
      logger: createLogger({ sink: () => undefined }),
    });

    await expect(cached.generate(REQUEST, BASE_OPTIONS)).rejects.toMatchObject({
      code: 'AI_PROVIDER_CACHE_MISS',
    });
    expect(generate).not.toHaveBeenCalled();

    const invalid = createCachedAIProvider({
      provider: provider(vi.fn().mockResolvedValue({ invalid: true })),
      cache: memoryCache(),
      logger: createLogger({ sink: () => undefined }),
    });
    await expect(invalid.generate(REQUEST, BASE_OPTIONS)).rejects.toMatchObject({
      code: 'AI_PROVIDER_INVALID_RESPONSE',
    });
  });

  it('logs only safe hashes and technical metadata, never request or response content', async () => {
    const lines: string[] = [];
    const cache = memoryCache();
    const cached = createCachedAIProvider({
      provider: provider(vi.fn().mockResolvedValue(completedResponse())),
      cache,
      logger: createLogger({ sink: (line) => lines.push(line) }),
    });

    await cached.generate(REQUEST, {
      ...BASE_OPTIONS,
      requestId: 'request-cache-1',
      traceId: 'trace-cache-1',
    });
    await cached.generate(REQUEST, {
      ...BASE_OPTIONS,
      requestId: 'request-cache-2',
      traceId: 'trace-cache-2',
    });

    const serialized = lines.join('\n');
    expect(serialized).toContain('ai.cache.miss');
    expect(serialized).toContain('ai.cache.stored');
    expect(serialized).toContain('ai.cache.hit');
    expect(serialized).toContain(calculateAIRequestHash(REQUEST));
    expect(serialized).not.toContain(REQUEST.instructions);
    expect(serialized).not.toContain(REQUEST.input);
    expect(serialized).not.toContain(completedResponse().content);
  });

  it('rejects an invalid decorator configuration', () => {
    expect(() =>
      createCachedAIProvider({ provider: {} as AIProvider, cache: memoryCache() }),
    ).toThrow(TypeError);
  });
});
