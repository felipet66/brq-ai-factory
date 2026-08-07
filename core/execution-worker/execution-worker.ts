import { ExecutionEngineError, type ExecutionResult } from '@brq/execution-engine';
import type { ClaimedJob, JobFailure, JobRecord } from '@brq/job-queue';

import type { CreateExecutionWorkerOptions, ExecutionWorker } from './contracts';
import { EXECUTION_WORKER_ERROR_CODES, ExecutionWorkerError } from './errors';
import { logWorkerEvent } from './logging';

function assertOptions(options: CreateExecutionWorkerOptions): void {
  if (
    typeof options.queue?.claimNext !== 'function' ||
    typeof options.queue?.subscribe !== 'function' ||
    typeof options.queue?.get !== 'function' ||
    typeof options.queue?.getEvents !== 'function' ||
    typeof options.queue?.complete !== 'function' ||
    typeof options.queue?.fail !== 'function' ||
    typeof options.queue?.cancel !== 'function' ||
    typeof options.queue?.shutdown !== 'function' ||
    typeof options.queue?.isShutdown !== 'function' ||
    typeof options.engine?.execute !== 'function' ||
    typeof options.repository?.markJobRunning !== 'function' ||
    typeof options.repository?.markJobTerminal !== 'function'
  ) {
    throw new ExecutionWorkerError('Configuração do Execution Worker inválida.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
}

function failure(code: string, message: string): JobFailure {
  return Object.freeze({ code, message });
}

function resultFailure(result: ExecutionResult): JobFailure {
  return failure(
    result.failure?.code ?? EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED,
    result.status === 'CANCELLED' ? 'A execução foi cancelada.' : 'A execução terminou com falha.',
  );
}

export function createExecutionWorker(options: CreateExecutionWorkerOptions): ExecutionWorker {
  assertOptions(options);
  let started = false;
  let stopping = false;
  let drainRequested = false;
  let drainPromise: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;
  let active: { readonly jobId: string; readonly controller: AbortController } | null = null;
  const cancellationRequests = new Set<string>();

  const persistInfrastructureFailure = async (
    job: ClaimedJob,
    errorCode: string,
    finishedAt: string,
  ): Promise<void> => {
    await options.repository
      .markJobTerminal({
        jobId: job.record.jobId,
        status: 'FAILED',
        finishedAt,
      })
      .catch(() => undefined);
    logWorkerEvent(options.logger, 'error', 'execution.worker.failed', {
      jobId: job.record.jobId,
      executionId: job.record.executionId,
      workflowId: job.record.workflowId,
      status: 'FAILED',
      errorCode,
    });
  };

  const settleQueue = async (job: ClaimedJob, result: ExecutionResult): Promise<void> => {
    const terminal =
      result.status === 'SUCCESS'
        ? await options.queue.complete(job.record.jobId)
        : result.status === 'CANCELLED'
          ? await options.queue.cancel(job.record.jobId)
          : await options.queue.fail(job.record.jobId, resultFailure(result));
    try {
      await options.repository.markJobTerminal({
        jobId: terminal.jobId,
        status: result.status,
        finishedAt: terminal.finishedAt!,
      });
    } catch {
      logWorkerEvent(options.logger, 'error', 'execution.worker.terminal.persistence.failed', {
        jobId: terminal.jobId,
        executionId: terminal.executionId,
        workflowId: terminal.workflowId,
        status: terminal.status,
        errorCode: EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED,
      });
    }
  };

  const executeClaimed = async (job: ClaimedJob): Promise<void> => {
    const controller = new AbortController();
    active = { jobId: job.record.jobId, controller };
    if (stopping || cancellationRequests.has(job.record.jobId)) controller.abort();
    try {
      await options.repository.markJobRunning({
        jobId: job.record.jobId,
        startedAt: job.record.startedAt!,
      });
    } catch {
      const failed = await options.queue.fail(
        job.record.jobId,
        failure(EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED, 'Falha ao iniciar o job.'),
      );
      await persistInfrastructureFailure(
        job,
        EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED,
        failed.finishedAt!,
      );
      cancellationRequests.delete(job.record.jobId);
      active = null;
      return;
    }

    try {
      const result = await options.engine.execute(job.request, { signal: controller.signal });
      await settleQueue(job, result);
    } catch (error) {
      if (error instanceof ExecutionEngineError && error.result !== undefined) {
        await settleQueue(job, error.result);
      } else {
        const failed = await options.queue.fail(
          job.record.jobId,
          failure(EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED, 'Falha técnica da execução.'),
        );
        await persistInfrastructureFailure(
          job,
          EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED,
          failed.finishedAt!,
        );
      }
    } finally {
      cancellationRequests.delete(job.record.jobId);
      active = null;
    }
  };

  const runDrain = (): Promise<void> => {
    if (drainPromise !== null) return drainPromise;
    drainPromise = (async () => {
      do {
        drainRequested = false;
        while (!stopping) {
          const next = await options.queue.claimNext();
          if (next === null) break;
          await executeClaimed(next);
        }
      } while (drainRequested && !stopping);
    })().finally(() => {
      drainPromise = null;
      if (drainRequested && !stopping) void runDrain();
    });
    return drainPromise;
  };

  const requestDrain = (): void => {
    drainRequested = true;
    queueMicrotask(() => {
      if (started && !stopping) void runDrain();
    });
  };

  return Object.freeze({
    start(): void {
      if (stopping || options.queue.isShutdown()) {
        throw new ExecutionWorkerError('O worker já foi encerrado.', {
          code: EXECUTION_WORKER_ERROR_CODES.SHUTDOWN,
        });
      }
      if (started) return;
      started = true;
      unsubscribe = options.queue.subscribe((event) => {
        if (event.type === 'job.created') requestDrain();
      });
      requestDrain();
    },

    async drain(): Promise<void> {
      if (!started) this.start();
      requestDrain();
      await runDrain();
    },

    async cancel(jobId: string): Promise<JobRecord | null> {
      const job = await options.queue.get(jobId);
      if (job === null) return null;
      if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(job.status)) return job;

      cancellationRequests.add(jobId);
      const current = await options.queue.get(jobId);
      if (current === null) {
        cancellationRequests.delete(jobId);
        return null;
      }
      if (current.status === 'QUEUED') {
        const cancelled = await options.queue.cancel(jobId);
        if (cancelled.startedAt === null) {
          cancellationRequests.delete(jobId);
          await options.repository.markJobTerminal({
            jobId,
            status: 'CANCELLED',
            finishedAt: cancelled.finishedAt!,
          });
        } else if (active?.jobId === jobId) {
          active.controller.abort();
        }
        return cancelled;
      }
      if (current.status === 'RUNNING' && active?.jobId === jobId) active.controller.abort();
      if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(current.status)) {
        cancellationRequests.delete(jobId);
      }
      return current;
    },

    async shutdown(): Promise<void> {
      if (stopping) {
        await (drainPromise ?? Promise.resolve());
        return;
      }
      stopping = true;
      unsubscribe?.();
      unsubscribe = null;
      active?.controller.abort();
      await options.queue.shutdown();
      const createdJobIds = new Set(
        (await options.queue.getEvents())
          .filter((event) => event.type === 'job.created')
          .map((event) => event.jobId),
      );
      const queuedCancellations = await Promise.all(
        [...createdJobIds].map(async (jobId) => {
          const job = await options.queue.get(jobId);
          if (job?.status !== 'CANCELLED' || job.startedAt !== null) return null;
          return { jobId, finishedAt: job.finishedAt! };
        }),
      );
      const persistence = Promise.allSettled(
        queuedCancellations
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
          .map((entry) =>
            options.repository.markJobTerminal({
              jobId: entry.jobId,
              status: 'CANCELLED',
              finishedAt: entry.finishedAt,
            }),
          ),
      );
      await (drainPromise ?? Promise.resolve());
      const outcomes = await persistence;
      const failed = outcomes.find(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );
      if (failed !== undefined) {
        logWorkerEvent(options.logger, 'error', 'execution.worker.shutdown.persistence.failed', {
          errorCode: EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED,
        });
        throw new ExecutionWorkerError('Falha ao persistir o encerramento da fila.', {
          code: EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED,
          cause: failed.reason,
        });
      }
    },

    isStarted(): boolean {
      return started && !stopping;
    },
  });
}
