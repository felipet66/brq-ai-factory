export const JOB_QUEUE_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'JOB_QUEUE_INVALID_CONFIGURATION',
  INVALID_INPUT: 'JOB_QUEUE_INVALID_INPUT',
  DUPLICATE_JOB: 'JOB_QUEUE_DUPLICATE_JOB',
  NOT_FOUND: 'JOB_QUEUE_NOT_FOUND',
  INVALID_TRANSITION: 'JOB_QUEUE_INVALID_TRANSITION',
  SHUTDOWN: 'JOB_QUEUE_SHUTDOWN',
} as const);

export type JobQueueErrorCode = (typeof JOB_QUEUE_ERROR_CODES)[keyof typeof JOB_QUEUE_ERROR_CODES];

export class JobQueueError extends Error {
  readonly code: JobQueueErrorCode;

  constructor(
    message: string,
    options: { readonly code: JobQueueErrorCode; readonly cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'JobQueueError';
    this.code = options.code;
  }
}
