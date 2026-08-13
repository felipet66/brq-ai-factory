import {
  calculateAIRequestHash,
  calculateAIResponseHash,
  type AIRequest,
  type AIResponse,
  type AIResponseCacheAgent,
  type AIResponseCacheKey,
  type CompletedAIResponse,
} from '@brq/ai-provider';
import { ERROR_CODES } from '@brq/shared/errors/error-codes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../tests/database-test-context';
import { PrismaAIResponseCache } from './prisma-ai-response-cache';

const REQUEST: AIRequest = {
  model: 'test-model',
  instructions: 'PRIVATE_CACHE_INSTRUCTIONS_59449b',
  input: 'PRIVATE_CACHE_INPUT_f6312a',
  responseFormat: { type: 'text' },
};

function executionId(character: string): string {
  return `execution-${character.repeat(32)}`;
}

function key(
  execution: string,
  requestHash: string,
  agent: AIResponseCacheAgent = 'PRODUCT_OWNER',
): AIResponseCacheKey {
  return { executionId: execution, agent, provider: 'fake', requestHash };
}

function response(content = 'PRIVATE_CACHE_RESPONSE_a354ff'): CompletedAIResponse {
  return {
    provider: 'fake',
    model: REQUEST.model,
    content,
    structuredData: null,
    finishReason: 'COMPLETED',
    usage: { inputTokens: 10, outputTokens: 5 },
    metadata: { responseId: 'response_cache_1', durationMs: 20, attempts: 1 },
  };
}

