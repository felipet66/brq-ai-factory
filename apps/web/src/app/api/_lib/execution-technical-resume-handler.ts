import {
  EXECUTION_WORKER_ERROR_CODES,
  ExecutionWorkerError,
  type TechnicalResumeDispatcher,
} from '@brq/execution-worker';
import type {
  FactoryExecutionRecordRepository,
  FactoryTechnicalCheckpointRepository,
} from '@brq/execution-repository';
import type { Logger } from '@brq/shared/logger/logger';

import type { AuthenticatedPrincipal, RequestAuthenticator } from '@/server/auth/contracts';
import { assertSameOriginMutation } from '@/server/auth/csrf';

import { createAuthenticatedRouteHandler } from './authenticated-route-handler';
import { API_ENDPOINTS, API_ERROR_CODES, type ApiErrorCode } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { rejectQueryParameters, requireEmptyRequestBody } from './request';
import {
  executionTechnicalResumeLatestResponse,
  executionTechnicalResumeResponse,
} from './responses';
import { executionIdPathSchema } from './schemas';

export interface ExecutionTechnicalResumeContext {
  readonly params: Promise<{ readonly id: string }>;
}

interface ExecutionTechnicalResumeHandlerOptions {
  readonly authenticate: RequestAuthenticator;
  readonly getDispatcher: (principal: AuthenticatedPrincipal) => Promise<TechnicalResumeDispatcher>;
  readonly getRepository: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ExecutionTechnicalResumeRepository>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
  readonly expectedOrigin?: string;
}

type ExecutionTechnicalResumeRepository = FactoryTechnicalCheckpointRepository &
  Pick<FactoryExecutionRecordRepository, 'findByExecutionId'>;

type TechnicalResumeCheckpointStatus =
  'AVAILABLE' | 'NOT_FOUND' | 'CLEANUP_PENDING' | 'CLEANUP_FAILED';

function technicalResumeObservedAt(now: (() => number) | undefined): string {
  const value = (now ?? Date.now)();
  if (!Number.isFinite(value) || Math.abs(value) > 8_640_000_000_000_000) {
    throw new HttpApiError('O relógio do serviço de retomada técnica é inválido.', {
      code: API_ERROR_CODES.INTERNAL_ERROR,
      status: 500,
    });
  }
  return new Date(Math.round(value)).toISOString();
}

const DRIFT_CODES: Readonly<Record<string, ApiErrorCode>> = Object.freeze({
  CHECKPOINT_INVALID: API_ERROR_CODES.EXECUTION_TECHNICAL_CHECKPOINT_INVALID,
  CHECKPOINT_PIPELINE_DRIFT: API_ERROR_CODES.EXECUTION_TECHNICAL_PIPELINE_DRIFT,
  CHECKPOINT_PROFILE_DRIFT: API_ERROR_CODES.EXECUTION_TECHNICAL_PROFILE_DRIFT,
  CHECKPOINT_CODE_GENERATOR_DRIFT: API_ERROR_CODES.EXECUTION_TECHNICAL_CODE_GENERATOR_DRIFT,
  CHECKPOINT_WORKSPACE_DRIFT: API_ERROR_CODES.EXECUTION_TECHNICAL_WORKSPACE_DRIFT,
  CHECKPOINT_SANDBOX_DRIFT: API_ERROR_CODES.EXECUTION_TECHNICAL_SANDBOX_DRIFT,
  CHECKPOINT_VALIDATION_DRIFT: API_ERROR_CODES.EXECUTION_TECHNICAL_VALIDATION_DRIFT,
});

async function technicalResumeCheckpointStatus(
  repository: ExecutionTechnicalResumeRepository,
  ownerId: string,
  sourceExecutionId: string,
): Promise<TechnicalResumeCheckpointStatus> {
  const checkpoint = await repository.findTechnicalCheckpointOwned({
    ownerId,
    sourceExecutionId,
  });
  if (checkpoint === null) return 'NOT_FOUND';
  if (checkpoint.cleanup !== null) return 'AVAILABLE';

  const source = await repository.findByExecutionId(sourceExecutionId);
  if (
    source?.factoryResult?.workspaceReleaseStatus === 'FAILED' ||
    source?.factoryResult?.sandboxCleanupFailureCode === 'SANDBOX_CLEANUP_FAILED'
  ) {
    return 'CLEANUP_FAILED';
  }
  return 'CLEANUP_PENDING';
}

