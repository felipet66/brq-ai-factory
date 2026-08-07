import {
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_ENGINE_VERSION,
  ExecutionEngineError,
  executionRequestSchema,
  type ExecutionEngine,
  type ExecutionOptions,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';
import { createLogger } from '@brq/shared/logger/logger';

import type { CreatePersistentExecutionEngineOptions } from './contracts';
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

function assertOptions(options: CreatePersistentExecutionEngineOptions): void {
  if (
    typeof options.engine?.execute !== 'function' ||
    typeof options.repository?.create !== 'function' ||
    typeof options.repository?.markRunning !== 'function' ||
    typeof options.repository?.complete !== 'function' ||
    typeof options.history?.flush !== 'function' ||
    typeof options.history?.get !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new ExecutionRepositoryError('Configuração do coordinator persistente inválida.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
}

export function createPersistentExecutionEngine(
  options: CreatePersistentExecutionEngineOptions,
): ExecutionEngine {
  assertOptions(options);
  const now = options.now ?? Date.now;
  const logger = options.logger ?? createLogger();

  const persistTerminal = async (request: ExecutionRequest, result: ExecutionResult) => {
    await options.history.flush(request.workflowId);
    const snapshot = options.history.get(result.executionId);
    const record = await options.repository.complete(request.workflowId, result, snapshot);
    logRepositoryOperation(logger, 'info', 'execution.repository.completed', {
      workflowId: request.workflowId,
      executionId: result.executionId,
      status: result.status,
      ...(record.durationMs === null ? {} : { durationMs: record.durationMs }),
    });
  };

  return Object.freeze({
    async execute(
      rawRequest: ExecutionRequest,
      executionOptions?: ExecutionOptions,
    ): Promise<ExecutionResult> {
      const parsed = executionRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        return options.engine.execute(rawRequest, executionOptions);
      }
      const request = parsed.data;
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

      if (!executionOptions?.signal?.aborted) {
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
        const result = await options.engine.execute(request, executionOptions);
        await persistTerminal(request, result);
        return result;
      } catch (error) {
        if (error instanceof ExecutionEngineError && error.result !== undefined) {
          await persistTerminal(request, error.result);
        }
        throw error;
      }
    },
  });
}
