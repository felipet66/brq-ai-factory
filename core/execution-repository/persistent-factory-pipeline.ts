import {
  FactoryPipelineError,
  type FactoryExecutionResult,
  type FactoryPipelineCoordinator,
  type FactoryPipelineRunOptions,
} from '@brq/factory-pipeline';
import {
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_ENGINE_VERSION,
  deriveExecutionIdentity,
  executionRequestSchema,
  type ExecutionRequest,
} from '@brq/execution-engine';
import { createLogger } from '@brq/shared/logger/logger';

import type { CreatePersistentFactoryPipelineOptions } from './contracts';
import { EXECUTION_REPOSITORY_ERROR_CODES, ExecutionRepositoryError } from './errors';
import { logRepositoryOperation } from './logging';

function isoNow(now: () => number): string {
  const value = now();
  if (!Number.isFinite(value)) {
    throw new ExecutionRepositoryError('Fonte temporal do repositório inválida.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
  return new Date(Math.max(0, Math.round(value))).toISOString();
}

function assertOptions(options: CreatePersistentFactoryPipelineOptions): void {
  if (
    typeof options.pipeline?.execute !== 'function' ||
    typeof options.repository?.create !== 'function' ||
    typeof options.repository?.findByWorkflowId !== 'function' ||
    typeof options.repository?.markRunning !== 'function' ||
    typeof options.repository?.completeFactory !== 'function' ||
    typeof options.history?.flush !== 'function' ||
    typeof options.history?.get !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new ExecutionRepositoryError('Configuração do pipeline persistente inválida.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
}

export function createPersistentFactoryPipeline(
  options: CreatePersistentFactoryPipelineOptions,
): FactoryPipelineCoordinator {
  assertOptions(options);
  const now = options.now ?? Date.now;
  const logger = options.logger ?? createLogger();

  const persistTerminal = async (request: ExecutionRequest, result: FactoryExecutionResult) => {
    await options.history.flush(request.workflowId);
    const snapshot = options.history.get(result.executionId);
    const record = await options.repository.completeFactory(request.workflowId, result, snapshot);
    logRepositoryOperation(logger, 'info', 'execution.repository.factory_completed', {
      workflowId: request.workflowId,
      executionId: result.executionId,
      status: result.status,
      ...(record.durationMs === null ? {} : { durationMs: record.durationMs }),
    });
  };

  return Object.freeze({
    async execute(
      rawRequest: ExecutionRequest,
      runOptions?: FactoryPipelineRunOptions,
    ): Promise<FactoryExecutionResult> {
      const parsed = executionRequestSchema.safeParse(rawRequest);
      if (!parsed.success) return options.pipeline.execute(rawRequest, runOptions);
      const request = parsed.data;
      const existing = await options.repository.findByWorkflowId(request.workflowId);
      if (existing === null) {
        await options.repository.create({
          workflowId: request.workflowId,
          requestId: request.requestId ?? null,
          traceId: request.traceId ?? null,
          projectName: request.demand.title,
          createdAt: isoNow(now),
          metadata: {
            engineVersion: EXECUTION_ENGINE_VERSION,
            contractVersion: EXECUTION_CONTRACT_VERSION,
            attempt: 1,
          },
        });
        logRepositoryOperation(logger, 'info', 'execution.repository.created', {
          workflowId: request.workflowId,
          status: 'CREATED',
        });
      } else {
        const identity = deriveExecutionIdentity(request);
        if (
          existing.status !== 'CREATED' ||
          existing.executionId !== identity.executionId ||
          existing.job?.status !== 'RUNNING'
        ) {
          throw new ExecutionRepositoryError('Registro preexistente não pertence ao job ativo.', {
            code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
          });
        }
        logRepositoryOperation(logger, 'info', 'execution.repository.job.reused', {
          workflowId: request.workflowId,
          executionId: identity.executionId,
          jobId: existing.job.jobId,
          status: existing.job.status,
        });
      }

      if (!runOptions?.signal?.aborted) {
        await options.repository.markRunning({
          workflowId: request.workflowId,
          startedAt: isoNow(now),
        });
        logRepositoryOperation(logger, 'info', 'execution.repository.running', {
          workflowId: request.workflowId,
          status: 'RUNNING',
        });
      }

      try {
        const result = await options.pipeline.execute(request, runOptions);
        await persistTerminal(request, result);
        return result;
      } catch (error) {
        if (error instanceof FactoryPipelineError && error.result !== undefined) {
          await persistTerminal(request, error.result);
        }
        throw error;
      }
    },
  });
}
