import { describe, expect, it } from 'vitest';

import { createInMemoryExecutionRecordRepository } from './adapters/in-memory-execution-record-repository';
import { EXECUTION_REPOSITORY_ERROR_CODES } from './errors';
import {
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
