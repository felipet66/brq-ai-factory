export const SANDBOX_RUNNER_ERROR_CODES = Object.freeze({
  CONFIGURATION_ERROR: 'SANDBOX_CONFIGURATION_ERROR',
  CAPACITY_EXCEEDED: 'SANDBOX_CAPACITY_EXCEEDED',
  RUNTIME_UNAVAILABLE: 'SANDBOX_RUNTIME_UNAVAILABLE',
  IMAGE_ERROR: 'SANDBOX_IMAGE_ERROR',
  INTEGRITY_MISMATCH: 'SANDBOX_INTEGRITY_MISMATCH',
  START_FAILED: 'SANDBOX_START_FAILED',
  STEP_FAILED: 'SANDBOX_STEP_FAILED',
  RESOURCE_LIMIT: 'SANDBOX_RESOURCE_LIMIT',
  OUTPUT_LIMIT: 'SANDBOX_OUTPUT_LIMIT',
  TIMEOUT: 'SANDBOX_TIMEOUT',
  CANCELLED: 'SANDBOX_CANCELLED',
  CLEANUP_FAILED: 'SANDBOX_CLEANUP_FAILED',
} as const);

export type SandboxRunnerErrorCode =
  (typeof SANDBOX_RUNNER_ERROR_CODES)[keyof typeof SANDBOX_RUNNER_ERROR_CODES];

export const SANDBOX_RUNNER_ERROR_STAGES = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  REQUEST_VALIDATION: 'REQUEST_VALIDATION',
  CAPACITY: 'CAPACITY',
  INTEGRITY: 'INTEGRITY',
  IMAGE: 'IMAGE',
  START: 'START',
  PREPARE: 'PREPARE',
  TYPECHECK: 'TYPECHECK',
  BUILD: 'BUILD',
  TEST: 'TEST',
  CLEANUP: 'CLEANUP',
} as const);

export type SandboxRunnerErrorStage =
  (typeof SANDBOX_RUNNER_ERROR_STAGES)[keyof typeof SANDBOX_RUNNER_ERROR_STAGES];

export class SandboxRunnerError extends Error {
  readonly code: SandboxRunnerErrorCode;
  readonly stage: SandboxRunnerErrorStage;
  readonly sandboxRunId: string | undefined;
  readonly sourceCode: string | undefined;

  constructor(
    message: string,
    options: {
      readonly code: SandboxRunnerErrorCode;
      readonly stage: SandboxRunnerErrorStage;
      readonly sandboxRunId?: string;
      readonly sourceCode?: string;
      readonly cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SandboxRunnerError';
    this.code = options.code;
    this.stage = options.stage;
    this.sandboxRunId = options.sandboxRunId;
    this.sourceCode = options.sourceCode;
  }
}
