import {
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_ENGINE_VERSION,
  deriveExecutionIdentity,
  type ExecutionRequest,
} from '@brq/execution-engine';
import {
  jobExecutionOptionsSchema,
  jobIdSchema,
  type JobExecutionOptions,
  type JobRecord,
} from '@brq/job-queue';

import type { CreateExecutionDispatcherOptions, ExecutionDispatcherWithOptions } from './contracts';
import { EXECUTION_WORKER_ERROR_CODES, ExecutionWorkerError } from './errors';
import { logWorkerEvent } from './logging';

function isoNow(now: () => number): string {
  const value = now();
  if (!Number.isFinite(value)) {
    throw new ExecutionWorkerError('Fonte temporal do dispatcher inválida.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CLOCK,
    });
  }
  return new Date(Math.max(0, Math.round(value))).toISOString();
}

export function createJobId(executionId: string): string {
  return jobIdSchema.parse(`job-${executionId.replace(/^execution-/, '')}`);
}

export function createExecutionDispatcher(
  options: CreateExecutionDispatcherOptions,
): ExecutionDispatcherWithOptions {
  if (
    typeof options.queue?.enqueue !== 'function' ||
    typeof options.queue?.isShutdown !== 'function' ||
    typeof options.repository?.createQueued !== 'function' ||
    typeof options.repository?.markJobTerminal !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new ExecutionWorkerError('Configuração do dispatcher inválida.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
  const now = options.now ?? Date.now;

  const dispatch = async (
    request: ExecutionRequest,
    rawExecutionOptions: JobExecutionOptions,
  ): Promise<JobRecord> => {
    if (options.queue.isShutdown()) {
      throw new ExecutionWorkerError('O dispatcher não aceita jobs após shutdown.', {
        code: EXECUTION_WORKER_ERROR_CODES.SHUTDOWN,
      });
    }
    const executionOptions = jobExecutionOptionsSchema.parse(rawExecutionOptions);
    const identity = deriveExecutionIdentity(request);
    const jobId = createJobId(identity.executionId);
    const queuedAt = isoNow(now);

    await options.repository.createQueued({
      workflowId: request.workflowId,
      executionId: identity.executionId,
      jobId,
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
      projectName: request.demand.title,
      queuedAt,
      metadata: {
        engineVersion: EXECUTION_ENGINE_VERSION,
        contractVersion: EXECUTION_CONTRACT_VERSION,
        attempt: 1,
      },
    });

    try {
      const job = await options.queue.enqueue({
        jobId,
        executionId: identity.executionId,
        request,
        executionOptions,
      });
      logWorkerEvent(options.logger, 'info', 'execution.dispatch.accepted', {
        jobId,
        executionId: identity.executionId,
        workflowId: request.workflowId,
        status: job.status,
      });
      return job;
    } catch (error) {
      await options.repository
        .markJobTerminal({ jobId, status: 'CANCELLED', finishedAt: isoNow(now) })
        .catch(() => undefined);
      throw new ExecutionWorkerError('Não foi possível aceitar o job na fila.', {
        code: EXECUTION_WORKER_ERROR_CODES.DISPATCH_FAILED,
        cause: error,
      });
    }
  };

  return Object.freeze({
    dispatch(request: ExecutionRequest): Promise<JobRecord> {
      return dispatch(request, { cacheMode: 'READ_WRITE', sourceExecutionId: null });
    },
    dispatchWithOptions(
      request: ExecutionRequest,
      executionOptions: JobExecutionOptions,
    ): Promise<JobRecord> {
      return dispatch(request, executionOptions);
    },
  });
}
