export const RESPONSE_VALIDATOR_ERROR_CODES = {
  INVALID_CONFIGURATION: 'RESPONSE_VALIDATOR_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'RESPONSE_VALIDATOR_INVALID_REQUEST',
  INVALID_CONTRACT: 'RESPONSE_VALIDATOR_INVALID_CONTRACT',
  INTERNAL_ERROR: 'RESPONSE_VALIDATOR_INTERNAL_ERROR',
} as const;

export const RESPONSE_VALIDATION_STAGES = [
  'REQUEST',
  'CONTRACT',
  'CONTENT',
  'SCHEMA',
  'STRUCTURED_OUTPUT',
  'RESULT',
] as const;

export type ResponseValidatorErrorCode =
  (typeof RESPONSE_VALIDATOR_ERROR_CODES)[keyof typeof RESPONSE_VALIDATOR_ERROR_CODES];
export type ResponseValidationStage = (typeof RESPONSE_VALIDATION_STAGES)[number];

export interface ResponseValidatorErrorOptions {
  readonly code: ResponseValidatorErrorCode;
  readonly stage: ResponseValidationStage;
  readonly durationMs: number;
  readonly executionId?: string;
  readonly agentExecutionId?: string;
  readonly cause?: unknown;
}

export class ResponseValidatorError extends Error {
  readonly code: ResponseValidatorErrorCode;
  readonly stage: ResponseValidationStage;
  readonly durationMs: number;
  readonly executionId: string | undefined;
  readonly agentExecutionId: string | undefined;

  constructor(message: string, options: ResponseValidatorErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ResponseValidatorError';
    this.code = options.code;
    this.stage = options.stage;
    this.durationMs = options.durationMs;
    this.executionId = options.executionId;
    this.agentExecutionId = options.agentExecutionId;
  }
}
