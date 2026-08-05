export interface AppErrorOptions {
  code: string;
  statusCode?: number;
  expose?: boolean;
  cause?: unknown;
}

export interface SafeErrorResponse {
  code: string;
  message: string;
}

const INTERNAL_ERROR: SafeErrorResponse = {
  code: 'INTERNAL_ERROR',
  message: 'Não foi possível concluir a operação.',
};

export class AppError extends Error {
  readonly code: string;
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
