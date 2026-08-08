// @vitest-environment node

import { deriveExecutionIdentity } from '@brq/execution-engine';
import { PrismaExecutionRecordRepository } from '@brq/execution-repository/prisma';
import {
  createExecutionRequestFixture,
  createExecutionResultFixture,
} from '@brq/execution-repository/testing';
import { createInMemoryJobQueue } from '@brq/job-queue';
import { createLogger } from '@brq/shared/logger/logger';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../../../../prisma/tests/database-test-context';

import type { AuthenticatedPrincipal } from './auth/contracts';
import {
  createApplicationWorkerRuntime,
  createPrincipalExecutionDispatcher,
  createPrincipalExecutionRepositoryForRead,
} from './runtime';

function principal(userId: string, role: 'ADMIN' | 'USER'): AuthenticatedPrincipal {
  return Object.freeze({
    userId,
    role,
    user: Object.freeze({
      id: userId,
      email: `${userId}@example.local`,
      name: userId,
      role,
      createdAt: '2026-08-07T20:00:00.000Z',
      updatedAt: '2026-08-07T20:00:00.000Z',
    }),
  });
}

describe('authenticated runtime ownership composition', () => {
  let context: DatabaseTestContext;

  beforeAll(async () => {
    context = await createDatabaseTestContext();
    await context.client.user.createMany({
      data: [
        {
          id: 'user-runtime-owner-a',
          email: 'runtime-owner-a@example.local',
          name: 'Runtime Owner A',
          emailVerified: true,
          role: 'USER',
        },
        {
          id: 'user-runtime-owner-b',
          email: 'runtime-owner-b@example.local',
          name: 'Runtime Owner B',
          emailVerified: true,
          role: 'USER',
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await context?.cleanup();
  });

  it('binds dispatch to OWNER, lifecycle to INTERNAL and admin reads to GLOBAL_READ_ONLY', async () => {
    const principalA = principal('user-runtime-owner-a', 'USER');
    const principalB = principal('user-runtime-owner-b', 'USER');
    const adminPrincipal = principal('user-runtime-owner-a', 'ADMIN');
    const ownerA = createPrincipalExecutionRepositoryForRead(context.client, principalA);
    const ownerB = createPrincipalExecutionRepositoryForRead(context.client, principalB);
    const internal = new PrismaExecutionRecordRepository(context.client, { access: 'INTERNAL' });
    const admin = createPrincipalExecutionRepositoryForRead(context.client, adminPrincipal);
    const request = createExecutionRequestFixture({ workflowId: 'workflow-runtime-owner-a' });
    const identity = deriveExecutionIdentity(request);
    const result = createExecutionResultFixture({
      executionId: identity.executionId,
      workflowId: request.workflowId,
    });
    const execute = vi.fn(async () => result);
    let clock = Date.parse('2026-08-07T20:00:00.000Z');
    const now = () => ++clock;
    const queue = createInMemoryJobQueue({ now });
    const logger = createLogger({ sink: () => undefined });
    const runtime = createApplicationWorkerRuntime({
      engine: { execute },
      repository: internal,
      queue,
      logger,
    });
    const dispatcher = createPrincipalExecutionDispatcher({
      principal: principalA,
      client: context.client,
      queue,
      logger,
      now,
    });

    try {
      const queued = await dispatcher.dispatch(request);
      await runtime.worker.drain();

      const ownRecord = await ownerA.findByExecutionId(identity.executionId);
      const adminRecord = await admin.findByJobId(queued.jobId);
      const otherOwnerByExecution = await ownerB.findByExecutionId(identity.executionId);
      const otherOwnerByJob = await ownerB.findByJobId(queued.jobId);
      const rawRecord = await context.client.executionRecord.findUniqueOrThrow({
        where: { executionId: identity.executionId },
        select: { userId: true },
      });

      expect(execute).toHaveBeenCalledOnce();
      expect(ownRecord).toMatchObject({
        executionId: identity.executionId,
        workflowId: request.workflowId,
        job: { jobId: queued.jobId, status: 'FAILED' },
      });
      expect(adminRecord).toEqual(ownRecord);
      expect(otherOwnerByExecution).toBeNull();
      expect(otherOwnerByJob).toBeNull();
      expect(rawRecord.userId).toBe('user-runtime-owner-a');
      expect(JSON.stringify(ownRecord)).not.toContain('user-runtime-owner-a');
      expect(JSON.stringify(queued)).not.toContain('user-runtime-owner-a');
      expect(result.hashes).toEqual(createExecutionResultFixture().hashes);
    } finally {
      await runtime.worker.shutdown();
    }
  });
});
