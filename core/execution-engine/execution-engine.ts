import {
  ORCHESTRATOR_ERROR_CODES,
  OrchestratorError,
  workflowRequestSchema,
  workflowResultSchema,
  type WorkflowRequest,
  type WorkflowResult,
} from '@brq/orchestrator';
import { createLogger } from '@brq/shared/logger/logger';

import type {
  CreateExecutionEngineOptions,
  ExecutionEngine,
  ExecutionFailure,
  ExecutionIdentity,
  ExecutionOptions,
  ExecutionRequest,
  ExecutionResult,
  ExecutionState,
  ExecutionTimelineEvent,
} from './contracts';
import {
  EXECUTION_ENGINE_ERROR_CODES,
  ExecutionEngineError,
  type ExecutionEngineErrorCode,
} from './errors';
import { createExecutionResult } from './execution-result';
import { calculateCanonicalJsonHash, createDeterministicExecutionId } from './hashing';
import { deepFreeze } from './immutability';
import { executionLogContext } from './logging';
import { executionIdentitySchema, executionRequestSchema } from './schemas';
import { transitionExecutionState } from './state-machine';

export const EXECUTION_ENGINE_VERSION = '1.0.0';
export const EXECUTION_CONTRACT_VERSION = '1.0.0';

class ExecutionBoundaryError extends Error {
  readonly code: ExecutionEngineErrorCode;
  readonly sourceCode: string | null;

  constructor(
    message: string,
    options: {
      readonly code: ExecutionEngineErrorCode;
      readonly sourceCode?: string;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ExecutionBoundaryError';
    this.code = options.code;
    this.sourceCode = options.sourceCode ?? null;
  }
}

function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}

function assertDependencies(options: CreateExecutionEngineOptions): void {
  const logger = options.logger;
  const validLogger =
    logger === undefined ||
    (logger !== null &&
      typeof logger === 'object' &&
      typeof logger.debug === 'function' &&
      typeof logger.info === 'function' &&
      typeof logger.warn === 'function' &&
      typeof logger.error === 'function');

  if (
    typeof options.orchestrator?.execute !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function') ||
    !validLogger
  ) {
    throw new ExecutionEngineError('Configuração do Execution Engine inválida.', {
      code: EXECUTION_ENGINE_ERROR_CODES.INVALID_CONFIGURATION,
      state: 'CREATED',
      durationMs: 0,
    });
  }
}

function parseExecutionRequest(rawRequest: ExecutionRequest): ExecutionRequest {
  const parsedRequest = executionRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    throw new ExecutionEngineError('ExecutionRequest inválido.', {
      code: EXECUTION_ENGINE_ERROR_CODES.INVALID_REQUEST,
      state: 'CREATED',
      durationMs: 0,
      cause: parsedRequest.error,
    });
  }
  return parsedRequest.data;
}

function identityFor(request: ExecutionRequest): ExecutionIdentity {
  const executionRequestHash = calculateCanonicalJsonHash(request);
  return deepFreeze(
    executionIdentitySchema.parse({
      executionRequestHash,
      executionId: createDeterministicExecutionId(executionRequestHash, EXECUTION_CONTRACT_VERSION),
    }),
  );
}

export function deriveExecutionIdentity(rawRequest: ExecutionRequest): ExecutionIdentity {
  return identityFor(parseExecutionRequest(rawRequest));
}