function resumeError(
  error: unknown,
  sourceExecutionId: string,
  checkpointStatus?: TechnicalResumeCheckpointStatus,
): HttpApiError {
  if (error instanceof ExecutionWorkerError) {
    if (error.code === EXECUTION_WORKER_ERROR_CODES.TECHNICAL_CHECKPOINT_NOT_FOUND) {
      return new HttpApiError('O checkpoint técnico não está disponível para esta execução.', {
        code: API_ERROR_CODES.EXECUTION_TECHNICAL_CHECKPOINT_NOT_FOUND,
        status: 409,
        executionId: sourceExecutionId,
        cause: error,
      });
    }
    if (error.code === EXECUTION_WORKER_ERROR_CODES.TECHNICAL_CLEANUP_PENDING) {
      if (checkpointStatus === 'CLEANUP_FAILED') {
        return new HttpApiError('O cleanup da execução anterior falhou e bloqueia a retomada.', {
          code: API_ERROR_CODES.EXECUTION_TECHNICAL_CLEANUP_FAILED,
          status: 409,
          executionId: sourceExecutionId,
          cause: error,
        });
      }
      return new HttpApiError('A execução anterior ainda não comprovou o cleanup dos recursos.', {
        code: API_ERROR_CODES.EXECUTION_TECHNICAL_CLEANUP_PENDING,
        status: 409,
        executionId: sourceExecutionId,
        cause: error,
      });
    }
    if (error.code === EXECUTION_WORKER_ERROR_CODES.TECHNICAL_ATTEMPT_CONFLICT) {
      return new HttpApiError('Já existe uma tentativa ativa ou o retry técnico está bloqueado.', {
        code: API_ERROR_CODES.EXECUTION_TECHNICAL_ATTEMPT_CONFLICT,
        status: 409,
        executionId: sourceExecutionId,
        cause: error,
      });
    }
    if (error.code === EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RECOVERY_REQUIRED) {
      return new HttpApiError(
        'A tentativa técnica anterior requer recuperação segura antes de uma nova execução.',
        {
          code: API_ERROR_CODES.EXECUTION_TECHNICAL_RECOVERY_REQUIRED,
          status: 409,
          executionId: sourceExecutionId,
          cause: error,
        },
      );
    }
    if (error.code === EXECUTION_WORKER_ERROR_CODES.TECHNICAL_COMPLETION_PENDING) {
      return new HttpApiError('A execução técnica terminou sem confirmação durável do resultado.', {
        code: API_ERROR_CODES.EXECUTION_TECHNICAL_COMPLETION_PENDING,
        status: 503,
        executionId: sourceExecutionId,
        cause: error,
      });
    }
    if (error.code === EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RESUME_FAILED) {
      if (
        error.reasonCode === 'RUNTIME_PREFLIGHT_FAILED' ||
        error.reasonCode === 'RUNTIME_PREFLIGHT_CLEANUP_UNCONFIRMED'
      ) {
        return new HttpApiError('O runtime físico não passou no preflight da retomada técnica.', {
          code: API_ERROR_CODES.EXECUTION_TECHNICAL_RUNTIME_UNAVAILABLE,
          status: 503,
          executionId: sourceExecutionId,
          cause: error,
        });
      }
      const code =
        (error.reasonCode === undefined ? undefined : DRIFT_CODES[error.reasonCode]) ??
        API_ERROR_CODES.EXECUTION_TECHNICAL_RESUME_FAILED;
      return new HttpApiError('A retomada técnica foi bloqueada por incompatibilidade segura.', {
        code,
        status: 409,
        executionId: sourceExecutionId,
        cause: error,
      });
    }
  }
  return new HttpApiError('O serviço de retomada técnica não está disponível.', {
    code: API_ERROR_CODES.EXECUTION_DISPATCHER_UNAVAILABLE,
    status: 503,
    executionId: sourceExecutionId,
    cause: error,
  });
}

export function createExecutionTechnicalResumeHandler(
  options: ExecutionTechnicalResumeHandlerOptions,
) {
  return createAuthenticatedRouteHandler<ExecutionTechnicalResumeContext>({
    endpoint: API_ENDPOINTS.EXECUTION_TECHNICAL_RESUME,
    allowedMethods: ['GET', 'POST'],
    ...options,
    async operation(request, context, requestId, principal) {
      rejectQueryParameters(request);
      await requireEmptyRequestBody(request);
      const sourceExecutionId = (await context.params).id;
      if (!executionIdPathSchema.safeParse(sourceExecutionId).success) {
        throw new HttpApiError('O identificador da execução é inválido.', {
          code: API_ERROR_CODES.INVALID_REQUEST,
          status: 400,
          path: 'id',
        });
      }
      if (request.method === 'GET') {
        const repository = await options.getRepository(principal);
        const reconciliation = await repository.reconcileTechnicalResumeAttemptOwned({
          ownerId: principal.userId,
          sourceExecutionId,
          observedAt: technicalResumeObservedAt(options.now),
        });
        const checkpointStatus = await technicalResumeCheckpointStatus(
          repository,
          principal.userId,
          sourceExecutionId,
        );
        return {
          response: executionTechnicalResumeLatestResponse(
            sourceExecutionId,
            checkpointStatus,
            reconciliation.attempt,
            requestId,
          ),
          executionId: sourceExecutionId,
        };
      }
      assertSameOriginMutation(request, options.expectedOrigin);
      let dispatcher: TechnicalResumeDispatcher;
      try {
        dispatcher = await options.getDispatcher(principal);
      } catch (error) {
        throw resumeError(error, sourceExecutionId);
      }
      try {
        const result = await dispatcher.dispatch({
          ownerId: principal.userId,
          sourceExecutionId,
          requestId,
          signal: request.signal,
        });
        return {
          response: executionTechnicalResumeResponse(result, requestId),
          executionId: sourceExecutionId,
        };
      } catch (error) {
        let checkpointStatus: TechnicalResumeCheckpointStatus | undefined;
        if (
          error instanceof ExecutionWorkerError &&
          error.code === EXECUTION_WORKER_ERROR_CODES.TECHNICAL_CLEANUP_PENDING
        ) {
          try {
            checkpointStatus = await technicalResumeCheckpointStatus(
              await options.getRepository(principal),
              principal.userId,
              sourceExecutionId,
            );
          } catch {
            // Keep the authoritative worker error and fail closed as pending.
          }
        }
        throw resumeError(error, sourceExecutionId, checkpointStatus);
      }
    },
  });
}
