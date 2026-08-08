import { createLogger, type Logger } from '@brq/shared/logger/logger';

import { API_ERROR_CODES } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError, mapTechnicalError } from './errors';
import { createRequestId } from './request';
import { errorResponse } from './responses';

export interface RouteOperationResult {
  readonly response: Response;
  readonly executionId?: string;
  readonly jobId?: string;
}

export interface RouteHandlerBaseOptions {
  readonly endpoint: string;
  readonly allowedMethods: readonly string[];
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

interface RouteHandlerOptions<Context> extends RouteHandlerBaseOptions {
  readonly operation: (
    request: Request,
    context: Context,
    requestId: string,
  ) => Promise<RouteOperationResult> | RouteOperationResult;
}

function duration(startedAt: number, finishedAt: number): number {
  return Math.max(0, finishedAt - startedAt);
}

export function createRouteHandler<Context>(
  options: RouteHandlerOptions<Context>,
): (request: Request, context: Context) => Promise<Response> {
  const logger = options.logger ?? createLogger();
  const now = options.now ?? Date.now;
  const requestIdFactory = options.requestIdFactory ?? createRequestId;

  return async (request, context) => {
    const requestId = requestIdFactory();
    const startedAt = now();
    logger.info('http.request.started', {
      requestId,
      endpoint: options.endpoint,
      method: request.method,
    });

    try {
      if (!options.allowedMethods.includes(request.method)) {
        throw new HttpApiError('Método HTTP não permitido.', {
          code: API_ERROR_CODES.METHOD_NOT_ALLOWED,
          status: 405,
        });
      }

      const outcome = await options.operation(request, context, requestId);
      logger.info('http.request.completed', {
        requestId,
        endpoint: options.endpoint,
        method: request.method,
        statusCode: outcome.response.status,
        durationMs: duration(startedAt, now()),
        ...(outcome.executionId === undefined ? {} : { executionId: outcome.executionId }),
        ...(outcome.jobId === undefined ? {} : { jobId: outcome.jobId }),
      });
      return outcome.response;
    } catch (caught) {
      const error = mapTechnicalError(caught);
      const response = errorResponse({
        requestId,
        status: error.status,
        code: error.code,
        message: error.message,
        ...(error.path === undefined ? {} : { path: error.path }),
        ...(error.executionId === undefined ? {} : { executionId: error.executionId }),
        ...(error.status === 405 ? { allow: options.allowedMethods } : {}),
      });
      logger.error('http.request.failed', {
        requestId,
        endpoint: options.endpoint,
        method: request.method,
        statusCode: response.status,
        durationMs: duration(startedAt, now()),
        ...(error.executionId === undefined ? {} : { executionId: error.executionId }),
        ...(error.jobId === undefined ? {} : { jobId: error.jobId }),
        error: { code: error.code },
      });
      return response;
    }
  };
}
