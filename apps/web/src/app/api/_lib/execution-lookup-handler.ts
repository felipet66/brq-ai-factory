import type { ExecutionRecordRepository } from '@brq/execution-repository';
import type { Logger } from '@brq/shared/logger/logger';

import type { AuthenticatedPrincipal, RequestAuthenticator } from '@/server/auth/contracts';

import { createAuthenticatedRouteHandler } from './authenticated-route-handler';
import { API_ENDPOINTS, API_ERROR_CODES } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { toExecutionHistoryDetail } from './execution-history-projection';
import { executeRepositoryQuery, resolveExecutionRepository } from './execution-repository';
import { rejectQueryParameters } from './request';
import { executionHistoryDetailResponse } from './responses';
import { executionIdPathSchema } from './schemas';

export interface ExecutionLookupContext {
  readonly params: Promise<{ readonly id: string }>;
}

interface ExecutionLookupHandlerOptions {
  readonly authenticate: RequestAuthenticator;
  readonly getExecutionRepository: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ExecutionRecordRepository>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

export function createExecutionLookupHandler(options: ExecutionLookupHandlerOptions) {
  return createAuthenticatedRouteHandler<ExecutionLookupContext>({
    endpoint: API_ENDPOINTS.EXECUTION_BY_ID,
    allowedMethods: ['GET'],
    ...options,
    async operation(request, context, requestId, principal) {
      rejectQueryParameters(request);
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
      const record = await executeRepositoryQuery(() => repository.findByExecutionId(id));
      if (record === null) {
        throw new HttpApiError('A execução não foi encontrada.', {
          code: API_ERROR_CODES.EXECUTION_NOT_FOUND,
          status: 404,
          executionId: id,
        });
      }
      return {
        response: executionHistoryDetailResponse(toExecutionHistoryDetail(record), requestId),
        executionId: id,
      };
    },
  });
}
