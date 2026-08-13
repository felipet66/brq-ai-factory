import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../../prisma/tests/database-test-context';
import { PrismaExecutionRequestSnapshotRepository } from './adapters/prisma-execution-request-snapshot-repository';
import { createExecutionRequestFixture } from './testing/execution-record-fixtures';

const OWNER_ID = 'user-snapshot-owner';
const OTHER_OWNER_ID = 'user-snapshot-other';
const CREATED_AT = '2026-08-12T19:00:00.000Z';

describe('Prisma execution request snapshot repository', () => {
  let context: DatabaseTestContext;

  beforeEach(async () => {
    context = await createDatabaseTestContext();
    await context.client.user.createMany({
      data: [
        {
          id: OWNER_ID,
          email: 'snapshot-owner@example.com',
          name: 'Snapshot Owner',
          role: 'USER',
          updatedAt: new Date(CREATED_AT),
        },
        {
          id: OTHER_OWNER_ID,
          email: 'snapshot-other@example.com',
          name: 'Snapshot Other',
          role: 'USER',
          updatedAt: new Date(CREATED_AT),
        },
      ],
    });
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it('round-trips an immutable snapshot only for its authenticated owner', async () => {
    const request = createExecutionRequestFixture();
    const repository = new PrismaExecutionRequestSnapshotRepository(context.client, OWNER_ID);
    const input = {
      ownerId: OWNER_ID,
      request,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: CREATED_AT,
    } as const;
    const saved = await repository.save(input);

    expect(
      await new PrismaExecutionRequestSnapshotRepository(context.client, OWNER_ID).findOwned({
        ownerId: OWNER_ID,
        executionId: saved.executionId,
      }),
    ).toEqual(saved);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(await context.client.executionRequestSnapshot.count()).toBe(1);
    expect(JSON.stringify(saved.request)).toContain(request.demand.title);
    await expect(
      repository.save({ ...input, createdAt: '2026-08-12T19:01:00.000Z' }),
    ).resolves.toEqual(saved);
  });

  it('does not reveal or overwrite another owner snapshot', async () => {
    const request = createExecutionRequestFixture();
    const owner = new PrismaExecutionRequestSnapshotRepository(context.client, OWNER_ID);
    const input = {
      ownerId: OWNER_ID,
      request,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: CREATED_AT,
    } as const;
    const saved = await owner.save(input);
    const other = new PrismaExecutionRequestSnapshotRepository(context.client, OTHER_OWNER_ID);

    expect(
      await other.findOwned({ ownerId: OTHER_OWNER_ID, executionId: saved.executionId }),
    ).toBeNull();
    await expect(other.save({ ...input, ownerId: OTHER_OWNER_ID })).rejects.toMatchObject({
      code: 'EXECUTION_REPOSITORY_CONFLICT',
    });
    await expect(
      owner.findOwned({ ownerId: OTHER_OWNER_ID, executionId: saved.executionId }),
    ).rejects.toMatchObject({ code: 'EXECUTION_REPOSITORY_INVALID_INPUT' });
  });

  it('round-trips explicit replay lineage', async () => {
    const request = createExecutionRequestFixture();
    const repository = new PrismaExecutionRequestSnapshotRepository(context.client, OWNER_ID);
    const sourceExecutionId = `execution-${'a'.repeat(32)}`;
    const cacheExecutionId = `execution-${'b'.repeat(32)}`;

    const saved = await repository.save({
      ownerId: OWNER_ID,
      request,
      replaySourceExecutionId: sourceExecutionId,
      replayCacheExecutionId: cacheExecutionId,
      replayMode: 'REQUIRE_CACHE_HIT',
      createdAt: CREATED_AT,
    });

    expect(saved).toMatchObject({
      replaySourceExecutionId: sourceExecutionId,
      replayCacheExecutionId: cacheExecutionId,
      replayMode: 'REQUIRE_CACHE_HIT',
    });
    expect(
      await context.client.executionRequestSnapshot.findUnique({
        where: { executionId: saved.executionId },
        select: {
          replaySourceExecutionId: true,
          replayCacheExecutionId: true,
          replayMode: true,
        },
      }),
    ).toEqual({
      replaySourceExecutionId: sourceExecutionId,
      replayCacheExecutionId: cacheExecutionId,
      replayMode: 'REQUIRE_CACHE_HIT',
    });
  });
});
