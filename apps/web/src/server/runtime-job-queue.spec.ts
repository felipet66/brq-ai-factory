// @vitest-environment node

import { deriveExecutionIdentity } from '@brq/execution-engine';
import { createInMemoryExecutionRecordRepository } from '@brq/execution-repository';
import {
  createExecutionRequestFixture,
  createExecutionResultFixture,
} from '@brq/execution-repository/testing';
import { createInMemoryJobQueue } from '@brq/job-queue';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it, vi } from 'vitest';

import { createApplicationQueueRuntime } from './runtime';

describe('application asynchronous execution composition', () => {
  it('dispatches through the local queue and invokes the public Engine exactly once', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const request = createExecutionRequestFixture();
    const identity = deriveExecutionIdentity(request);
    const result = createExecutionResultFixture({ executionId: identity.executionId });
    const execute = vi.fn(async () => {
      await repository.markRunning({
        workflowId: request.workflowId,
        startedAt: result.startedAt!,
      });
      await repository.complete(request.workflowId, result, null);
      return result;
    });
    let time = Date.parse('2026-08-07T12:00:00.000Z');
    const now = () => ++time;
    const runtime = createApplicationQueueRuntime({
      engine: { execute },
      repository,
      queue: createInMemoryJobQueue({ now }),
      logger: createLogger({ sink: () => undefined }),
      now,
    });

    const queued = await runtime.dispatcher.dispatch(request);
    await runtime.worker.drain();
    const terminal = await runtime.queue.get(queued.jobId);

    expect(queued).toMatchObject({ executionId: identity.executionId, status: 'QUEUED' });
    expect(terminal).toMatchObject({ status: 'FAILED', attempt: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await runtime.queue.getMetrics()).retainedPayloads).toBe(0);
  });
});