function parseWorkflowResult(value: unknown): WorkflowResult {
  const parsed = workflowResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExecutionBoundaryError('O Orchestrator retornou um contrato inválido.', {
      code: EXECUTION_ENGINE_ERROR_CODES.CONTRACT_VIOLATION,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function assertWorkflowCorrelation(
  result: WorkflowResult,
  request: WorkflowRequest,
  workflowRequestHash: string,
): void {
  if (
    result.executionId !== request.executionId ||
    result.workflowId !== request.workflowId ||
    result.hashes.requestHash !== workflowRequestHash
  ) {
    throw new ExecutionBoundaryError('WorkflowResult não corresponde à ExecutionRequest.', {
      code: EXECUTION_ENGINE_ERROR_CODES.CONTRACT_VIOLATION,
    });
  }
}

function failureForWorkflow(result: WorkflowResult): ExecutionFailure | null {
  if (result.status === 'SUCCESS') return null;
  if (result.status === 'CANCELLED') {
    return {
      kind: 'CANCELLED',
      code: EXECUTION_ENGINE_ERROR_CODES.CANCELLED,
      sourceCode: result.failure.code,
      message: 'A execução foi cancelada.',
    };
  }
  return {
    kind: 'WORKFLOW_FAILED',
    code: EXECUTION_ENGINE_ERROR_CODES.ORCHESTRATOR_FAILED,
    sourceCode: result.failure.code,
    message: 'A execução foi encerrada por falha funcional do workflow.',
  };
}

export function createExecutionEngine(options: CreateExecutionEngineOptions): ExecutionEngine {
  assertDependencies(options);
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.timeOrigin + performance.now());
  const metadata = {
    engineVersion: EXECUTION_ENGINE_VERSION,
    contractVersion: EXECUTION_CONTRACT_VERSION,
    attempt: 1 as const,
  };

  return {
    async execute(
      rawRequest: ExecutionRequest,
      executionOptions: ExecutionOptions = {},
    ): Promise<ExecutionResult> {
      const request = parseExecutionRequest(rawRequest);
      const { executionId, executionRequestHash } = identityFor(request);
      const workflowRequest = workflowRequestSchema.parse({ ...request, executionId });
      const workflowRequestHash = calculateCanonicalJsonHash(workflowRequest);
      let state: ExecutionState = 'CREATED';
      let lastTimestamp = 0;
      const timestamp = (): number => {
        const observed = now();
        if (!Number.isFinite(observed)) {
          throw new ExecutionEngineError('Fonte temporal do Execution Engine inválida.', {
            code: EXECUTION_ENGINE_ERROR_CODES.INTERNAL_ERROR,
            state,
            durationMs: 0,
            executionId,
            workflowId: request.workflowId,
          });
        }
        lastTimestamp = Math.max(lastTimestamp, Math.max(0, Math.round(observed)));
        return lastTimestamp;
      };

      const createdAtMs = timestamp();
      const timeline: ExecutionTimelineEvent[] = [
        {
          sequence: 1,
          event: 'EXECUTION_CREATED',
          state: 'CREATED',
          timestampMs: createdAtMs,
          durationMs: null,
        },
      ];
      let startedAtMs: number | null = null;
      let orchestratorInvocations = 0;

      const finish = (
        status: 'SUCCESS' | 'FAILED' | 'CANCELLED',
        workflowResult: WorkflowResult | null,
        failure: ExecutionFailure | null,
      ): ExecutionResult => {
        const finishedAtMs = timestamp();
        state = transitionExecutionState(state, status);
        timeline.push({
          sequence: timeline.length + 1,
          event:
            status === 'SUCCESS'
              ? 'EXECUTION_COMPLETED'
              : status === 'FAILED'
                ? 'EXECUTION_FAILED'
                : 'EXECUTION_CANCELLED',
          state: status,
          timestampMs: finishedAtMs,
          durationMs: elapsed(createdAtMs, finishedAtMs),
        });
        const result = createExecutionResult({
          executionId,
          workflowId: request.workflowId,
          status,
          startedAt: startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
          finishedAt: new Date(finishedAtMs).toISOString(),
          metadata,
          workflowResult,
          timeline,
          totalDurationMs: elapsed(createdAtMs, finishedAtMs),
          orchestratorInvocations,
          executionRequestHash,
          workflowRequestHash,
          failure,
        });
        const lineage = {
          hash: result.hashes.lineageHash,
          verifiedHandoffs: result.lineage?.handoffs.length ?? 0,
        };
        const context = executionLogContext(executionId, request.workflowId, status, metadata, {
          status,
          durationMs: result.metrics.observed.totalDurationMs,
          hashes: result.hashes,
          metrics: result.metrics,
          lineage,
          ...(failure === null ? {} : { failure }),
        });
        logger[status === 'SUCCESS' ? 'info' : status === 'FAILED' ? 'error' : 'warn'](
          status === 'SUCCESS'
            ? 'execution.completed'
            : status === 'FAILED'
              ? 'execution.failed'
              : 'execution.cancelled',
          context,
        );
        return result;
      };

      logger.info(
        'execution.created',
        executionLogContext(executionId, request.workflowId, state, metadata, {
          hashes: { executionRequestHash, workflowRequestHash },
        }),
      );

      if (executionOptions.signal?.aborted) {
        const failure: ExecutionFailure = {
          kind: 'CANCELLED',
          code: EXECUTION_ENGINE_ERROR_CODES.CANCELLED,
          sourceCode: null,
          message: 'A execução foi cancelada antes de iniciar o workflow.',
        };
        const result = finish('CANCELLED', null, failure);
        throw new ExecutionEngineError('Execução cancelada.', {
          code: EXECUTION_ENGINE_ERROR_CODES.CANCELLED,
          state: 'CANCELLED',
          durationMs: result.metrics.observed.totalDurationMs,
          executionId,
          workflowId: request.workflowId,
          result,
        });
      }

      state = transitionExecutionState(state, 'RUNNING');
      startedAtMs = timestamp();
      timeline.push({
        sequence: timeline.length + 1,
        event: 'EXECUTION_STARTED',
        state,
        timestampMs: startedAtMs,
        durationMs: null,
      });
      logger.info(
        'execution.started',
        executionLogContext(executionId, request.workflowId, state, metadata),
      );

      try {
        orchestratorInvocations = 1;
        const rawWorkflowResult = await options.orchestrator.execute(
          workflowRequest,
          executionOptions.signal === undefined ? {} : { signal: executionOptions.signal },
        );
        const workflowResult = parseWorkflowResult(rawWorkflowResult);
        assertWorkflowCorrelation(workflowResult, workflowRequest, workflowRequestHash);
        const failure = failureForWorkflow(workflowResult);
        if (workflowResult.status === 'SUCCESS') {
          return finish('SUCCESS', workflowResult, null);
        }
        if (workflowResult.status === 'FAILED') {
          return finish('FAILED', workflowResult, failure);
        }
        const result = finish('CANCELLED', workflowResult, failure);
        throw new ExecutionEngineError('Execução cancelada.', {
          code: EXECUTION_ENGINE_ERROR_CODES.CANCELLED,
          state: 'CANCELLED',
          durationMs: result.metrics.observed.totalDurationMs,
          executionId,
          workflowId: request.workflowId,
          sourceCode: workflowResult.failure.code,
          result,
        });
      } catch (error) {
        if (error instanceof ExecutionEngineError) throw error;
        let workflowResult: WorkflowResult | null = null;
        let boundaryError: ExecutionBoundaryError | null = null;
        if (error instanceof OrchestratorError && error.result !== undefined) {
          try {
            workflowResult = parseWorkflowResult(error.result);
            assertWorkflowCorrelation(workflowResult, workflowRequest, workflowRequestHash);
          } catch (caught) {
            boundaryError =
              caught instanceof ExecutionBoundaryError
                ? caught
                : new ExecutionBoundaryError('Resultado parcial do Orchestrator inválido.', {
                    code: EXECUTION_ENGINE_ERROR_CODES.CONTRACT_VIOLATION,
                    cause: caught,
                  });
            workflowResult = null;
          }
        } else if (error instanceof ExecutionBoundaryError) {
          boundaryError = error;
        }

        const cancelled =
          boundaryError === null &&
          (executionOptions.signal?.aborted ||
            (error instanceof OrchestratorError &&
              error.code === ORCHESTRATOR_ERROR_CODES.CANCELLED) ||
            workflowResult?.status === 'CANCELLED');
        const code = cancelled
          ? EXECUTION_ENGINE_ERROR_CODES.CANCELLED
          : (boundaryError?.code ?? EXECUTION_ENGINE_ERROR_CODES.ORCHESTRATOR_FAILED);
        const sourceCode =
          boundaryError?.sourceCode ?? (error instanceof OrchestratorError ? error.code : null);
        const failure: ExecutionFailure = {
          kind: cancelled
            ? 'CANCELLED'
            : boundaryError === null
              ? 'ORCHESTRATOR_ERROR'
              : 'CONTRACT_VIOLATION',
          code,
          sourceCode,
          message: cancelled
            ? 'A execução foi cancelada.'
            : 'A execução foi interrompida por uma falha sanitizada.',
        };
        const result = finish(cancelled ? 'CANCELLED' : 'FAILED', workflowResult, failure);
        throw new ExecutionEngineError(
          cancelled ? 'Execução cancelada.' : 'Falha durante a execução.',
          {
            code,
            state: cancelled ? 'CANCELLED' : 'FAILED',
            durationMs: result.metrics.observed.totalDurationMs,
            executionId,
            workflowId: request.workflowId,
            ...(sourceCode === null ? {} : { sourceCode }),
            result,
            cause: error,
          },
        );
      }
    },
  };
}
