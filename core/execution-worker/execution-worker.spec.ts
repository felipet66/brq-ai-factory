import {
  deriveExecutionIdentity,
  type ExecutionEngine,
  type ExecutionOptions,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';
import {
  createInMemoryExecutionRecordRepository,
  createPersistentExecutionEngine,
  type ExecutionRecordRepository,
  type PersistentExecutionHistory,
} from '@brq/execution-repository';
import { createInMemoryJobQueue, type JobQueue } from '@brq/job-queue';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it, vi } from 'vitest';

import type { ExecutionWorker } from './contracts';
import { createExecutionDispatcher } from './execution-dispatcher';
import { EXECUTION_WORKER_ERROR_CODES, ExecutionWorkerError } from './errors';
import { createExecutionWorker } from './execution-worker';
import {
  EXECUTION_WORKER_FIXTURE_EPOCH,
  createCancellationError,
  createCancelledExecutionResultFixture,
  createFailedExecutionResultFixture,
  createSuccessfulExecutionResultFixture,
  createWorkerExecutionRequestFixture,
  incrementalWorkerClock,
} from './testing/execution-worker-fixtures';

function history(): PersistentExecutionHistory {
  return {
    begin() {},
    capture() {},
    complete() {},
    get: () => null,
    flush: vi.fn(async () => undefined),
  };
}

function persistentEngine(
  engine: ExecutionEngine,
  repository: ExecutionRecordRepository,
): ExecutionEngine {
  return createPersistentExecutionEngine({
    engine,
    repository,
    history: history(),
    logger: createLogger({ sink: () => undefined }),
    now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
  });
}

