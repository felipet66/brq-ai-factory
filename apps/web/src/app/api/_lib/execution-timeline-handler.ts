import type { ExecutionRecordRepository } from '@brq/execution-repository';
import type { Logger } from '@brq/shared/logger/logger';

import { API_ENDPOINTS, API_ERROR_CODES } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { executeRepositoryQuery, resolveExecutionRepository } from './execution-repository';
import { rejectQueryParameters } from './request';
import { executionTimelineResponse } from './responses';
import { createRouteHandler } from './route-handler';
import { executionTimelineIdPathSchema } from './schemas';

export interface ExecutionTimelineContext {
  readonly params: Promise<{ readonly id: string }>;
}

interface ExecutionTimelineHandlerOptions {
  readonly getExecutionRepository: () => Promise<ExecutionRecordRepository>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

export function createExecutionTimelineHandler(options: ExecutionTimelineHandlerOptions) {
  return createRouteHandler<ExecutionTimelineContext>({
    endpoint: API_ENDPOINTS.EXECUTION_TIMELINE,
    allowedMethods: ['GET'],
    ...options,
    async operation(request, context, requestId) {
      rejectQueryParameters(request);
      const { id } = await context.params;
      if (!executionTimelineIdPathSchema.safeParse(id).success) {
        throw new HttpApiError('O identificador da timeline é inválido.', {
          code: API_ERROR_CODES.INVALID_REQUEST,
          status: 400,
          path: 'id',
        });
      }
      const repository = await resolveExecutionRepository(options.getExecutionRepository);
      const record = await executeRepositoryQuery(() =>
        id.startsWith('execution-')
          ? repository.findByExecutionId(id)
          : repository.findByWorkflowId(id),
      );
      if (record?.observation == null) {
        throw new HttpApiError('A timeline da execução não foi encontrada.', {
          code: API_ERROR_CODES.EXECUTION_TIMELINE_NOT_FOUND,
          status: 404,
        });
      }
      return {
        response: executionTimelineResponse(record.observation, requestId),
        executionId: record.observation.executionId,
      };
    },
  });
}
