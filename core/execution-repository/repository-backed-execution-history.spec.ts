import { createInMemoryExecutionHistory } from '@brq/observability';
import { describe, expect, it, vi } from 'vitest';

import { createInMemoryExecutionRecordRepository } from './adapters/in-memory-execution-record-repository';
import { createRepositoryBackedExecutionHistory } from './repository-backed-execution-history';
import { createExecutionRequestFixture } from './testing/execution-record-fixtures';

describe('repository-backed execution history', () => {
  it('persists allowlisted live snapshots without changing the synchronous reader', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const request = createExecutionRequestFixture();
    await repository.create({
      workflowId: request.workflowId,
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
      projectName: request.demand.title,
      createdAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    await repository.markRunning({
      workflowId: request.workflowId,
      startedAt: '2026-08-07T12:00:00.001Z',
    });
    let time = Date.parse('2026-08-07T12:00:00.010Z');
    const history = createRepositoryBackedExecutionHistory({
      history: createInMemoryExecutionHistory({ now: () => (time += 10) }),
      repository,
    });

    history.begin(request);
    history.capture('info', 'execution.created', {
      workflowId: request.workflowId,
      executionId: `execution-${'a'.repeat(32)}`,
    });
    history.capture('info', 'execution.started', {
      workflowId: request.workflowId,
      executionId: `execution-${'a'.repeat(32)}`,
    });
    await history.flush(request.workflowId);

    const persisted = await repository.findByWorkflowId(request.workflowId);
    expect(persisted?.observation?.status).toBe('RUNNING');
    expect(persisted?.observation?.events[0]?.type).toBe('execution.started');
    expect(history.get(`execution-${'a'.repeat(32)}`)).toEqual(persisted?.observation);
  });

  it('keeps observation writes fail-open', async () => {
    const memory = createInMemoryExecutionHistory({ now: () => 1 });
    const saveObservation = vi.fn(async () => Promise.reject(new Error('database unavailable')));
    const history = createRepositoryBackedExecutionHistory({
      history: memory,
      repository: {
        create: vi.fn(),
        createQueued: vi.fn(),
        markJobRunning: vi.fn(),
        markJobTerminal: vi.fn(),
        failInfrastructure: vi.fn(),
        markRunning: vi.fn(),
        saveObservation,
        complete: vi.fn(),
        findByExecutionId: vi.fn(),
        findByJobId: vi.fn(),
        findByWorkflowId: vi.fn(),
        list: vi.fn(),
      },
    });
    const request = createExecutionRequestFixture();
    history.begin(request);
    expect(() =>
      history.capture('info', 'execution.created', {
        workflowId: request.workflowId,
        executionId: `execution-${'a'.repeat(32)}`,
      }),
    ).not.toThrow();
    await expect(history.flush(request.workflowId)).resolves.toBeUndefined();
    expect(saveObservation).toHaveBeenCalledTimes(1);
  });
});
