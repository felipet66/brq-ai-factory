export const EXECUTION_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'EXECUTION_REPOSITORY_INVALID_CONFIGURATION',
  INVALID_INPUT: 'EXECUTION_REPOSITORY_INVALID_INPUT',
  NOT_FOUND: 'EXECUTION_REPOSITORY_NOT_FOUND',
  CONFLICT: 'EXECUTION_REPOSITORY_CONFLICT',
  PERSISTENCE_FAILED: 'EXECUTION_REPOSITORY_PERSISTENCE_FAILED',
} as const);

export type ExecutionRepositoryErrorCode =
  (typeof EXECUTION_REPOSITORY_ERROR_CODES)[keyof typeof EXECUTION_REPOSITORY_ERROR_CODES];

export class ExecutionRepositoryError extends Error {
  readonly code: ExecutionRepositoryErrorCode;

  constructor(
    message: string,
    options: { readonly code: ExecutionRepositoryErrorCode; readonly cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ExecutionRepositoryError';
    this.code = options.code;
  }
}
