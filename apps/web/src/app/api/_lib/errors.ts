import type { ExecutionEngineError } from '@brq/execution-engine';

import { API_ERROR_CODES, type ApiErrorCode } from './constants';

export interface HttpApiErrorOptions {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly path?: string;
  readonly executionId?: string;
  readonly cause?: unknown;
}

export class HttpApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly path: string | undefined;
  readonly executionId: string | undefined;

  constructor(message: string, options: HttpApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'HttpApiError';
    this.code = options.code;
    this.status = options.status;
    this.path = options.path;
    this.executionId = options.executionId;
  }
}

function isExecutionEngineError(error: unknown): error is ExecutionEngineError {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'ExecutionEngineError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

export function mapTechnicalError(error: unknown): HttpApiError {
  if (error instanceof HttpApiError) return error;

  if (isExecutionEngineError(error)) {
    const executionId = error.executionId;
    if (error.code === 'EXECUTION_ENGINE_CANCELLED') {
      return new HttpApiError('A execução foi cancelada.', {
        code: API_ERROR_CODES.EXECUTION_CANCELLED,
        status: 408,
        ...(executionId === undefined ? {} : { executionId }),
        cause: error,
      });
    }
    if (error.code === 'EXECUTION_ENGINE_INVALID_CONFIGURATION') {
      return new HttpApiError('O serviço de execução não está disponível.', {
        code: API_ERROR_CODES.EXECUTION_ENGINE_UNAVAILABLE,
        status: 503,
        cause: error,
      });
    }
    if (error.code === 'EXECUTION_ENGINE_CONTRACT_VIOLATION') {
      return new HttpApiError('O contrato da execução não pôde ser processado.', {
        code: API_ERROR_CODES.EXECUTION_CONTRACT_VIOLATION,
        status: 500,
        ...(executionId === undefined ? {} : { executionId }),
        cause: error,
      });
    }
    if (error.code === 'EXECUTION_ENGINE_INVALID_REQUEST') {
      return new HttpApiError('A requisição de execução é inválida.', {
        code: API_ERROR_CODES.INVALID_REQUEST,
        status: 400,
        ...(executionId === undefined ? {} : { executionId }),
        cause: error,
      });
    }
    return new HttpApiError('A execução não pôde ser concluída.', {
      code: API_ERROR_CODES.EXECUTION_ENGINE_FAILED,
      status: 500,
      ...(executionId === undefined ? {} : { executionId }),
      cause: error,
    });
  }

  return new HttpApiError('Ocorreu um erro interno.', {
    code: API_ERROR_CODES.INTERNAL_ERROR,
    status: 500,
    cause: error,
  });
}
