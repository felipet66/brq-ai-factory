import type { ExecutionRecordRepository } from '@brq/execution-repository';
import type { ExecutionDispatcher } from '@brq/execution-worker';
import { jobRecordSchema } from '@brq/job-queue';
import {
  CHANGE_DELIVERY_INTENT,
  GREENFIELD_DELIVERY_INTENT,
} from '@brq/shared/constants/delivery-intent';
import type { Logger } from '@brq/shared/logger/logger';

import type { AuthenticatedPrincipal, RequestAuthenticator } from '@/server/auth/contracts';
import { assertSameOriginMutation } from '@/server/auth/csrf';

import { createAuthenticatedRouteHandler } from './authenticated-route-handler';
import { API_ENDPOINTS, API_ERROR_CODES } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { dispatchExecution, resolveExecutionDispatcher } from './execution-dispatcher';
import { toExecutionHistoryItem } from './execution-history-projection';
import { executeRepositoryQuery, resolveExecutionRepository } from './execution-repository';
import {
  readExecutionJson,
  readExecutionListQuery,
  rejectQueryParameters,
  rejectRequestBody,
} from './request';
import { executionAcceptedResponse, executionHistoryPageResponse } from './responses';
import { executionHttpRequestSchema } from './schemas';

interface ExecutionsHandlerOptions {
  readonly authenticate: RequestAuthenticator;
  readonly getExecutionDispatcher: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ExecutionDispatcher>;
  readonly getExecutionRepository: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ExecutionRecordRepository>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
  readonly expectedOrigin?: string;
}

function invalidRequest(error: { issues: readonly { path: PropertyKey[] }[] }): HttpApiError {
  const firstPath = error.issues[0]?.path.map(String).join('.') || 'body';
  return new HttpApiError('A requisição de execução é inválida.', {
    code: API_ERROR_CODES.INVALID_REQUEST,
    status: 400,
    path: firstPath,
  });
}

export function createExecutionsHandler(options: ExecutionsHandlerOptions) {
  return createAuthenticatedRouteHandler<unknown>({
    endpoint: API_ENDPOINTS.EXECUTIONS,
    allowedMethods: ['GET', 'POST'],
    ...options,
    async operation(request, _context, requestId, principal) {
      if (request.method === 'GET') {
        rejectRequestBody(request);
        const query = readExecutionListQuery(request);
        const repository = await resolveExecutionRepository(() =>
          options.getExecutionRepository(principal),
        );
        const page = await executeRepositoryQuery(() => repository.list(query));
        return {
          response: executionHistoryPageResponse(
            {
              items: page.items.map(toExecutionHistoryItem),
              nextCursor: page.nextCursor,
            },
            requestId,
          ),
        };
      }

      assertSameOriginMutation(request, options.expectedOrigin);
      rejectQueryParameters(request);
      const body = await readExecutionJson(request);
      const parsed = executionHttpRequestSchema.safeParse(body);
      if (!parsed.success) throw invalidRequest(parsed.error);

      const { deliveryMode, ...executionRequest } = parsed.data;
      const deliveryIntent =
        deliveryMode === 'GREENFIELD' ? GREENFIELD_DELIVERY_INTENT : CHANGE_DELIVERY_INTENT;

      const dispatcher = await resolveExecutionDispatcher(() =>
        options.getExecutionDispatcher(principal),
      );
      const job = await dispatchExecution(dispatcher, {
        ...executionRequest,
        requestId,
        deliveryIntent,
      });
      const validJob = jobRecordSchema.safeParse(job);
      if (!validJob.success || validJob.data.status !== 'QUEUED') {
        throw new HttpApiError('O contrato de despacho não pôde ser processado.', {
          code: API_ERROR_CODES.EXECUTION_DISPATCH_CONTRACT_VIOLATION,
          status: 500,
          ...(validJob.success ? {} : { cause: validJob.error }),
        });
      }
      return {
        response: executionAcceptedResponse(validJob.data, requestId),
        executionId: validJob.data.executionId,
        jobId: validJob.data.jobId,
      };
    },
  });
}
