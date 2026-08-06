import type { Logger } from '@brq/shared/logger/logger';

import { API_ENDPOINTS, API_ERROR_CODES } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { rejectQueryParameters } from './request';
import { createRouteHandler } from './route-handler';
import { executionIdPathSchema } from './schemas';

export interface ExecutionLookupContext {
  readonly params: Promise<{ readonly id: string }>;
}

interface ExecutionLookupHandlerOptions {
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

export function createExecutionLookupHandler(options: ExecutionLookupHandlerOptions = {}) {
  return createRouteHandler<ExecutionLookupContext>({
    endpoint: API_ENDPOINTS.EXECUTION_BY_ID,
    allowedMethods: ['GET'],
    ...options,
    async operation(request, context) {
      rejectQueryParameters(request);
      const { id } = await context.params;
      if (!executionIdPathSchema.safeParse(id).success) {
        throw new HttpApiError('O identificador da execução é inválido.', {
          code: API_ERROR_CODES.INVALID_REQUEST,
          status: 400,
          path: 'id',
        });
      }
      throw new HttpApiError('A consulta de execução por ID ainda não é suportada no MVP.', {
        code: API_ERROR_CODES.EXECUTION_LOOKUP_NOT_SUPPORTED,
        status: 501,
        executionId: id,
      });
    },
  });
}
