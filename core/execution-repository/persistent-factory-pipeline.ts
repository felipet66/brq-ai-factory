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
import {
  factoryExecutionObservabilitySnapshotSchema,
  type FactoryExecutionObservabilitySnapshot,
} from '@brq/observability';
import { createLogger } from '@brq/shared/logger/logger';

import type { CreatePersistentFactoryPipelineOptions } from './contracts';
import { EXECUTION_REPOSITORY_ERROR_CODES, ExecutionRepositoryError } from './errors';
import { logRepositoryOperation } from './logging';

const SAFE_TECHNICAL_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const OBSERVATION_FAILURE_CODE = 'EXECUTION_REPOSITORY_OBSERVATION_FAILED';

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
    typeof options.repository?.saveTechnicalCheckpoint !== 'function' ||
    typeof options.history?.flush !== 'function' ||
    typeof options.history?.get !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new ExecutionRepositoryError('Configuração do pipeline persistente inválida.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
}

function observationFailureCode(error: unknown): string {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return OBSERVATION_FAILURE_CODE;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' && SAFE_TECHNICAL_CODE.test(code)
    ? code
    : OBSERVATION_FAILURE_CODE;
}

export function createPersistentFactoryPipeline(
  options: CreatePersistentFactoryPipelineOptions,
): FactoryPipelineCoordinator {
  assertOptions(options);
  const now = options.now ?? Date.now;
  const logger = options.logger ?? createLogger();

  const terminalSnapshot = async (
    request: ExecutionRequest,
    result: FactoryExecutionResult,
    jobId: string | undefined,
  ): Promise<FactoryExecutionObservabilitySnapshot | null> => {
    try {
      await options.history.flush(request.workflowId);
      const snapshot = options.history.get(result.executionId);
      if (snapshot === null) return null;
      const parsed = factoryExecutionObservabilitySnapshotSchema.safeParse(snapshot);
      if (!parsed.success) {
        throw Object.assign(new Error('Snapshot observacional terminal inválido.'), {
          code: 'OBSERVABILITY_INVALID_SNAPSHOT',
        });
      }
      return parsed.data;
    } catch (error) {
      logRepositoryOperation(
        logger,
        'warn',
        'execution.repository.factory_observation.terminal.failed',
        {
          executionId: result.executionId,
          ...(jobId === undefined ? {} : { jobId }),
          stage: result.terminalStage,
          status: result.status,
          errorCode: observationFailureCode(error),
        },
      );
      return null;
    }
  };

  const persistTerminal = async (
    request: ExecutionRequest,
    result: FactoryExecutionResult,
    jobId: string | undefined,
  ) => {
    const snapshot = await terminalSnapshot(request, result, jobId);
    const record = await options.repository.completeFactory(request.workflowId, result, snapshot);
    logRepositoryOperation(logger, 'info', 'execution.repository.factory_completed', {
      workflowId: request.workflowId,
      executionId: result.executionId,
      status: result.status,
      ...(record.durationMs === null ? {} : { durationMs: record.durationMs }),
    });
  };

  return Object.freeze({
    ...(options.pipeline.preflight === undefined
      ? {}
      : {
          preflight: options.pipeline.preflight.bind(options.pipeline),
        }),
    ...(options.pipeline.resumeTechnical === undefined
      ? {}
      : {
          resumeTechnical: options.pipeline.resumeTechnical.bind(options.pipeline),
        }),
    async execute(
      rawRequest: ExecutionRequest,
      runOptions?: FactoryPipelineRunOptions,
    ): Promise<FactoryExecutionResult> {
      const parsed = executionRequestSchema.safeParse(rawRequest);
      if (!parsed.success) return options.pipeline.execute(rawRequest, runOptions);
      const request = parsed.data;
      const existing = await options.repository.findByWorkflowId(request.workflowId);
      const jobId = existing?.job?.jobId;
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
        const result = await options.pipeline.execute(
          request,
          options.pipeline.resumeTechnical === undefined
            ? runOptions
            : {
                ...runOptions,
                onTechnicalCheckpoint: async (checkpoint) => {
                  await options.repository.saveTechnicalCheckpoint({
                    checkpoint,
                    createdAt: isoNow(now),
                  });
                  await runOptions?.onTechnicalCheckpoint?.(checkpoint);
                },
              },
        );
        await persistTerminal(request, result, jobId);
        return result;
      } catch (error) {
        if (error instanceof FactoryPipelineError && error.result !== undefined) {
          await persistTerminal(request, error.result, jobId);
        }
        throw error;
      }
    },
  });
}
