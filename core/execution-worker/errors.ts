export const EXECUTION_WORKER_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'EXECUTION_WORKER_INVALID_CONFIGURATION',
  INVALID_CLOCK: 'EXECUTION_WORKER_INVALID_CLOCK',
  DISPATCH_FAILED: 'EXECUTION_WORKER_DISPATCH_FAILED',
  PERSISTENCE_FAILED: 'EXECUTION_WORKER_PERSISTENCE_FAILED',
  EXECUTION_FAILED: 'EXECUTION_WORKER_EXECUTION_FAILED',
  SNAPSHOT_NOT_FOUND: 'EXECUTION_RERUN_SNAPSHOT_NOT_FOUND',
  SOURCE_NOT_ELIGIBLE: 'EXECUTION_RERUN_SOURCE_NOT_ELIGIBLE',
  REGENERATE_REQUIRED: 'EXECUTION_RERUN_REGENERATE_REQUIRED',
  SHUTDOWN: 'EXECUTION_WORKER_SHUTDOWN',
} as const);

export type ExecutionWorkerErrorCode =
  (typeof EXECUTION_WORKER_ERROR_CODES)[keyof typeof EXECUTION_WORKER_ERROR_CODES];

export class ExecutionWorkerError extends Error {
  readonly code: ExecutionWorkerErrorCode;

  constructor(
    message: string,
    options: { readonly code: ExecutionWorkerErrorCode; readonly cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ExecutionWorkerError';
    this.code = options.code;
  }
}
