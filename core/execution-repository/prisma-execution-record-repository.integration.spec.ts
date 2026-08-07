import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryExecutionHistory } from '@brq/observability';

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
  createExecutionObservationFixture,
  createExecutionResultFixture,
} from './testing/execution-record-fixtures';

describe('Prisma execution record repository', () => {
  let context: DatabaseTestContext;

  beforeEach(async () => {
    context = await createDatabaseTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it('round-trips a normalized terminal aggregate across repository instances', async () => {
    const repository = new PrismaExecutionRecordRepository(context.client);
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

    const restartedRepository = new PrismaExecutionRecordRepository(context.client);
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
    const repository = new PrismaExecutionRecordRepository(context.client);
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

  it('persists observation revisions by replacing normalized children atomically', async () => {
    const repository = new PrismaExecutionRecordRepository(context.client);
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
    const repository = new PrismaExecutionRecordRepository(context.client);
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
    const repository = new PrismaExecutionRecordRepository(context.client);
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
});
