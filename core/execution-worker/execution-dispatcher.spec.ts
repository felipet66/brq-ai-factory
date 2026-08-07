import { deriveExecutionIdentity } from '@brq/execution-engine';
import {
  createInMemoryExecutionRecordRepository,
  type ExecutionRecordRepository,
} from '@brq/execution-repository';
import { createInMemoryJobQueue, type JobQueue } from '@brq/job-queue';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it, vi } from 'vitest';

import { createExecutionDispatcher, createJobId } from './execution-dispatcher';
import { EXECUTION_WORKER_ERROR_CODES, ExecutionWorkerError } from './errors';
import {
  EXECUTION_WORKER_FIXTURE_EPOCH,
  createWorkerExecutionRequestFixture,
  incrementalWorkerClock,
} from './testing/execution-worker-fixtures';

describe('execution dispatcher', () => {
  it('reserves the Engine-owned identity and persists QUEUED before enqueueing', async () => {
    const operations: string[] = [];
    const baseRepository = createInMemoryExecutionRecordRepository();
    const baseQueue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 10),
    });
    const repository: ExecutionRecordRepository = {
      ...baseRepository,
      createQueued: vi.fn(async (input) => {
        operations.push('persist');
        return baseRepository.createQueued(input);
      }),
    };
    const queue: JobQueue = {
      ...baseQueue,
      enqueue: vi.fn(async (input) => {
        operations.push('enqueue');
        return baseQueue.enqueue(input);
      }),
    };
    const request = createWorkerExecutionRequestFixture();
    const identity = deriveExecutionIdentity(request);
    const dispatcher = createExecutionDispatcher({
      queue,
      repository,
      now: () => EXECUTION_WORKER_FIXTURE_EPOCH,
    });

    const job = await dispatcher.dispatch(request);
    const persisted = await repository.findByJobId(job.jobId);

    expect(operations).toEqual(['persist', 'enqueue']);
    expect(job).toMatchObject({
      jobId: createJobId(identity.executionId),
      executionId: identity.executionId,
      workflowId: request.workflowId,
      status: 'QUEUED',
    });
    expect(persisted).toMatchObject({
      executionId: identity.executionId,
      status: 'CREATED',
      job: {
        jobId: job.jobId,
        status: 'QUEUED',
        queuedAt: new Date(EXECUTION_WORKER_FIXTURE_EPOCH).toISOString(),
      },
    });
  });

  it('does not expose a job to the queue when initial persistence fails', async () => {
    const baseQueue = createInMemoryJobQueue();
    const enqueue = vi.fn(baseQueue.enqueue);
    const queue: JobQueue = { ...baseQueue, enqueue };
    const repository = {
      createQueued: vi.fn(async () => Promise.reject(new Error('database secret'))),
      markJobTerminal: vi.fn(),
    } as unknown as ExecutionRecordRepository;
    const dispatcher = createExecutionDispatcher({ queue, repository });

    await expect(dispatcher.dispatch(createWorkerExecutionRequestFixture())).rejects.toThrow(
      'database secret',
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(repository.markJobTerminal).not.toHaveBeenCalled();
  });

  it('rolls back a persisted queued record with a sanitized terminal transition', async () => {
    const request = createWorkerExecutionRequestFixture(1, {
      demand: {
        title: 'Private project',
        description: 'TOP-SECRET-DISPATCH-PAYLOAD',
        businessGoal: 'Do not log this content.',
      },
    });
    const repository = createInMemoryExecutionRecordRepository();
    const queue = createInMemoryJobQueue();
    const enqueueFailure = new Error('TOP-SECRET-QUEUE-CAUSE');
    const failingQueue: JobQueue = {
      ...queue,
      enqueue: vi.fn(async () => Promise.reject(enqueueFailure)),
    };
    const lines: string[] = [];
    const dispatcher = createExecutionDispatcher({
      queue: failingQueue,
      repository,
      logger: createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) }),
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 10),
    });

    const error = await dispatcher.dispatch(request).catch((caught: unknown) => caught);
    const identity = deriveExecutionIdentity(request);
    const record = await repository.findByExecutionId(identity.executionId);

    expect(error).toBeInstanceOf(ExecutionWorkerError);
    expect(error).toMatchObject({
      code: EXECUTION_WORKER_ERROR_CODES.DISPATCH_FAILED,
      message: 'Não foi possível aceitar o job na fila.',
    });
    expect((error as Error & { cause?: unknown }).cause).toBe(enqueueFailure);
    expect(record?.job).toMatchObject({ status: 'CANCELLED' });
    expect(JSON.stringify(record)).not.toContain('TOP-SECRET-DISPATCH-PAYLOAD');
    expect(lines.join('\n')).not.toContain('TOP-SECRET');
  });

  it('keeps the dispatch error sanitized even when rollback persistence also fails', async () => {
    const queue = createInMemoryJobQueue();
    const repository = {
      createQueued: vi.fn(async () => ({ storageId: 'record' })),
      markJobTerminal: vi.fn(async () => Promise.reject(new Error('rollback secret'))),
    } as unknown as ExecutionRecordRepository;
    const dispatcher = createExecutionDispatcher({
      queue: { ...queue, enqueue: vi.fn(async () => Promise.reject(new Error('queue secret'))) },
      repository,
      now: () => EXECUTION_WORKER_FIXTURE_EPOCH,
    });

    await expect(dispatcher.dispatch(createWorkerExecutionRequestFixture())).rejects.toMatchObject({
      code: EXECUTION_WORKER_ERROR_CODES.DISPATCH_FAILED,
      message: 'Não foi possível aceitar o job na fila.',
    });
    expect(repository.markJobTerminal).toHaveBeenCalledOnce();
  });

  it('rejects shutdown, invalid configuration, invalid clocks and invalid requests before writes', async () => {
    expect(() =>
      createExecutionDispatcher({
        queue: { enqueue: vi.fn() } as unknown as JobQueue,
        repository: {} as ExecutionRecordRepository,
      }),
    ).toThrowError(ExecutionWorkerError);

    const queue = createInMemoryJobQueue();
    const baseRepository = createInMemoryExecutionRecordRepository();
    expect(() =>
      createExecutionDispatcher({
        queue: { enqueue: vi.fn() } as unknown as JobQueue,
        repository: baseRepository,
      }),
    ).toThrowError(ExecutionWorkerError);
    const createQueued = vi.fn(baseRepository.createQueued);
    const repository: ExecutionRecordRepository = { ...baseRepository, createQueued };
    await queue.shutdown();
    const stopped = createExecutionDispatcher({ queue, repository });
    await expect(stopped.dispatch(createWorkerExecutionRequestFixture())).rejects.toMatchObject({
      code: EXECUTION_WORKER_ERROR_CODES.SHUTDOWN,
    });
    expect(createQueued).not.toHaveBeenCalled();

    const activeQueue = createInMemoryJobQueue();
    const invalidClock = createExecutionDispatcher({
      queue: activeQueue,
      repository,
      now: () => Number.NaN,
    });
    await expect(
      invalidClock.dispatch(createWorkerExecutionRequestFixture()),
    ).rejects.toMatchObject({ code: EXECUTION_WORKER_ERROR_CODES.INVALID_CLOCK });

    const invalidRequest = {
      ...createWorkerExecutionRequestFixture(),
      workflowId: '',
    };
    await expect(
      createExecutionDispatcher({ queue: activeQueue, repository }).dispatch(invalidRequest),
    ).rejects.toMatchObject({ code: 'EXECUTION_ENGINE_INVALID_REQUEST' });
  });

  it('logs only allowlisted technical dispatch metadata', async () => {
    const lines: string[] = [];
    const request = createWorkerExecutionRequestFixture(1, {
      demand: {
        title: 'Secret title',
        description: 'SECRET OBJECTIVE',
        businessGoal: 'SECRET GOAL',
      },
    });
    const dispatcher = createExecutionDispatcher({
      queue: createInMemoryJobQueue(),
      repository: createInMemoryExecutionRecordRepository(),
      logger: createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) }),
    });

    await dispatcher.dispatch(request);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('execution.dispatch.accepted');
    expect(lines[0]).toContain(request.workflowId);
    expect(lines[0]).not.toContain('Secret title');
    expect(lines[0]).not.toContain('SECRET OBJECTIVE');
    expect(lines[0]).not.toContain('SECRET GOAL');
  });
});
