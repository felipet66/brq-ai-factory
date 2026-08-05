import { ERROR_CODES, type ErrorCode } from './error-codes';

export interface AppErrorOptions {
  code: ErrorCode;
  statusCode?: number;
  expose?: boolean;
  cause?: unknown;
}

export interface SafeErrorResponse {
  code: ErrorCode;
  message: string;
}

const INTERNAL_ERROR: SafeErrorResponse = {
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'Não foi possível concluir a operação.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(message: string, options: AppErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.expose = options.expose ?? false;
  }
}

export function toSafeErrorResponse(error: unknown): SafeErrorResponse {
  if (error instanceof AppError && error.expose) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return INTERNAL_ERROR;
}
