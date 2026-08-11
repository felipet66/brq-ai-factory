import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';
import {
  createInMemoryExecutionHistory,
  createInMemoryFactoryExecutionHistory,
} from '@brq/observability';

import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../../prisma/tests/database-test-context';
import {
  createObservabilityRequest,
  createSuccessfulExecutionResult,
} from '../observability/testing/observability-fixtures';
import { PrismaExecutionRecordRepository } from './adapters/prisma-execution-record-repository';
import { EXECUTION_REPOSITORY_ERROR_CODES } from './errors';
import {
  EXECUTION_JOB_FIXTURE_ID,
  EXECUTION_RECORD_FIXTURE_ID,
  createExecutionObservationFixture,
  createExecutionResultFixture,
} from './testing/execution-record-fixtures';

const OWNER_USER_ID = 'user-execution-owner';
const OTHER_USER_ID = 'user-other-owner';

function ownerRepository(context: DatabaseTestContext, userId = OWNER_USER_ID) {
  return new PrismaExecutionRecordRepository(context.client, { access: 'OWNER', userId });
}

function internalRepository(context: DatabaseTestContext) {
  return new PrismaExecutionRecordRepository(context.client, { access: 'INTERNAL' });
}

function globalReadRepository(context: DatabaseTestContext) {
  return new PrismaExecutionRecordRepository(context.client, { access: 'GLOBAL_READ_ONLY' });
}