describe('PrismaAIResponseCache', () => {
  let context: DatabaseTestContext;
  let cache: PrismaAIResponseCache;

  beforeAll(async () => {
    context = await createDatabaseTestContext();
    cache = new PrismaAIResponseCache(context.client);
  });

  afterAll(async () => {
    await context?.cleanup();
  });

  it('atomically claims and completes an execution-scoped checkpoint without storing the request', async () => {
    const requestHash = calculateAIRequestHash(REQUEST);
    const cacheKey = key(executionId('a'), requestHash);
    const expectedResponse = response();
    const claim = await cache.claim(cacheKey);

    expect(claim).toMatchObject({ status: 'CLAIMED', ...cacheKey });
    if (claim.status !== 'CLAIMED') throw new Error('Expected an owned cache claim.');
    await expect(cache.get(cacheKey)).resolves.toBeNull();

    const completed = await cache.complete({
      ...cacheKey,
      claimToken: claim.claimToken,
      response: expectedResponse,
    });
    expect(completed).toEqual({
      ...cacheKey,
      responseHash: calculateAIResponseHash(expectedResponse),
      response: expectedResponse,
    });
    await expect(cache.get(cacheKey)).resolves.toEqual(completed);

    const rows = await context.client.$queryRawUnsafe<Record<string, unknown>[]>(
      'SELECT * FROM "AiResponseCacheEntry" WHERE "executionId" = ? AND "agent" = ?',
      cacheKey.executionId,
      cacheKey.agent,
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        'executionId',
        'agent',
        'provider',
        'requestHash',
        'state',
        'claimToken',
        'responseHash',
        'response',
        'createdAt',
        'completedAt',
      ].sort(),
    );
    expect(rows[0]).toMatchObject({ state: 'COMPLETED', claimToken: null });
    expect(rows[0]?.completedAt).not.toBeNull();
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(REQUEST.instructions);
    expect(serialized).not.toContain(REQUEST.input);
  });

  it('grants one atomic claim and exposes the competing claim as in progress', async () => {
    const requestHash = calculateAIRequestHash({ ...REQUEST, input: 'Atomic claim input.' });
    const cacheKey = key(executionId('b'), requestHash);
    const claims = await Promise.all([cache.claim(cacheKey), cache.claim(cacheKey)]);

    expect(claims.map(({ status }) => status).sort()).toEqual(['CLAIMED', 'IN_PROGRESS']);
    const owned = claims.find((claim) => claim.status === 'CLAIMED');
    if (owned?.status !== 'CLAIMED') throw new Error('Expected exactly one owned cache claim.');

    await expect(
      cache.complete({
        ...cacheKey,
        claimToken: 'not-the-owned-token',
        response: response('Rejected completion.'),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERSISTENCE_CONFLICT });

    const expectedResponse = response('Atomic completion.');
    const completed = await cache.complete({
      ...cacheKey,
      claimToken: owned.claimToken,
      response: expectedResponse,
    });
    await expect(cache.claim(cacheKey)).resolves.toEqual({ status: 'COMPLETED', entry: completed });
    await expect(
      cache.complete({ ...cacheKey, claimToken: owned.claimToken, response: expectedResponse }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERSISTENCE_CONFLICT });
  });

  it('keeps the same request hash isolated across executions and preflights only completed stages', async () => {
    const requestHash = calculateAIRequestHash({ ...REQUEST, input: 'Isolated input.' });
    const firstKey = key(executionId('c'), requestHash);
    const secondKey = key(executionId('d'), requestHash);
    const firstClaim = await cache.claim(firstKey);
    const secondClaim = await cache.claim(secondKey);
    if (firstClaim.status !== 'CLAIMED' || secondClaim.status !== 'CLAIMED') {
      throw new Error('Expected independent execution-scoped claims.');
    }

    const firstResponse = response('First execution response.');
    const secondResponse = response('Second execution response.');
    await cache.complete({
      ...firstKey,
      claimToken: firstClaim.claimToken,
      response: firstResponse,
    });
    await cache.complete({
      ...secondKey,
      claimToken: secondClaim.claimToken,
      response: secondResponse,
    });

    await expect(cache.get(firstKey)).resolves.toMatchObject({ response: firstResponse });
    await expect(cache.get(secondKey)).resolves.toMatchObject({ response: secondResponse });
    await expect(
      cache.inspectExecution({
        executionId: firstKey.executionId,
        requiredAgents: ['PRODUCT_OWNER', 'DEVELOPER'],
      }),
    ).resolves.toMatchObject({
      executionId: firstKey.executionId,
      complete: false,
      missingAgents: ['DEVELOPER'],
      checkpoints: [{ agent: 'PRODUCT_OWNER', provider: 'fake', requestHash }],
    });

    const developerKey = key(firstKey.executionId, requestHash, 'DEVELOPER');
    const developerClaim = await cache.claim(developerKey);
    if (developerClaim.status !== 'CLAIMED') throw new Error('Expected a Developer claim.');
    await cache.complete({
      ...developerKey,
      claimToken: developerClaim.claimToken,
      response: response('Developer response.'),
    });
    await expect(
      cache.inspectExecution({
        executionId: firstKey.executionId,
        requiredAgents: ['PRODUCT_OWNER', 'DEVELOPER'],
      }),
    ).resolves.toMatchObject({
      complete: true,
      missingAgents: [],
      checkpoints: [{ agent: 'DEVELOPER' }, { agent: 'PRODUCT_OWNER' }],
    });
  });

  it('rejects different coordinates for an occupied execution and agent', async () => {
    const firstHash = calculateAIRequestHash({ ...REQUEST, input: 'Original coordinates.' });
    const differentHash = calculateAIRequestHash({ ...REQUEST, input: 'Changed coordinates.' });
    const cacheKey = key(executionId('e'), firstHash);
    await expect(cache.claim(cacheKey)).resolves.toMatchObject({ status: 'CLAIMED' });

    await expect(cache.claim({ ...cacheKey, requestHash: differentHash })).rejects.toMatchObject({
      code: ERROR_CODES.PERSISTENCE_CONFLICT,
    });
    await expect(cache.claim({ ...cacheKey, provider: 'other' })).rejects.toMatchObject({
      code: ERROR_CODES.PERSISTENCE_CONFLICT,
    });
  });

  it('releases only the owned pending claim and permits a fresh claim', async () => {
    const requestHash = calculateAIRequestHash({ ...REQUEST, input: 'Released claim.' });
    const cacheKey = key(executionId('f'), requestHash);
    const first = await cache.claim(cacheKey);
    if (first.status !== 'CLAIMED') throw new Error('Expected the initial claim.');

    await expect(cache.fail({ ...cacheKey, claimToken: 'wrong-token' })).rejects.toMatchObject({
      code: ERROR_CODES.PERSISTENCE_CONFLICT,
    });
    await expect(
      cache.fail({ ...cacheKey, claimToken: first.claimToken }),
    ).resolves.toBeUndefined();
    await expect(cache.get(cacheKey)).resolves.toBeNull();

    const second = await cache.claim(cacheKey);
    expect(second).toMatchObject({ status: 'CLAIMED', ...cacheKey });
    if (second.status !== 'CLAIMED') throw new Error('Expected a replacement claim.');
    expect(second.claimToken).not.toBe(first.claimToken);
  });

  it('rejects invalid responses, mismatched providers, keys and inspection requests', async () => {
    const requestHash = calculateAIRequestHash({ ...REQUEST, input: 'Invalid input.' });
    const cacheKey = key(executionId('1'), requestHash);
    const claim = await cache.claim(cacheKey);
    if (claim.status !== 'CLAIMED') throw new Error('Expected a claim for validation tests.');

    await expect(
      cache.complete({
        ...cacheKey,
        claimToken: claim.claimToken,
        response: { ...response(), finishReason: 'REFUSAL' } as AIResponse as CompletedAIResponse,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_INPUT });
    await expect(
      cache.complete({
        ...cacheKey,
        provider: 'other',
        claimToken: claim.claimToken,
        response: response(),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_INPUT });
    await expect(cache.get({ ...cacheKey, requestHash: 'not-a-hash' })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    });
    await expect(
      cache.inspectExecution({
        executionId: cacheKey.executionId,
        requiredAgents: ['PRODUCT_OWNER', 'PRODUCT_OWNER'],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_INPUT });
  });

  it('detects and removes a tampered completed checkpoint before permitting repair', async () => {
    const requestHash = calculateAIRequestHash({ ...REQUEST, input: 'Tamper input.' });
    const cacheKey = key(executionId('2'), requestHash);
    const claim = await cache.claim(cacheKey);
    if (claim.status !== 'CLAIMED') throw new Error('Expected a claim for tamper testing.');
    await cache.complete({
      ...cacheKey,
      claimToken: claim.claimToken,
      response: response('Original response.'),
    });
    await context.client.$executeRawUnsafe(
      'UPDATE "AiResponseCacheEntry" SET "responseHash" = ? WHERE "executionId" = ? AND "agent" = ?',
      '0'.repeat(64),
      cacheKey.executionId,
      cacheKey.agent,
    );

    await expect(cache.get(cacheKey)).rejects.toMatchObject({
      code: ERROR_CODES.PERSISTENCE_ERROR,
    });
    await expect(cache.get(cacheKey)).resolves.toBeNull();

    const repairClaim = await cache.claim(cacheKey);
    if (repairClaim.status !== 'CLAIMED') throw new Error('Expected a repair claim.');
    await expect(
      cache.complete({
        ...cacheKey,
        claimToken: repairClaim.claimToken,
        response: response('Repaired response.'),
      }),
    ).resolves.toMatchObject({ response: response('Repaired response.') });
  });
});
