export const PREVIEW_RUNNER_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'PREVIEW_INVALID_REQUEST',
  NOT_ALLOWED: 'PREVIEW_NOT_ALLOWED',
  FACTORY_NOT_SUCCESS: 'PREVIEW_FACTORY_NOT_SUCCESS',
  ARTIFACT_UNAVAILABLE: 'PREVIEW_ARTIFACT_UNAVAILABLE',
  ARTIFACT_INTEGRITY_MISMATCH: 'PREVIEW_ARTIFACT_INTEGRITY_MISMATCH',
  PROFILE_UNSUPPORTED: 'PREVIEW_PROFILE_UNSUPPORTED',
  POLICY_MISMATCH: 'PREVIEW_POLICY_MISMATCH',
  CONFIGURATION_INVALID: 'PREVIEW_CONFIGURATION_INVALID',
  CAPACITY_EXCEEDED: 'PREVIEW_CAPACITY_EXCEEDED',
  RUNTIME_UNAVAILABLE: 'PREVIEW_RUNTIME_UNAVAILABLE',
  IMAGE_VERIFICATION_FAILED: 'PREVIEW_IMAGE_VERIFICATION_FAILED',
  START_FAILED: 'PREVIEW_START_FAILED',
  START_TIMEOUT: 'PREVIEW_START_TIMEOUT',
  HEALTHCHECK_FAILED: 'PREVIEW_HEALTHCHECK_FAILED',
  RUNTIME_LOST: 'PREVIEW_RUNTIME_LOST',
  STOP_FAILED: 'PREVIEW_STOP_FAILED',
  CLEANUP_FAILED: 'PREVIEW_CLEANUP_FAILED',
  CANCELLED: 'PREVIEW_CANCELLED',
  CONFLICT: 'PREVIEW_CONFLICT',
  NOT_FOUND: 'PREVIEW_NOT_FOUND',
  INTERNAL_ERROR: 'PREVIEW_INTERNAL_ERROR',
} as const);

export const PREVIEW_RUNNER_ERROR_STAGES = Object.freeze({
  REQUEST_VALIDATION: 'REQUEST_VALIDATION',
  ARTIFACT: 'ARTIFACT',
  CONFIGURATION: 'CONFIGURATION',
  CAPACITY: 'CAPACITY',
  IMAGE: 'IMAGE',
  START: 'START',
  HEALTH: 'HEALTH',
  PROXY: 'PROXY',
  STOP: 'STOP',
  CLEANUP: 'CLEANUP',
  RECONCILIATION: 'RECONCILIATION',
} as const);

export type PreviewRunnerErrorCode =
  (typeof PREVIEW_RUNNER_ERROR_CODES)[keyof typeof PREVIEW_RUNNER_ERROR_CODES];
export type PreviewRunnerErrorStage =
  (typeof PREVIEW_RUNNER_ERROR_STAGES)[keyof typeof PREVIEW_RUNNER_ERROR_STAGES];

export class PreviewRunnerError extends Error {
  readonly code: PreviewRunnerErrorCode;
  readonly stage: PreviewRunnerErrorStage;
  readonly previewId: string | undefined;
  readonly sourceCode: string | undefined;

  constructor(
    message: string,
    options: {
      readonly code: PreviewRunnerErrorCode;
      readonly stage: PreviewRunnerErrorStage;
      readonly previewId?: string;
      readonly sourceCode?: string;
      readonly cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PreviewRunnerError';
    this.code = options.code;
    this.stage = options.stage;
    this.previewId = options.previewId;
    this.sourceCode = options.sourceCode;
  }
}
