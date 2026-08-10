import { describe, expect, it } from 'vitest';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';

import { createInMemoryExecutionRecordRepository } from './adapters/in-memory-execution-record-repository';
import { EXECUTION_REPOSITORY_ERROR_CODES } from './errors';
import {
  EXECUTION_JOB_FIXTURE_ID,
  EXECUTION_RECORD_FIXTURE_ID,
  createExecutionObservationFixture,
  createExecutionResultFixture,
} from './testing/execution-record-fixtures';

const createdInput = (workflowId: string, createdAt = '2026-08-07T12:00:00.000Z') => ({
  workflowId,
  requestId: `request-${workflowId}`,
  traceId: null,
  projectName: `Project ${workflowId}`,
  createdAt,
  metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 as const },
});

describe('in-memory execution record repository', () => {
  it('persists queued job metadata independently and resolves it by jobId', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const queued = await repository.createQueued({
      workflowId: 'workflow-001',
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      jobId: EXECUTION_JOB_FIXTURE_ID,
      requestId: 'request-001',
      traceId: null,
      projectName: 'Queued project',
      queuedAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    const runningJob = await repository.markJobRunning({
      jobId: EXECUTION_JOB_FIXTURE_ID,
      startedAt: '2026-08-07T12:00:00.005Z',
    });
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    const completed = await repository.complete(
      'workflow-001',
      createExecutionResultFixture(),
      createExecutionObservationFixture(),
    );
    const settled = await repository.markJobTerminal({
      jobId: EXECUTION_JOB_FIXTURE_ID,
      status: 'FAILED',
      finishedAt: '2026-08-07T12:00:00.060Z',
    });

    expect(queued).toMatchObject({ status: 'CREATED', job: { status: 'QUEUED' } });
    expect(runningJob.job).toMatchObject({ status: 'RUNNING' });
    expect(completed).toMatchObject({ status: 'FAILED', job: { status: 'FAILED' } });
    expect(settled.job).toMatchObject({
      status: 'FAILED',
      finishedAt: '2026-08-07T12:00:00.060Z',
    });
    expect(await repository.findByJobId(EXECUTION_JOB_FIXTURE_ID)).toEqual(settled);
    expect(Object.isFrozen(settled.job)).toBe(true);
  });

  it('persists queued cancellation without pretending the Engine executed', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await repository.createQueued({
      workflowId: 'workflow-001',
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      jobId: EXECUTION_JOB_FIXTURE_ID,
      requestId: null,
      traceId: null,
      projectName: 'Cancelled before execution',
      queuedAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    const cancelled = await repository.markJobTerminal({
      jobId: EXECUTION_JOB_FIXTURE_ID,
      status: 'CANCELLED',
      finishedAt: '2026-08-07T12:00:00.005Z',
    });

    expect(cancelled.status).toBe('CREATED');
    expect(cancelled.startedAt).toBeNull();
    expect(cancelled.job).toMatchObject({ status: 'CANCELLED' });
    await expect(
      repository.markJobRunning({
        jobId: EXECUTION_JOB_FIXTURE_ID,
        startedAt: '2026-08-07T12:00:00.010Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });

  it('persists the complete lifecycle, observation, hashes and immutable snapshots', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const created = await repository.create(createdInput('workflow-001'));
    const running = await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    const observed = await repository.saveObservation(
      'workflow-001',
      createExecutionObservationFixture(),
    );
    const completed = await repository.complete(
      'workflow-001',
      createExecutionResultFixture(),
      createExecutionObservationFixture(),
    );

    expect(created.status).toBe('CREATED');
    expect(running.status).toBe('RUNNING');
    expect(observed.executionId).toMatch(/^execution-/);
    expect(completed.status).toBe('FAILED');
    expect(completed.readiness).toBe('READY');
    expect(completed.lifecycle.map((event) => event.state)).toEqual([
      'CREATED',
      'RUNNING',
      'FAILED',
    ]);
    expect(completed.hashes.executionHash).toBe('3'.repeat(64));
    expect(completed.observation?.stages).toHaveLength(4);
    expect(Object.isFrozen(completed)).toBe(true);
    expect(Object.isFrozen(completed.observation?.stages)).toBe(true);
    expect(await repository.findByExecutionId(completed.executionId!)).toEqual(completed);
    expect(JSON.stringify(completed)).not.toContain('Allow customers');
    expect(JSON.stringify(completed)).not.toContain('additionalContext');
  });

  it('persiste o resultado metadata-safe da Factory sem conteúdo ou identidade insegura', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const result = createFactoryExecutionResultFixture({
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      workflowId: 'workflow-001',
    });
    await repository.create(createdInput('workflow-001'));
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: result.startedAt,
    });

    const completed = await repository.completeFactory('workflow-001', result, null);
    expect(completed).toMatchObject({
      executionId: result.executionId,
      status: 'SUCCESS',
      workflowStatus: result.execution.status,
      hashes: result.execution.hashes,
      factoryResult: {
        status: 'SUCCESS',
        generationStatus: 'SUCCESS',
        sandboxStatus: 'SUCCESS',
        hashes: { factoryResultHash: result.hashes.factoryResultHash },
      },
    });
    expect(completed.factoryResult?.stages).toHaveLength(11);
    expect(completed.factoryResult?.lineage.sandboxResultHash).toBe(
      result.hashes.sandboxResultHash,
    );
    expect(Object.isFrozen(completed.factoryResult)).toBe(true);
    const serialized = JSON.stringify(completed.factoryResult);
    expect(serialized).not.toMatch(
      /"(?:imageReference|containerId|prompt|content|path|stdout|stderr)"\s*:/,
    );
    await expect(repository.completeFactory('workflow-001', result, null)).resolves.toEqual(
      completed,
    );
  });

  it('supports deterministic pagination and inclusive filters', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await repository.create(createdInput('workflow-a', '2026-08-07T10:00:00.000Z'));
    await repository.create(createdInput('workflow-b', '2026-08-07T11:00:00.000Z'));
    await repository.create(createdInput('workflow-c', '2026-08-07T12:00:00.000Z'));
    await repository.markRunning({
      workflowId: 'workflow-b',
      startedAt: '2026-08-07T11:00:01.000Z',
    });

    const first = await repository.list({ limit: 2 });
    const second = await repository.list({ limit: 2, cursor: first.nextCursor! });
    const running = await repository.list({ status: 'RUNNING' });
    const range = await repository.list({
      createdAfter: '2026-08-07T11:00:00.000Z',
      createdBefore: '2026-08-07T12:00:00.000Z',
    });

    expect(first.items.map((record) => record.workflowId)).toEqual(['workflow-c', 'workflow-b']);
    expect(second.items.map((record) => record.workflowId)).toEqual(['workflow-a']);
    expect(running.items.map((record) => record.workflowId)).toEqual(['workflow-b']);
    expect(range.items.map((record) => record.workflowId)).toEqual(['workflow-c', 'workflow-b']);
  });

  it('rejects duplicates, invalid transitions and divergent terminal writes', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await repository.create(createdInput('workflow-001'));
    await expect(repository.create(createdInput('workflow-001'))).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
    });
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    await expect(
      repository.markRunning({
        workflowId: 'workflow-001',
        startedAt: '2026-08-07T12:00:00.020Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
    const result = createExecutionResultFixture();
    await repository.complete('workflow-001', result, createExecutionObservationFixture());
    await expect(
      repository.complete('workflow-001', result, createExecutionObservationFixture()),
    ).resolves.toMatchObject({ executionId: result.executionId });
    const divergent = createExecutionResultFixture({
      hashes: { ...result.hashes, executionHash: '4'.repeat(64) },
    });
    await expect(
      repository.complete('workflow-001', divergent, createExecutionObservationFixture()),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });

  it('rejects invalid filters instead of normalizing them silently', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await expect(
      repository.list({
        createdAfter: '2026-08-08T00:00:00.000Z',
        createdBefore: '2026-08-07T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT });
  });
});
