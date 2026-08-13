import type { ExecutionRequest } from '@brq/execution-engine';

import type {
  ClaimedJob,
  CreateInMemoryJobQueueOptions,
  EnqueueJobInput,
  JobFailure,
  JobExecutionOptions,
  JobQueue,
  JobRecord,
  JobStatus,
  QueueEvent,
  QueueEventListener,
  QueueEventType,
  QueueMetrics,
} from './contracts';
import { JOB_QUEUE_ERROR_CODES, JobQueueError } from './errors';
import { immutableClone } from './immutability';
import { logQueueEvent, logQueueShutdown } from './logging';
import { enqueueJobInputSchema, jobFailureSchema, jobIdSchema, jobRecordSchema } from './schemas';

interface StoredJob {
  record: JobRecord;
  request: ExecutionRequest | null;
  executionOptions: JobExecutionOptions | null;
}

const CANCELLED_FAILURE: JobFailure = Object.freeze({
  code: 'JOB_QUEUE_CANCELLED',
  message: 'O job foi cancelado.',
});

const SHUTDOWN_FAILURE: JobFailure = Object.freeze({
  code: JOB_QUEUE_ERROR_CODES.SHUTDOWN,
  message: 'O job foi cancelado durante o encerramento da fila.',
});

function validateOptions(options: CreateInMemoryJobQueueOptions): void {
  const logger = options.logger;
  const validLogger =
    logger === undefined ||
    (logger !== null &&
      typeof logger === 'object' &&
      typeof logger.debug === 'function' &&
      typeof logger.info === 'function' &&
      typeof logger.warn === 'function' &&
      typeof logger.error === 'function');
  if ((options.now !== undefined && typeof options.now !== 'function') || !validLogger) {
    throw new JobQueueError('Configuração da fila de jobs inválida.', {
      code: JOB_QUEUE_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
}

function invalidInput(message: string, cause?: unknown): JobQueueError {
  return new JobQueueError(message, {
    code: JOB_QUEUE_ERROR_CODES.INVALID_INPUT,
    ...(cause === undefined ? {} : { cause }),
  });
}

function elapsed(startedAt: string, finishedAt: string): number {
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

export function createInMemoryJobQueue(options: CreateInMemoryJobQueueOptions = {}): JobQueue {
  validateOptions(options);
  const jobs = new Map<string, StoredJob>();
  const workflowIds = new Set<string>();
  const executionIds = new Set<string>();
  const pending: string[] = [];
  const allEvents: QueueEvent[] = [];
  const listeners = new Set<QueueEventListener>();
  const now = options.now ?? Date.now;
  let lastTimestamp = 0;
  let shutdown = false;

  const timestamp = (): string => {
    const observed = now();
    if (!Number.isFinite(observed)) {
      throw new JobQueueError('Fonte temporal da fila de jobs inválida.', {
        code: JOB_QUEUE_ERROR_CODES.INVALID_CONFIGURATION,
      });
    }
    lastTimestamp = Math.max(lastTimestamp, Math.max(0, Math.round(observed)));
    return new Date(lastTimestamp).toISOString();
  };

  const find = (jobId: string): StoredJob => {
    const validId = jobIdSchema.safeParse(jobId);
    if (!validId.success) throw invalidInput('jobId inválido.', validId.error);
    const stored = jobs.get(validId.data);
    if (stored === undefined) {
      throw new JobQueueError('Job não encontrado.', { code: JOB_QUEUE_ERROR_CODES.NOT_FOUND });
    }
    return stored;
  };

  const publish = (event: QueueEvent): void => {
    const immutable = immutableClone(event);
    allEvents.push(immutable);
    logQueueEvent(options.logger, immutable);
    for (const listener of listeners) {
      try {
        listener(immutableClone(immutable));
      } catch {
        options.logger?.warn('job.queue.listener.failed', {
          jobId: immutable.jobId,
          executionId: immutable.executionId,
          error: { code: 'JOB_QUEUE_LISTENER_FAILED' },
        });
      }
    }
  };

  const store = (
    record: JobRecord,
    request: ExecutionRequest | null,
    executionOptions: JobExecutionOptions | null,
  ): JobRecord => {
    const parsed = jobRecordSchema.safeParse(record);
    if (!parsed.success) throw invalidInput('Estado interno do job inválido.', parsed.error);
    const immutableRecord = immutableClone(parsed.data);
    jobs.set(record.jobId, {
      record: immutableRecord,
      request: request === null ? null : immutableClone(request),
      executionOptions: executionOptions === null ? null : immutableClone(executionOptions),
    });
    return immutableClone(immutableRecord);
  };

  const transition = (
    stored: StoredJob,
    status: Exclude<JobStatus, 'QUEUED'>,
    eventType: Exclude<QueueEventType, 'job.created'>,
    failure: JobFailure | null,
  ): JobRecord => {
    const occurredAt = timestamp();
    const startedAt = status === 'RUNNING' ? occurredAt : stored.record.startedAt;
    const terminal = status !== 'RUNNING';
    const durationMs = terminal ? elapsed(startedAt ?? stored.record.queuedAt, occurredAt) : null;
    const event: QueueEvent = {
      sequence: stored.record.events.length + 1,
      type: eventType,
      jobId: stored.record.jobId,
      executionId: stored.record.executionId,
      workflowId: stored.record.workflowId,
      status,
      occurredAt,
      durationMs,
      errorCode: failure?.code ?? null,
    };
    const record = store(
      {
        ...stored.record,
        status,
        startedAt,
        finishedAt: terminal ? occurredAt : null,
        durationMs,
        failure,
        events: [...stored.record.events, event],
      },
      terminal ? null : stored.request,
      terminal ? null : stored.executionOptions,
    );
    publish(event);
    return record;
  };

  const cancelWith = (jobId: string, failure: JobFailure): JobRecord => {
    const stored = find(jobId);
    if (stored.record.status === 'CANCELLED') return immutableClone(stored.record);
    if (stored.record.status === 'SUCCESS' || stored.record.status === 'FAILED') {
      throw new JobQueueError('Um job terminal não pode ser cancelado.', {
        code: JOB_QUEUE_ERROR_CODES.INVALID_TRANSITION,
      });
    }
    return transition(stored, 'CANCELLED', 'job.cancelled', failure);
  };

  return Object.freeze({
    async enqueue(rawInput: EnqueueJobInput): Promise<JobRecord> {
      if (shutdown) {
        throw new JobQueueError('A fila não aceita novos jobs após shutdown.', {
          code: JOB_QUEUE_ERROR_CODES.SHUTDOWN,
        });
      }
      const parsed = enqueueJobInputSchema.safeParse(rawInput);
      if (!parsed.success) throw invalidInput('Entrada de job inválida.', parsed.error);
      const input = parsed.data;
      if (
        jobs.has(input.jobId) ||
        workflowIds.has(input.request.workflowId) ||
        executionIds.has(input.executionId)
      ) {
        throw new JobQueueError('Job, workflow ou execução já enfileirado.', {
          code: JOB_QUEUE_ERROR_CODES.DUPLICATE_JOB,
        });
      }
      const queuedAt = timestamp();
      const event: QueueEvent = {
        sequence: 1,
        type: 'job.created',
        jobId: input.jobId,
        executionId: input.executionId,
        workflowId: input.request.workflowId,
        status: 'QUEUED',
        occurredAt: queuedAt,
        durationMs: null,
        errorCode: null,
      };
      const record = store(
        {
          jobId: input.jobId,
          executionId: input.executionId,
          workflowId: input.request.workflowId,
          status: 'QUEUED',
          attempt: 1,
          queuedAt,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          failure: null,
          events: [event],
        },
        input.request,
        input.executionOptions,
      );
      workflowIds.add(input.request.workflowId);
      executionIds.add(input.executionId);
      pending.push(input.jobId);
      publish(event);
      return record;
    },

    async claimNext(): Promise<ClaimedJob | null> {
      while (pending.length > 0) {
        const jobId = pending.shift()!;
        const stored = jobs.get(jobId);
        if (stored === undefined || stored.record.status !== 'QUEUED') continue;
        if (stored.request === null || stored.executionOptions === null) {
          throw new JobQueueError('Payload de dispatch ausente para job QUEUED.', {
            code: JOB_QUEUE_ERROR_CODES.INVALID_CONFIGURATION,
          });
        }
        const record = transition(stored, 'RUNNING', 'job.started', null);
        return immutableClone({
          record,
          request: stored.request,
          executionOptions: stored.executionOptions,
        });
      }
      return null;
    },

    async complete(jobId: string): Promise<JobRecord> {
      const stored = find(jobId);
      if (stored.record.status !== 'RUNNING') {
        throw new JobQueueError('Somente um job RUNNING pode ser concluído.', {
          code: JOB_QUEUE_ERROR_CODES.INVALID_TRANSITION,
        });
      }
      return transition(stored, 'SUCCESS', 'job.finished', null);
    },

    async fail(jobId: string, rawFailure: JobFailure): Promise<JobRecord> {
      const stored = find(jobId);
      if (stored.record.status !== 'RUNNING') {
        throw new JobQueueError('Somente um job RUNNING pode falhar.', {
          code: JOB_QUEUE_ERROR_CODES.INVALID_TRANSITION,
        });
      }
      const failure = jobFailureSchema.safeParse(rawFailure);
      if (!failure.success) throw invalidInput('Falha de job inválida.', failure.error);
      return transition(stored, 'FAILED', 'job.failed', failure.data);
    },

    async cancel(jobId: string): Promise<JobRecord> {
      return cancelWith(jobId, CANCELLED_FAILURE);
    },

    async get(jobId: string): Promise<JobRecord | null> {
      const validId = jobIdSchema.safeParse(jobId);
      if (!validId.success) throw invalidInput('jobId inválido.', validId.error);
      const stored = jobs.get(validId.data);
      return stored === undefined ? null : immutableClone(stored.record);
    },

    async getEvents(jobId?: string): Promise<readonly QueueEvent[]> {
      if (jobId === undefined) return immutableClone(allEvents);
      const validId = jobIdSchema.safeParse(jobId);
      if (!validId.success) throw invalidInput('jobId inválido.', validId.error);
      return immutableClone(allEvents.filter((event) => event.jobId === validId.data));
    },

    async getMetrics(): Promise<QueueMetrics> {
      const counts: Record<JobStatus, number> = {
        QUEUED: 0,
        RUNNING: 0,
        SUCCESS: 0,
        FAILED: 0,
        CANCELLED: 0,
      };
      for (const { record } of jobs.values()) counts[record.status] += 1;
      return immutableClone({
        totalJobs: jobs.size,
        queued: counts.QUEUED,
        running: counts.RUNNING,
        success: counts.SUCCESS,
        failed: counts.FAILED,
        cancelled: counts.CANCELLED,
        retainedPayloads: [...jobs.values()].filter((stored) => stored.request !== null).length,
        acceptingJobs: !shutdown,
      });
    },

    subscribe(listener: QueueEventListener): () => void {
      if (typeof listener !== 'function') throw invalidInput('Listener da fila inválido.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async shutdown(): Promise<void> {
      if (shutdown) return;
      shutdown = true;
      const queuedIds = pending.splice(0);
      for (const jobId of queuedIds) {
        const stored = jobs.get(jobId);
        if (stored?.record.status === 'QUEUED') cancelWith(jobId, SHUTDOWN_FAILURE);
      }
      logQueueShutdown(
        options.logger,
        [...jobs.values()].map((stored) => stored.record),
      );
    },

    isShutdown(): boolean {
      return shutdown;
    },
  });
}
