import type { ExecutionRecordRepository } from '@brq/execution-repository';

import { API_ERROR_CODES } from './constants';
import { HttpApiError } from './errors';

export async function resolveExecutionRepository(
  factory: () => Promise<ExecutionRecordRepository>,
): Promise<ExecutionRecordRepository> {
  try {
    return await factory();
  } catch (error) {
    throw new HttpApiError('O histórico de execuções não está disponível.', {
      code: API_ERROR_CODES.EXECUTION_REPOSITORY_UNAVAILABLE,
      status: 503,
      cause: error,
    });
  }
}

export async function executeRepositoryQuery<Result>(
  query: () => Promise<Result>,
): Promise<Result> {
  try {
    return await query();
  } catch (error) {
    throw new HttpApiError('O histórico de execuções não está disponível.', {
      code: API_ERROR_CODES.EXECUTION_REPOSITORY_UNAVAILABLE,
      status: 503,
      cause: error,
    });
  }
}
