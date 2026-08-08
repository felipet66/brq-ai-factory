import type { PromptInspectionStage } from './contracts';

export const PROMPT_INSPECTOR_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'PROMPT_INSPECTOR_INVALID_CONFIGURATION',
  INVALID_INPUT: 'PROMPT_INSPECTOR_INVALID_INPUT',
  UNKNOWN_AGENT: 'PROMPT_INSPECTOR_UNKNOWN_AGENT',
  CANCELLED: 'PROMPT_INSPECTOR_CANCELLED',
  INSPECTION_FAILED: 'PROMPT_INSPECTOR_INSPECTION_FAILED',
} as const);

export type PromptInspectorErrorCode =
  (typeof PROMPT_INSPECTOR_ERROR_CODES)[keyof typeof PROMPT_INSPECTOR_ERROR_CODES];

export class PromptInspectorError extends Error {
  readonly code: PromptInspectorErrorCode;
  readonly stage: PromptInspectionStage | undefined;

  constructor(
    message: string,
    options: {
      readonly code: PromptInspectorErrorCode;
      readonly stage?: PromptInspectionStage;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'PromptInspectorError';
    this.code = options.code;
    this.stage = options.stage;
  }
}
