import { executionResultSchema, type ExecutionEngine } from '@brq/execution-engine';
import type { Logger } from '@brq/shared/logger/logger';

import { API_ENDPOINTS, API_ERROR_CODES } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { readExecutionJson, rejectQueryParameters } from './request';
import { executionResponse } from './responses';
import { createRouteHandler } from './route-handler';
import { executionHttpRequestSchema } from './schemas';

interface ExecutionsHandlerOptions {
  readonly getExecutionEngine: () => Promise<ExecutionEngine>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

function invalidRequest(error: { issues: readonly { path: PropertyKey[] }[] }): HttpApiError {
  const firstPath = error.issues[0]?.path.map(String).join('.') || 'body';
  return new HttpApiError('A requisição de execução é inválida.', {
    code: API_ERROR_CODES.INVALID_REQUEST,
    status: 400,
    path: firstPath,
  });
}

async function resolveEngine(factory: () => Promise<ExecutionEngine>): Promise<ExecutionEngine> {
  try {
    return await factory();
  } catch (error) {
    throw new HttpApiError('O serviço de execução não está disponível.', {
      code: API_ERROR_CODES.EXECUTION_ENGINE_UNAVAILABLE,
      status: 503,
      cause: error,
    });
  }
}

export function createExecutionsHandler(options: ExecutionsHandlerOptions) {
  return createRouteHandler<unknown>({
    endpoint: API_ENDPOINTS.EXECUTIONS,
    allowedMethods: ['POST'],
    ...options,
    async operation(request, _context, requestId) {
      rejectQueryParameters(request);
      const body = await readExecutionJson(request);
      const parsed = executionHttpRequestSchema.safeParse(body);
      if (!parsed.success) throw invalidRequest(parsed.error);

      const engine = await resolveEngine(options.getExecutionEngine);
      const result = await engine.execute(
        { ...parsed.data, requestId },
        { signal: request.signal },
      );
      const validResult = executionResultSchema.safeParse(result);
      if (!validResult.success) {
        throw new HttpApiError('O contrato da execução não pôde ser processado.', {
          code: API_ERROR_CODES.EXECUTION_CONTRACT_VIOLATION,
          status: 500,
          cause: validResult.error,
        });
      }
      return {
        response: executionResponse(validResult.data, requestId),
        executionId: validResult.data.executionId,
      };
    },
  });
}
