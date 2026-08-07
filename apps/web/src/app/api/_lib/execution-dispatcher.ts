import type { ExecutionRequest } from '@brq/execution-engine';
import type { ExecutionDispatcher } from '@brq/execution-worker';
import type { JobRecord } from '@brq/job-queue';

import { API_ERROR_CODES } from './constants';
import { HttpApiError } from './errors';

export async function resolveExecutionDispatcher(
  factory: () => Promise<ExecutionDispatcher>,
): Promise<ExecutionDispatcher> {
  try {
    return await factory();
  } catch (error) {
    throw new HttpApiError('O serviço de despacho não está disponível.', {
      code: API_ERROR_CODES.EXECUTION_DISPATCHER_UNAVAILABLE,
      status: 503,
      cause: error,
    });
  }
}

export async function dispatchExecution(
  dispatcher: ExecutionDispatcher,
  request: ExecutionRequest,
): Promise<JobRecord> {
  try {
    return await dispatcher.dispatch(request);
  } catch (error) {
    throw new HttpApiError('A execução não pôde ser enfileirada.', {
      code: API_ERROR_CODES.EXECUTION_DISPATCHER_UNAVAILABLE,
      status: 503,
      cause: error,
    });
  }
}
