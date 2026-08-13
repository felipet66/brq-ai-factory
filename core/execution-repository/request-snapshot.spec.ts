import { deriveExecutionIdentity } from '@brq/execution-engine';
import { describe, expect, it } from 'vitest';

import { createInMemoryExecutionRequestSnapshotRepository } from './adapters/in-memory-execution-request-snapshot-repository';
import { executionRequestSnapshotSchema } from './request-snapshot-schemas';
import { createExecutionRequestFixture } from './testing/execution-record-fixtures';

const CREATED_AT = '2026-08-12T18:00:00.000Z';

describe('execution request snapshots', () => {
  it('stores an immutable owner-scoped copy with deterministic identity evidence', async () => {
    const repository = createInMemoryExecutionRequestSnapshotRepository();
    const request = createExecutionRequestFixture();
    const identity = deriveExecutionIdentity(request);

    const saved = await repository.save({
      ownerId: 'owner-a',
      request,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: CREATED_AT,
    });

    expect(saved).toMatchObject({
      version: '1.0.0',
      ownerId: 'owner-a',
      executionId: identity.executionId,
      requestHash: identity.executionRequestHash,
      request,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
    });
    expect(Object.isFrozen(saved)).toBe(true);
    expect(
      await repository.findOwned({ ownerId: 'owner-a', executionId: identity.executionId }),
    ).toEqual(saved);
    expect(
      await repository.findOwned({ ownerId: 'owner-b', executionId: identity.executionId }),
    ).toBeNull();
  });

  it('is idempotent only for the exact immutable snapshot', async () => {
    const repository = createInMemoryExecutionRequestSnapshotRepository();
    const request = createExecutionRequestFixture();
    const input = {
      ownerId: 'owner-a',
      request,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: CREATED_AT,
    } as const;

    const first = await repository.save(input);
    await expect(repository.save(input)).resolves.toEqual(first);
    await expect(
      repository.save({ ...input, createdAt: '2026-08-12T18:00:01.000Z' }),
    ).resolves.toEqual(first);
    await expect(
      repository.save({
        ...input,
        replaySourceExecutionId: `execution-${'a'.repeat(32)}`,
        replayCacheExecutionId: `execution-${'a'.repeat(32)}`,
        replayMode: 'REQUIRE_CACHE_HIT',
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_REPOSITORY_CONFLICT' });
  });

  it('rejects mismatched execution ids and request hashes at the contract boundary', () => {
    const request = createExecutionRequestFixture();
    const identity = deriveExecutionIdentity(request);
    const base = {
      version: '1.0.0',
      ownerId: 'owner-a',
      executionId: identity.executionId,
      requestHash: identity.executionRequestHash,
      request,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: CREATED_AT,
    } as const;

    expect(
      executionRequestSnapshotSchema.safeParse({
        ...base,
        executionId: `execution-${'f'.repeat(32)}`,
      }).success,
    ).toBe(false);
    expect(
      executionRequestSnapshotSchema.safeParse({ ...base, requestHash: 'f'.repeat(64) }).success,
    ).toBe(false);
    expect(
      executionRequestSnapshotSchema.safeParse({
        ...base,
        replaySourceExecutionId: `execution-${'a'.repeat(32)}`,
      }).success,
    ).toBe(false);
    expect(
      executionRequestSnapshotSchema.safeParse({
        ...base,
        replaySourceExecutionId: identity.executionId,
        replayCacheExecutionId: identity.executionId,
        replayMode: 'REQUIRE_CACHE_HIT',
      }).success,
    ).toBe(false);
  });
});