async function dispatch(
  queue: JobQueue,
  repository: ExecutionRecordRepository,
  request: ExecutionRequest,
) {
  return createExecutionDispatcher({
    queue,
    repository,
    now: () => EXECUTION_WORKER_FIXTURE_EPOCH,
  }).dispatch(request);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('execution worker', () => {
  it('settles a job only after the full Factory Pipeline returns its terminal result', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const execute = vi.fn(async () =>
      createFactoryExecutionResultFixture({
        executionId: deriveExecutionIdentity(request).executionId,
        workflowId: request.workflowId,
      }),
    );
    const worker = createExecutionWorker({ queue, repository, pipeline: { execute } });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'SUCCESS' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      job: { status: 'SUCCESS' },
    });
  });

  it('consumes jobs in FIFO order and invokes the public Engine exactly once per job', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const firstRequest = createWorkerExecutionRequestFixture(1);
    const secondRequest = createWorkerExecutionRequestFixture(2);
    const [firstResult, secondResult] = await Promise.all([
      createSuccessfulExecutionResultFixture(firstRequest),
      createSuccessfulExecutionResultFixture(secondRequest),
    ]);
    const results = new Map([
      [firstRequest.workflowId, firstResult],
      [secondRequest.workflowId, secondResult],
    ]);
    const order: string[] = [];
    const execute = vi.fn(async (request: ExecutionRequest) => {
      order.push(request.workflowId);
      return results.get(request.workflowId)!;
    });
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const firstJob = await dispatch(queue, repository, firstRequest);
    const secondJob = await dispatch(queue, repository, secondRequest);

    await worker.drain();
    await worker.drain();

    expect(order).toEqual([firstRequest.workflowId, secondRequest.workflowId]);
    expect(execute).toHaveBeenCalledTimes(2);
    const firstTerminal = await queue.get(firstJob.jobId);
    expect(firstTerminal).toMatchObject({ status: 'SUCCESS', attempt: 1 });
    expect(await queue.get(secondJob.jobId)).toMatchObject({ status: 'SUCCESS', attempt: 1 });
    const firstPersisted = await repository.findByJobId(firstJob.jobId);
    expect(firstPersisted).toMatchObject({
      status: 'SUCCESS',
      job: { status: 'SUCCESS' },
    });
    expect(firstPersisted?.job?.finishedAt).toBe(firstTerminal?.finishedAt);
    expect(firstPersisted?.job?.finishedAt).not.toBe(firstResult.finishedAt);
    expect(await repository.findByJobId(secondJob.jobId)).toMatchObject({
      status: 'SUCCESS',
      job: { status: 'SUCCESS' },
    });
    expect(Object.keys(worker)).not.toContain('retry');
    expect(Object.keys(worker)).not.toContain('requeue');
  });

  it('maps a resolved functional execution failure to a terminal failed job', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createFailedExecutionResultFixture(request);
    const execute = vi.fn(async () => result);
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: result.failure?.code },
    });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'FAILED',
      job: { status: 'FAILED' },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('does not retry when the final job timestamp cannot be refined in persistence', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const baseRepository = createInMemoryExecutionRecordRepository();
    const repository: ExecutionRecordRepository = {
      ...baseRepository,
      markJobTerminal: vi.fn(async () => Promise.reject(new Error('terminal storage secret'))),
    };
    const request = createWorkerExecutionRequestFixture();
    const result = await createSuccessfulExecutionResultFixture(request);
    const execute = vi.fn(async () => result);
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
      logger,
    });
    const job = await dispatch(queue, repository, request);

    await worker.drain();
    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'SUCCESS' });
    expect(await baseRepository.findByJobId(job.jobId)).toMatchObject({
      status: 'SUCCESS',
      job: { status: 'SUCCESS' },
    });
    expect(lines.join('\n')).toContain('execution.worker.terminal.persistence.failed');
    expect(lines.join('\n')).not.toContain('terminal storage secret');
  });

  it('maps an ExecutionEngineError with a terminal result to a cancelled job', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const engineError = createCancellationError(result);
    const execute = vi.fn(async () => Promise.reject(engineError));
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      failure: { code: 'JOB_QUEUE_CANCELLED' },
    });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('fails closed before calling the Engine when RUNNING persistence fails', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const baseRepository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const job = await dispatch(queue, baseRepository, request);
    const repository: ExecutionRecordRepository = {
      ...baseRepository,
      markJobRunning: vi.fn(async () => Promise.reject(new Error('database secret'))),
      markJobTerminal: vi.fn(async (input) => baseRepository.markJobTerminal(input)),
    };
    const execute = vi.fn(async () => createFailedExecutionResultFixture(request));
    const worker = createExecutionWorker({ queue, repository, engine: { execute } });

    await worker.drain();

    expect(execute).not.toHaveBeenCalled();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED },
    });
    expect(await baseRepository.findByJobId(job.jobId)).toMatchObject({
      status: 'CREATED',
      job: { status: 'FAILED' },
    });
    expect(repository.markJobTerminal).toHaveBeenCalledOnce();
  });

  it('sanitizes a technical Engine failure and never retries it', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      logger,
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture(1, {
      demand: {
        title: 'Private title',
        description: 'TOP-SECRET-WORKER-PAYLOAD',
        businessGoal: 'Never log me.',
      },
    });
    const rawFailure = new Error('TOP-SECRET-ENGINE-CAUSE');
    const execute = vi.fn(async () => Promise.reject(rawFailure));
    const worker = createExecutionWorker({ queue, repository, engine: { execute }, logger });
    const job = await dispatch(queue, repository, request);

    await worker.drain();
    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: {
        code: EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED,
        message: 'Falha técnica da execução.',
      },
    });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CREATED',
      job: { status: 'FAILED' },
    });
    expect(lines.join('\n')).toContain('execution.worker.failed');
    expect(lines.join('\n')).toContain(EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED);
    expect(lines.join('\n')).not.toContain('TOP-SECRET');
    expect(lines.join('\n')).not.toContain('Private title');
  });

  it('cancels a queued job without calling the Engine and persists cancellation', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const execute = vi.fn(async () => createFailedExecutionResultFixture(request));
    const worker = createExecutionWorker({ queue, repository, engine: { execute } });
    const job = await dispatch(queue, repository, request);

    const cancelled = await worker.cancel(job.jobId);
    const repeated = await worker.cancel(job.jobId);

    expect(cancelled).toMatchObject({ status: 'CANCELLED', startedAt: null });
    expect(repeated).toEqual(cancelled);
    expect(execute).not.toHaveBeenCalled();
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CREATED',
      job: { status: 'CANCELLED', startedAt: null },
    });
    expect(await worker.cancel(`job-${'f'.repeat(32)}`)).toBeNull();
  });

  it('propagates running cancellation through the job-owned AbortSignal', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const entered = deferred<AbortSignal>();
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        if (options?.signal === undefined) throw new Error('Expected a worker-owned signal.');
        const signal = options.signal;
        entered.resolve(signal);
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(createCancellationError(result)), {
            once: true,
          });
        });
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);
    worker.start();
    const signal = await entered.promise;

    await worker.cancel(job.jobId);
    await worker.drain();

    expect(signal.aborted).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
  });

  it('preserves cancellation requested between queue claim and worker activation', async () => {
    const baseQueue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const claimEntered = deferred<void>();
    const releaseClaim = deferred<void>();
    const queue: JobQueue = {
      ...baseQueue,
      claimNext: vi.fn(async () => {
        const claimed = await baseQueue.claimNext();
        claimEntered.resolve();
        await releaseClaim.promise;
        return claimed;
      }),
    };
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        expect(options?.signal?.aborted).toBe(true);
        throw createCancellationError(result);
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    const draining = worker.drain();
    await claimEntered.promise;
    await expect(worker.cancel(job.jobId)).resolves.toMatchObject({ status: 'RUNNING' });
    releaseClaim.resolve();
    await draining;

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
  });

  it('uses the authoritative cancel result when a stale queued read races with claim', async () => {
    const baseQueue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const secondGetCaptured = deferred<void>();
    const releaseSecondGet = deferred<void>();
    const claimEntered = deferred<void>();
    const releaseClaim = deferred<void>();
    let getCount = 0;
    const queue: JobQueue = {
      ...baseQueue,
      get: vi.fn(async (jobId) => {
        const snapshot = await baseQueue.get(jobId);
        getCount += 1;
        if (getCount === 2) {
          secondGetCaptured.resolve();
          await releaseSecondGet.promise;
        }
        return snapshot;
      }),
      claimNext: vi.fn(async () => {
        const claimed = await baseQueue.claimNext();
        claimEntered.resolve();
        await releaseClaim.promise;
        return claimed;
      }),
    };
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        expect(options?.signal?.aborted).toBe(true);
        throw createCancellationError(result);
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    const cancelling = worker.cancel(job.jobId);
    await secondGetCaptured.promise;
    const draining = worker.drain();
    await claimEntered.promise;
    releaseSecondGet.resolve();
    await expect(cancelling).resolves.toMatchObject({ status: 'CANCELLED' });
    releaseClaim.resolve();
    await draining;

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
  });

  it('shuts down idempotently, aborts the running job and persists queued cancellation', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const runningRequest = createWorkerExecutionRequestFixture(1);
    const queuedRequest = createWorkerExecutionRequestFixture(2);
    const cancelledResult = createCancelledExecutionResultFixture(runningRequest);
    const entered = deferred<AbortSignal>();
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        if (options?.signal === undefined) throw new Error('Expected a worker-owned signal.');
        const signal = options.signal;
        entered.resolve(signal);
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(createCancellationError(cancelledResult)), {
            once: true,
          });
        });
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const runningJob = await dispatch(queue, repository, runningRequest);
    const queuedJob = await dispatch(queue, repository, queuedRequest);
    worker.start();
    const signal = await entered.promise;

    await worker.shutdown();
    await worker.shutdown();

    expect(signal.aborted).toBe(true);
    expect(worker.isStarted()).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(runningJob.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await queue.get(queuedJob.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(runningJob.jobId)).toMatchObject({
      job: { status: 'CANCELLED' },
    });
    expect(await repository.findByJobId(queuedJob.jobId)).toMatchObject({
      job: { status: 'CANCELLED' },
    });
    expect(() => worker.start()).toThrowError(ExecutionWorkerError);
  });

  it('aborts a job claimed concurrently with shutdown before workflow execution starts', async () => {
    const baseQueue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const claimEntered = deferred<void>();
    const releaseClaim = deferred<void>();
    const queue: JobQueue = {
      ...baseQueue,
      claimNext: vi.fn(async () => {
        const claimed = await baseQueue.claimNext();
        claimEntered.resolve();
        await releaseClaim.promise;
        return claimed;
      }),
    };
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        expect(options?.signal?.aborted).toBe(true);
        throw createCancellationError(result);
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    const draining = worker.drain();
    await claimEntered.promise;
    const shutdown = worker.shutdown();
    releaseClaim.resolve();
    await Promise.all([draining, shutdown]);

    expect(execute).toHaveBeenCalledOnce();
    expect(queue.isShutdown()).toBe(true);
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
  });

  it('reports a sanitized shutdown error when queued cancellation cannot be persisted', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const baseRepository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    await dispatch(queue, baseRepository, request);
    const repository: ExecutionRecordRepository = {
      ...baseRepository,
      markJobTerminal: vi.fn(async () =>
        Promise.reject(new Error('TOP-SECRET-SHUTDOWN-PERSISTENCE-CAUSE')),
      ),
    };
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: { execute: vi.fn() as unknown as ExecutionEngine['execute'] },
      logger,
    });

    await expect(worker.shutdown()).rejects.toMatchObject({
      code: EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED,
      message: 'Falha ao persistir o encerramento da fila.',
    });

    expect(queue.isShutdown()).toBe(true);
    expect(lines.join('\n')).toContain('execution.worker.shutdown.persistence.failed');
    expect(lines.join('\n')).toContain(EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED);
    expect(lines.join('\n')).not.toContain('TOP-SECRET');
  });

  it('is start-idempotent and rejects invalid dependencies', async () => {
    expect(() =>
      createExecutionWorker({
        queue: {} as JobQueue,
        engine: {} as ExecutionEngine,
        repository: {} as ExecutionRecordRepository,
      }),
    ).toThrowError(ExecutionWorkerError);

    const queue = createInMemoryJobQueue();
    const repository = createInMemoryExecutionRecordRepository();
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: { execute: vi.fn() as unknown as ExecutionEngine['execute'] },
    });
    worker.start();
    worker.start();
    await worker.drain();

    expect(worker.isStarted()).toBe(true);
    await worker.shutdown();
  });

  it('does not convert an arbitrary error carrying a result-like property into success', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const execute = vi.fn(async () => {
      throw Object.assign(new Error('untrusted'), {
        result: await createSuccessfulExecutionResultFixture(request),
      });
    });
    const worker: ExecutionWorker = createExecutionWorker({
      queue,
      repository,
      engine: { execute },
    });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED },
    });
  });
});