describe('Prisma execution record repository', () => {
  let context: DatabaseTestContext;

  beforeEach(async () => {
    context = await createDatabaseTestContext();
    await context.client.user.createMany({
      data: [
        {
          id: OWNER_USER_ID,
          email: 'owner@example.com',
          name: 'Execution Owner',
          role: 'USER',
          updatedAt: new Date('2026-08-07T12:00:00.000Z'),
        },
        {
          id: OTHER_USER_ID,
          email: 'other@example.com',
          name: 'Other Owner',
          role: 'USER',
          updatedAt: new Date('2026-08-07T12:00:00.000Z'),
        },
      ],
    });
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it('round-trips normalized job metadata across repository instances', async () => {
    const repository = ownerRepository(context);
    await repository.createQueued({
      workflowId: 'workflow-001',
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      jobId: EXECUTION_JOB_FIXTURE_ID,
      requestId: 'request-001',
      traceId: null,
      projectName: 'Queued project',
      queuedAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    await repository.markJobRunning({
      jobId: EXECUTION_JOB_FIXTURE_ID,
      startedAt: '2026-08-07T12:00:00.005Z',
    });
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    await repository.complete(
      'workflow-001',
      createExecutionResultFixture(),
      createExecutionObservationFixture(),
    );
    await repository.markJobTerminal({
      jobId: EXECUTION_JOB_FIXTURE_ID,
      status: 'FAILED',
      finishedAt: '2026-08-07T12:00:00.060Z',
    });

    const restarted = ownerRepository(context);
    const restored = await restarted.findByJobId(EXECUTION_JOB_FIXTURE_ID);
    expect(restored).toMatchObject({
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      status: 'FAILED',
      job: {
        jobId: EXECUTION_JOB_FIXTURE_ID,
        status: 'FAILED',
        queuedAt: '2026-08-07T12:00:00.000Z',
        startedAt: '2026-08-07T12:00:00.005Z',
        finishedAt: '2026-08-07T12:00:00.060Z',
      },
    });
    expect(await context.client.executionJob.count()).toBe(1);
    expect(JSON.stringify(restored)).not.toContain('Allow customers');
  });

  it('round-trips a normalized terminal aggregate across repository instances', async () => {
    const repository = ownerRepository(context);
    await repository.create({
      workflowId: 'workflow-001',
      requestId: 'request-001',
      traceId: 'trace-001',
      projectName: 'Order tracking',
      createdAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    await repository.saveObservation('workflow-001', createExecutionObservationFixture());
    const completed = await repository.complete(
      'workflow-001',
      createExecutionResultFixture(),
      createExecutionObservationFixture(),
    );

    const restartedRepository = ownerRepository(context);
    const restored = await restartedRepository.findByExecutionId(completed.executionId!);
    const page = await restartedRepository.list({
      status: 'FAILED',
      readiness: 'READY',
      createdAfter: '2026-08-07T00:00:00.000Z',
      createdBefore: '2026-08-08T00:00:00.000Z',
    });

    expect(restored).toEqual(completed);
    expect(page.items).toEqual([completed]);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(await context.client.executionRecord.count()).toBe(1);
    expect(await context.client.executionRecordLifecycleEvent.count()).toBe(3);
    expect(await context.client.executionObservedStage.count()).toBe(4);
    expect(await context.client.executionStageMetric.count()).toBe(3);
    expect(await context.client.executionObservationEvent.count()).toBe(2);
    expect(completed.hashes.executionHash).toBe('3'.repeat(64));
  });

  it('normalizes complete lineage and provenance without persisting specifications or artifacts', async () => {
    const repository = ownerRepository(context);
    const request = createObservabilityRequest();
    const result = await createSuccessfulExecutionResult(request);
    const history = createInMemoryExecutionHistory({ now: () => Date.parse(result.finishedAt) });
    history.begin(request);
    history.complete(result);
    const snapshot = history.get(result.executionId);
    expect(snapshot).not.toBeNull();

    await repository.create({
      workflowId: request.workflowId,
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
      projectName: request.demand.title,
      createdAt: new Date(result.timeline[0]!.timestampMs).toISOString(),
      metadata: result.metadata,
    });
    await repository.markRunning({
      workflowId: request.workflowId,
      startedAt: result.startedAt!,
    });
    const completed = await repository.complete(request.workflowId, result, snapshot);

    expect(completed.status).toBe('SUCCESS');
    expect(completed.lineage).toEqual(result.lineage);
    expect(completed.provenance).toEqual(result.provenance);
    expect(await context.client.executionLineageHandoff.count()).toBe(
      result.lineage?.handoffs.length,
    );
    expect(await context.client.executionProvenanceStage.count()).toBe(
      result.provenance?.stages.length,
    );
    expect(await context.client.executionProvenanceArtifactHash.count()).toBe(
      result.provenance?.stages.reduce((total, stage) => total + stage.artifactHashes.length, 0),
    );
    const serialized = JSON.stringify(completed);
    expect(serialized).not.toContain(request.demand.description);
    const artifactContent =
      result.workflowResult?.results.productOwner?.artifacts[0]?.draft.content;
    if (artifactContent !== undefined) expect(serialized).not.toContain(artifactContent);
  });

  it('round-trips Factory metadata normalizada sem persistir payloads gerados', async () => {
    const repository = ownerRepository(context);
    const request = createObservabilityRequest();
    const result = createFactoryExecutionResultFixture({
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      workflowId: request.workflowId,
    });
    const history = createInMemoryFactoryExecutionHistory({
      now: () => Date.parse(result.finishedAt),
    });
    history.beginFactory(request);
    history.completeFactory(result);
    const snapshot = history.get(result.executionId);
    expect(snapshot).not.toBeNull();

    await repository.create({
      workflowId: request.workflowId,
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
      projectName: request.demand.title,
      createdAt: result.startedAt,
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    await repository.markRunning({
      workflowId: request.workflowId,
      startedAt: result.startedAt,
    });
    const completed = await repository.completeFactory(request.workflowId, result, snapshot);
    const restored = await ownerRepository(context).findByExecutionId(result.executionId);

    expect(restored).toEqual(completed);
    expect(restored?.factoryResult).toMatchObject({
      status: 'SUCCESS',
      generationStatus: 'SUCCESS',
      workspaceReleaseStatus: 'RELEASED',
      sandboxStatus: 'SUCCESS',
      hashes: { factoryResultHash: result.hashes.factoryResultHash },
    });
    expect(restored?.observation?.observabilityVersion).toBe('2.0.0');
    expect(await context.client.executionFactoryResult.count()).toBe(1);
    expect(await context.client.executionFactoryStageResult.count()).toBe(12);
    expect(await context.client.executionFactoryLineage.count()).toBe(1);
    expect(await context.client.executionFactoryProvenance.count()).toBe(1);
    expect(await context.client.executionFactoryToolchainVersion.count()).toBeGreaterThan(0);
    expect(await context.client.executionObservedStage.count()).toBe(10);
    expect(await context.client.executionStageMetric.count()).toBe(3);
    const serialized = JSON.stringify(restored?.factoryResult);
    expect(serialized).not.toMatch(
      /"(?:imageReference|containerId|prompt|content|path|stdout|stderr)"\s*:/,
    );
  });

  it('persists observation revisions by replacing normalized children atomically', async () => {
    const repository = ownerRepository(context);
    await repository.create({
      workflowId: 'workflow-001',
      requestId: null,
      traceId: null,
      projectName: 'Observation',
      createdAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    const first = createExecutionObservationFixture({
      revision: 1,
      summary: null,
      status: 'RUNNING',
    });
    const second = createExecutionObservationFixture();

    await repository.saveObservation('workflow-001', first);
    await repository.saveObservation('workflow-001', second);

    const record = await repository.findByWorkflowId('workflow-001');
    expect(record?.observation?.revision).toBe(7);
    expect(await context.client.executionObservedStage.count()).toBe(4);
    expect(await context.client.executionObservationEvent.count()).toBe(2);
  });

  it('rolls back a conflicting terminal write without partial lifecycle data', async () => {
    const repository = ownerRepository(context);
    for (const workflowId of ['workflow-001', 'workflow-002']) {
      await repository.create({
        workflowId,
        requestId: null,
        traceId: null,
        projectName: workflowId,
        createdAt: '2026-08-07T12:00:00.000Z',
        metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
      });
      await repository.markRunning({
        workflowId,
        startedAt: '2026-08-07T12:00:00.010Z',
      });
    }
    await repository.complete(
      'workflow-001',
      createExecutionResultFixture(),
      createExecutionObservationFixture(),
    );
    const conflictingResult = createExecutionResultFixture({ workflowId: 'workflow-002' });
    const conflictingObservation = createExecutionObservationFixture({
      workflowId: 'workflow-002',
    });

    await expect(
      repository.complete('workflow-002', conflictingResult, conflictingObservation),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });

    const unchanged = await repository.findByWorkflowId('workflow-002');
    expect(unchanged?.status).toBe('RUNNING');
    expect(unchanged?.lifecycle).toHaveLength(2);
    expect(unchanged?.hashes.executionHash).toBeNull();
  });

  it('paginates in descending creation order using a stable cursor', async () => {
    const repository = ownerRepository(context);
    for (const [index, workflowId] of ['workflow-a', 'workflow-b', 'workflow-c'].entries()) {
      await repository.create({
        workflowId,
        requestId: null,
        traceId: null,
        projectName: workflowId,
        createdAt: new Date(Date.parse('2026-08-07T12:00:00.000Z') + index).toISOString(),
        metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
      });
    }

    const first = await repository.list({ limit: 2 });
    const second = await repository.list({ limit: 2, cursor: first.nextCursor! });

    expect(first.items.map((record) => record.workflowId)).toEqual(['workflow-c', 'workflow-b']);
    expect(first.nextCursor).toBe('workflow-b');
    expect(second.items.map((record) => record.workflowId)).toEqual(['workflow-a']);
    expect(second.nextCursor).toBeNull();
  });

  it('persists an opaque owner on the execution root without duplicating it on the job', async () => {
    const repository = ownerRepository(context);
    const record = await repository.createQueued({
      workflowId: 'workflow-owned',
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      jobId: EXECUTION_JOB_FIXTURE_ID,
      requestId: null,
      traceId: null,
      projectName: 'Owned execution',
      queuedAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });

    const persisted = await context.client.executionRecord.findUniqueOrThrow({
      where: { workflowId: 'workflow-owned' },
      select: { userId: true, job: true },
    });

    expect(persisted.userId).toBe(OWNER_USER_ID);
    expect(persisted.job).not.toBeNull();
    expect('userId' in persisted.job!).toBe(false);
    expect(JSON.stringify(record)).not.toContain(OWNER_USER_ID);
    await expect(
      context.client.user.delete({ where: { id: OWNER_USER_ID } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('isolates owner lookups, lifecycle mutations, lists and cursors', async () => {
    const owner = ownerRepository(context);
    const other = ownerRepository(context, OTHER_USER_ID);
    const otherExecutionId = `execution-${'b'.repeat(32)}`;
    const otherJobId = `job-${'b'.repeat(32)}`;

    await owner.createQueued({
      workflowId: 'workflow-owner',
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      jobId: EXECUTION_JOB_FIXTURE_ID,
      requestId: null,
      traceId: null,
      projectName: 'Owner project',
      queuedAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    await other.createQueued({
      workflowId: 'workflow-other',
      executionId: otherExecutionId,
      jobId: otherJobId,
      requestId: null,
      traceId: null,
      projectName: 'Other project',
      queuedAt: '2026-08-07T12:00:00.001Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });

    await expect(owner.findByExecutionId(otherExecutionId)).resolves.toBeNull();
    await expect(owner.findByJobId(otherJobId)).resolves.toBeNull();
    await expect(owner.findByWorkflowId('workflow-other')).resolves.toBeNull();
    await expect(
      owner.markJobTerminal({
        jobId: otherJobId,
        status: 'CANCELLED',
        finishedAt: '2026-08-07T12:00:00.010Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND });
    await expect(owner.list()).resolves.toMatchObject({
      items: [{ workflowId: 'workflow-owner' }],
    });
    await expect(owner.list({ cursor: 'workflow-other' })).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
    });
    await expect(other.findByExecutionId(otherExecutionId)).resolves.toMatchObject({
      workflowId: 'workflow-other',
    });
  });

  it('keeps creation owner-bound while exposing separate internal and global-read capabilities', async () => {
    const owner = ownerRepository(context);
    const internal = internalRepository(context);
    const globalRead = globalReadRepository(context);
    const input = {
      workflowId: 'workflow-capability',
      requestId: null,
      traceId: null,
      projectName: 'Capability project',
      createdAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 as const },
    };

    await expect(internal.create(input)).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
    await expect(
      internal.createQueued({
        workflowId: input.workflowId,
        requestId: input.requestId,
        traceId: input.traceId,
        projectName: input.projectName,
        metadata: input.metadata,
        executionId: EXECUTION_RECORD_FIXTURE_ID,
        jobId: EXECUTION_JOB_FIXTURE_ID,
        queuedAt: input.createdAt,
      }),
    ).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
    await owner.create(input);
    await expect(internal.findByWorkflowId(input.workflowId)).resolves.toMatchObject({
      status: 'CREATED',
    });
    await internal.markRunning({
      workflowId: input.workflowId,
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    await expect(internal.findByExecutionId(EXECUTION_RECORD_FIXTURE_ID)).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
    await expect(internal.findByJobId(EXECUTION_JOB_FIXTURE_ID)).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
    await expect(internal.list()).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
    await expect(globalRead.findByWorkflowId(input.workflowId)).resolves.toMatchObject({
      status: 'RUNNING',
    });
    await expect(globalRead.list()).resolves.toMatchObject({
      items: [{ workflowId: input.workflowId }],
    });
    await expect(
      globalRead.create({ ...input, workflowId: 'workflow-global-create' }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION });
    await expect(
      globalRead.markRunning({
        workflowId: input.workflowId,
        startedAt: '2026-08-07T12:00:00.020Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION });
  });

  it('rejects malformed opaque owner scopes at construction', () => {
    expect(
      () => new PrismaExecutionRecordRepository(context.client, { access: 'OWNER', userId: ' ' }),
    ).toThrowError(
      expect.objectContaining({ code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION }),
    );
  });
});
