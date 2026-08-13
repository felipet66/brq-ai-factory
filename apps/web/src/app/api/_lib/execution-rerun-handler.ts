import {
  terminalExecutionRecordStatusSchema,
  type ExecutionRecordRepository,
} from '@brq/execution-repository';
import {
  EXECUTION_WORKER_ERROR_CODES,
  ExecutionWorkerError,
  type ExecutionRerunDispatcher,
} from '@brq/execution-worker';
import type { Logger } from '@brq/shared/logger/logger';

import type { AuthenticatedPrincipal, RequestAuthenticator } from '@/server/auth/contracts';
import { assertSameOriginMutation } from '@/server/auth/csrf';

import { createAuthenticatedRouteHandler } from './authenticated-route-handler';
import { API_ENDPOINTS, API_ERROR_CODES } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { resolveExecutionRepository, executeRepositoryQuery } from './execution-repository';
import { rejectQueryParameters, requireEmptyRequestBody } from './request';
import { executionRerunAcceptedResponse } from './responses';
import { executionIdPathSchema } from './schemas';

export interface ExecutionRerunContext {
  readonly params: Promise<{ readonly id: string }>;
}

interface ExecutionRerunHandlerOptions {
  readonly authenticate: RequestAuthenticator;
  readonly getExecutionRepository: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ExecutionRecordRepository>;
  readonly getExecutionRerunDispatcher: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ExecutionRerunDispatcher>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
  readonly expectedOrigin?: string;
}

function sourceCodeGeneratorSucceeded(record: {
  readonly factoryResult: {
    readonly stages: readonly { readonly stageId: string; readonly status: string }[];
  } | null;
}): boolean {
  return (
    record.factoryResult?.stages.some(
      (stage) => stage.stageId === 'CODE_GENERATOR' && stage.status === 'SUCCESS',
    ) === true
  );
}

function sourceExecutionIsTerminal(record: { readonly status: string }): boolean {
  return terminalExecutionRecordStatusSchema.safeParse(record.status).success;
}

function rerunError(error: unknown, sourceExecutionId: string): HttpApiError {
  if (error instanceof ExecutionWorkerError) {
    if (error.code === EXECUTION_WORKER_ERROR_CODES.SNAPSHOT_NOT_FOUND) {
      return new HttpApiError('O snapshot necessário para o rerun não está disponível.', {
        code: API_ERROR_CODES.EXECUTION_RERUN_SNAPSHOT_NOT_FOUND,
        status: 409,
        executionId: sourceExecutionId,
        cause: error,
      });
    }
    if (error.code === EXECUTION_WORKER_ERROR_CODES.REGENERATE_REQUIRED) {
      return new HttpApiError(
        'O rerun exigiria uma nova geração e foi bloqueado pelo modo cache-only.',
        {
          code: API_ERROR_CODES.EXECUTION_RERUN_REGENERATE_REQUIRED,
          status: 409,
          executionId: sourceExecutionId,
          cause: error,
        },
      );
    }
    if (error.code === EXECUTION_WORKER_ERROR_CODES.SOURCE_NOT_ELIGIBLE) {
      return new HttpApiError('A execução de origem não é elegível para rerun.', {
        code: API_ERROR_CODES.EXECUTION_RERUN_SOURCE_NOT_ELIGIBLE,
        status: 409,
        executionId: sourceExecutionId,
        cause: error,
      });
    }
  }
  return new HttpApiError('O serviço de rerun não está disponível.', {
    code: API_ERROR_CODES.EXECUTION_DISPATCHER_UNAVAILABLE,
    status: 503,
    executionId: sourceExecutionId,
    cause: error,
  });
}

export function createExecutionRerunHandler(options: ExecutionRerunHandlerOptions) {
  return createAuthenticatedRouteHandler<ExecutionRerunContext>({
    endpoint: API_ENDPOINTS.EXECUTION_RERUN,
    allowedMethods: ['POST'],
    ...options,
    async operation(request, context, requestId, principal) {
      assertSameOriginMutation(request, options.expectedOrigin);
      rejectQueryParameters(request);
      await requireEmptyRequestBody(request);

      const { id } = await context.params;
      if (!executionIdPathSchema.safeParse(id).success) {
        throw new HttpApiError('O identificador da execução é inválido.', {
          code: API_ERROR_CODES.INVALID_REQUEST,
          status: 400,
          path: 'id',
        });
      }

      const repository = await resolveExecutionRepository(() =>
        options.getExecutionRepository(principal),
      );
      const source = await executeRepositoryQuery(() => repository.findByExecutionId(id));
      if (source === null) {
        throw new HttpApiError('A execução não foi encontrada.', {
          code: API_ERROR_CODES.EXECUTION_NOT_FOUND,
          status: 404,
          executionId: id,
        });
      }
      if (!sourceExecutionIsTerminal(source) || !sourceCodeGeneratorSucceeded(source)) {
        throw new HttpApiError(
          'A execução de origem deve estar terminal e possuir um Code Generator concluído para rerun.',
          {
            code: API_ERROR_CODES.EXECUTION_RERUN_SOURCE_NOT_ELIGIBLE,
            status: 409,
            executionId: id,
          },
        );
      }

      let dispatcher: ExecutionRerunDispatcher;
      try {
        dispatcher = await options.getExecutionRerunDispatcher(principal);
      } catch (error) {
        throw rerunError(error, id);
      }

      let accepted;
      try {
        accepted = await dispatcher.dispatch({
          ownerId: principal.userId,
          sourceExecutionId: id,
          requestId,
        });
      } catch (error) {
        throw rerunError(error, id);
      }

      return {
        response: executionRerunAcceptedResponse(accepted, requestId),
        executionId: accepted.executionId,
        jobId: accepted.jobId,
      };
    },
  });
}
