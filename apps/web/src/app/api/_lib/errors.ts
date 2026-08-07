import { API_ERROR_CODES, type ApiErrorCode } from './constants';

export interface HttpApiErrorOptions {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly path?: string;
  readonly executionId?: string;
  readonly jobId?: string;
  readonly cause?: unknown;
}

export class HttpApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly path: string | undefined;
  readonly executionId: string | undefined;
  readonly jobId: string | undefined;

  constructor(message: string, options: HttpApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'HttpApiError';
    this.code = options.code;
    this.status = options.status;
    this.path = options.path;
    this.executionId = options.executionId;
    this.jobId = options.jobId;
  }
}

export function mapTechnicalError(error: unknown): HttpApiError {
  if (error instanceof HttpApiError) return error;

  return new HttpApiError('Ocorreu um erro interno.', {
    code: API_ERROR_CODES.INTERNAL_ERROR,
    status: 500,
    cause: error,
  });
}
