import { ExecutionEngineError, deriveExecutionIdentity } from '@brq/execution-engine';
import { describe, expect, it, vi } from 'vitest';

import type { PersistentExecutionHistory } from './contracts';
import { createInMemoryExecutionRecordRepository } from './adapters/in-memory-execution-record-repository';
import { createPersistentExecutionEngine } from './persistent-execution-engine';
import {
  createExecutionObservationFixture,
  createExecutionRequestFixture,
  createExecutionResultFixture,
} from './testing/execution-record-fixtures';

function history(): PersistentExecutionHistory {
  const snapshot = createExecutionObservationFixture();
  return {
    begin() {},
    capture() {},
    complete() {},
    get: () => snapshot,
    flush: vi.fn(async () => undefined),
  };
}

describe('persistent execution engine coordinator', () => {
  it('reuses only the queued record claimed by the worker', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const request = createExecutionRequestFixture();
    const identity = deriveExecutionIdentity(request);
    const jobId = `job-${identity.executionId.replace('execution-', '')}`;
    await repository.createQueued({
      workflowId: request.workflowId,
      executionId: identity.executionId,
      jobId,
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
      projectName: request.demand.title,
      queuedAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    await repository.markJobRunning({
      jobId,
      startedAt: '2026-08-07T12:00:00.005Z',
    });
    const result = createExecutionResultFixture({ executionId: identity.executionId });
    const execute = vi.fn(async () => result);
    const emptyHistory: PersistentExecutionHistory = {
      begin() {},
      capture() {},
      complete() {},
      get: () => null,
      flush: vi.fn(async () => undefined),
    };
    const engine = createPersistentExecutionEngine({
      engine: { execute },
      repository,
      history: emptyHistory,
      now: () => Date.parse('2026-08-07T12:00:00.010Z'),
    });

    await expect(engine.execute(request)).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(repository.findByJobId(jobId)).resolves.toMatchObject({
      status: 'FAILED',
      job: { status: 'FAILED' },
    });
  });

  it('persists CREATED, RUNNING and terminal state while delegating exactly once', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const result = createExecutionResultFixture();
    const execute = vi.fn(async () => result);
    const engine = createPersistentExecutionEngine({
      engine: { execute },
      repository,
      history: history(),
      now: (() => {
        let time = Date.parse('2026-08-07T12:00:00.000Z');
        return () => (time += 1);
      })(),
    });

    await expect(engine.execute(createExecutionRequestFixture())).resolves.toBe(result);
    const persisted = await repository.findByExecutionId(result.executionId);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(persisted?.status).toBe('FAILED');
    expect(persisted?.projectName).toBe('Order tracking');
    expect(persisted?.lifecycle.map((event) => event.state)).toEqual([
      'CREATED',
      'RUNNING',
      'FAILED',
    ]);
  });

  it('persists cancellation before RUNNING and rethrows the same engine error', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const result = createExecutionResultFixture({
      status: 'CANCELLED',
      startedAt: null,
      timeline: [
        {
          sequence: 1,
          event: 'EXECUTION_CREATED',
          state: 'CREATED',
          timestampMs: 0,
          durationMs: null,
        },
        {
          sequence: 2,
          event: 'EXECUTION_CANCELLED',
          state: 'CANCELLED',
          timestampMs: 40,
          durationMs: 40,
        },
      ],
      failure: {
        kind: 'CANCELLED',
        code: 'EXECUTION_ENGINE_CANCELLED',
        sourceCode: null,
        message: 'Cancelled.',
      },
    });
    const failure = new ExecutionEngineError('Cancelled.', {
      code: 'EXECUTION_ENGINE_CANCELLED',
      state: 'CANCELLED',
      durationMs: 40,
      executionId: result.executionId,
      workflowId: result.workflowId,
      result,
    });
    const execute = vi.fn(async () => Promise.reject(failure));
    const engine = createPersistentExecutionEngine({
      engine: { execute },
      repository,
      history: history(),
      now: () => Date.parse('2026-08-07T12:00:00.000Z'),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      engine.execute(createExecutionRequestFixture(), { signal: controller.signal }),
    ).rejects.toBe(failure);
    const persisted = await repository.findByExecutionId(result.executionId);
    expect(persisted?.lifecycle.map((event) => event.state)).toEqual(['CREATED', 'CANCELLED']);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not call the engine when the initial persistence write fails', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await repository.create({
      workflowId: 'workflow-001',
      requestId: null,
      traceId: null,
      projectName: 'Existing',
      createdAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    const execute = vi.fn(async () => createExecutionResultFixture());
    const engine = createPersistentExecutionEngine({
      engine: { execute },
      repository,
      history: history(),
      now: () => Date.parse('2026-08-07T12:00:00.000Z'),
    });

    await expect(engine.execute(createExecutionRequestFixture())).rejects.toMatchObject({
      code: 'EXECUTION_REPOSITORY_CONFLICT',
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
