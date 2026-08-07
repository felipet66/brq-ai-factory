import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it, vi } from 'vitest';

import { JOB_QUEUE_ERROR_CODES, JobQueueError } from './errors';
import { createInMemoryJobQueue } from './in-memory-job-queue';
import { createJobInputFixture, incrementalQueueClock } from './testing/job-queue-fixtures';

describe('InMemoryJobQueue', () => {
  it('consumes jobs in FIFO order and produces immutable metadata', async () => {
    const queue = createInMemoryJobQueue({ now: incrementalQueueClock(1_000, 10) });
    const first = createJobInputFixture(1);
    const second = createJobInputFixture(2);
    const firstRecord = await queue.enqueue(first);
    await queue.enqueue(second);

    const firstClaim = await queue.claimNext();
    const secondClaim = await queue.claimNext();

    expect(firstClaim?.record.jobId).toBe(first.jobId);
    expect(secondClaim?.record.jobId).toBe(second.jobId);
    expect(await queue.claimNext()).toBeNull();
    expect(firstRecord.status).toBe('QUEUED');
    expect(firstClaim?.record.status).toBe('RUNNING');
    expect(Object.isFrozen(firstClaim)).toBe(true);
    expect(Object.isFrozen(firstClaim?.request)).toBe(true);
  });

  it('tracks successful, failed and cancelled terminal lifecycles without retry', async () => {
    const queue = createInMemoryJobQueue({ now: incrementalQueueClock(0, 10) });
    const success = createJobInputFixture(1);
    const failed = createJobInputFixture(2);
    const cancelled = createJobInputFixture(3);
    await queue.enqueue(success);
    await queue.enqueue(failed);
    await queue.enqueue(cancelled);
    await queue.claimNext();
    const completed = await queue.complete(success.jobId);
    await queue.claimNext();
    const failure = await queue.fail(failed.jobId, {
      code: 'EXECUTION_FAILED',
      message: 'Falha sanitizada.',
    });
    const cancellation = await queue.cancel(cancelled.jobId);

    expect(completed).toMatchObject({ status: 'SUCCESS', failure: null, attempt: 1 });
    expect(failure).toMatchObject({
      status: 'FAILED',
      failure: { code: 'EXECUTION_FAILED' },
      attempt: 1,
    });
    expect(cancellation).toMatchObject({
      status: 'CANCELLED',
      startedAt: null,
      failure: { code: 'JOB_QUEUE_CANCELLED' },
      attempt: 1,
    });
    expect(Object.keys(queue)).not.toContain('retry');
    expect(Object.keys(queue)).not.toContain('requeue');
  });

  it('supports cancellation while running and makes repeated cancellation idempotent', async () => {
    const queue = createInMemoryJobQueue({ now: incrementalQueueClock() });
    const input = createJobInputFixture();
    await queue.enqueue(input);
    await queue.claimNext();
    const cancelled = await queue.cancel(input.jobId);
    const repeated = await queue.cancel(input.jobId);

    expect(cancelled.status).toBe('CANCELLED');
    expect(repeated).toEqual(cancelled);
    expect(repeated.events).toHaveLength(3);
    await expect(queue.complete(input.jobId)).rejects.toMatchObject({
      code: JOB_QUEUE_ERROR_CODES.INVALID_TRANSITION,
    });
  });

  it.each(['jobId', 'workflowId', 'executionId'] as const)(
    'rejects duplicate %s for the adapter lifetime',
    async (identity) => {
      const queue = createInMemoryJobQueue();
      const first = createJobInputFixture(1);
      await queue.enqueue(first);
      const nextBase = createJobInputFixture(2);
      const duplicate =
        identity === 'jobId'
          ? { ...nextBase, jobId: first.jobId }
          : identity === 'executionId'
            ? { ...nextBase, executionId: first.executionId }
            : { ...nextBase, request: first.request };
      await expect(queue.enqueue(duplicate)).rejects.toMatchObject({
        code: JOB_QUEUE_ERROR_CODES.DUPLICATE_JOB,
      });
    },
  );

  it('keeps ExecutionRequest private from metadata queries and events', async () => {
    const queue = createInMemoryJobQueue();
    const input = createJobInputFixture();
    await queue.enqueue(input);

    const record = await queue.get(input.jobId);
    const events = await queue.getEvents(input.jobId);
    expect(record).not.toHaveProperty('request');
    expect(record).not.toHaveProperty('payload');
    expect(JSON.stringify(record)).not.toContain(input.request.demand.description);
    expect(JSON.stringify(events)).not.toContain(input.request.demand.description);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(events)).toBe(true);
  });

  it('publishes immutable typed events and isolates listener failures', async () => {
    const lines: string[] = [];
    const listener = vi.fn((event: unknown) => {
      void event;
      throw new Error('listener secret');
    });
    const queue = createInMemoryJobQueue({
      logger: createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) }),
      now: incrementalQueueClock(),
    });
    const unsubscribe = queue.subscribe(listener);
    const input = createJobInputFixture();
    await expect(queue.enqueue(input)).resolves.toMatchObject({ status: 'QUEUED' });
    unsubscribe();
    await queue.claimNext();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);
    expect(lines.join('\n')).toContain('JOB_QUEUE_LISTENER_FAILED');
    expect(lines.join('\n')).not.toContain('listener secret');
    expect(lines.join('\n')).not.toContain(input.request.demand.description);
  });

  it('reports internally consistent queue metrics', async () => {
    const queue = createInMemoryJobQueue();
    const first = createJobInputFixture(1);
    const second = createJobInputFixture(2);
    await queue.enqueue(first);
    await queue.enqueue(second);
    await queue.claimNext();
    await queue.complete(first.jobId);

    expect(await queue.getMetrics()).toEqual({
      totalJobs: 2,
      queued: 1,
      running: 0,
      success: 1,
      failed: 0,
      cancelled: 0,
      retainedPayloads: 1,
      acceptingJobs: true,
    });
  });

  it('purges private dispatch payloads as soon as jobs become terminal', async () => {
    const queue = createInMemoryJobQueue();
    const success = createJobInputFixture(1);
    const cancelled = createJobInputFixture(2);
    await queue.enqueue(success);
    await queue.enqueue(cancelled);
    expect((await queue.getMetrics()).retainedPayloads).toBe(2);

    await queue.claimNext();
    await queue.complete(success.jobId);
    expect((await queue.getMetrics()).retainedPayloads).toBe(1);
    await queue.cancel(cancelled.jobId);

    expect((await queue.getMetrics()).retainedPayloads).toBe(0);
    expect(await queue.claimNext()).toBeNull();
  });

  it('shuts down idempotently, cancels queued jobs and rejects later enqueues', async () => {
    const queue = createInMemoryJobQueue({ now: incrementalQueueClock() });
    const queued = createJobInputFixture(1);
    const running = createJobInputFixture(2);
    await queue.enqueue(queued);
    await queue.enqueue(running);
    await queue.claimNext();
    await queue.shutdown();
    await queue.shutdown();

    expect(queue.isShutdown()).toBe(true);
    expect(await queue.get(queued.jobId)).toMatchObject({ status: 'RUNNING' });
    expect(await queue.get(running.jobId)).toMatchObject({
      status: 'CANCELLED',
      failure: { code: JOB_QUEUE_ERROR_CODES.SHUTDOWN },
    });
    await expect(queue.enqueue(createJobInputFixture(3))).rejects.toMatchObject({
      code: JOB_QUEUE_ERROR_CODES.SHUTDOWN,
    });
    await expect(queue.complete(queued.jobId)).resolves.toMatchObject({ status: 'SUCCESS' });
  });

  it('rejects missing jobs, malformed failures, invalid transitions and bad configuration', async () => {
    expect(() =>
      createInMemoryJobQueue({ now: 'invalid' as unknown as () => number }),
    ).toThrowError(JobQueueError);
    const queue = createInMemoryJobQueue({ now: () => Number.NaN });
    await expect(queue.enqueue(createJobInputFixture())).rejects.toMatchObject({
      code: JOB_QUEUE_ERROR_CODES.INVALID_CONFIGURATION,
    });

    const validQueue = createInMemoryJobQueue();
    const input = createJobInputFixture();
    await expect(validQueue.cancel(input.jobId)).rejects.toMatchObject({
      code: JOB_QUEUE_ERROR_CODES.NOT_FOUND,
    });
    await validQueue.enqueue(input);
    await expect(validQueue.complete(input.jobId)).rejects.toMatchObject({
      code: JOB_QUEUE_ERROR_CODES.INVALID_TRANSITION,
    });
    await expect(
      validQueue.fail(input.jobId, { code: 'FAILED', message: 'Falha.' }),
    ).rejects.toMatchObject({ code: JOB_QUEUE_ERROR_CODES.INVALID_TRANSITION });
    await validQueue.claimNext();
    await expect(validQueue.fail(input.jobId, { code: '', message: '' })).rejects.toMatchObject({
      code: JOB_QUEUE_ERROR_CODES.INVALID_INPUT,
    });
  });

  it('rejects cancellation after success and invalid lookup identifiers', async () => {
    const queue = createInMemoryJobQueue();
    const input = createJobInputFixture();
    await queue.enqueue(input);
    await queue.claimNext();
    await queue.complete(input.jobId);

    await expect(queue.cancel(input.jobId)).rejects.toMatchObject({
      code: JOB_QUEUE_ERROR_CODES.INVALID_TRANSITION,
    });
    await expect(queue.get('bad-id')).rejects.toMatchObject({
      code: JOB_QUEUE_ERROR_CODES.INVALID_INPUT,
    });
    await expect(queue.getEvents('bad-id')).rejects.toMatchObject({
      code: JOB_QUEUE_ERROR_CODES.INVALID_INPUT,
    });
  });
});
