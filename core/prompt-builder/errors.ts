export const PROMPT_BUILDER_ERROR_CODES = {
  INVALID_CONFIGURATION: 'PROMPT_BUILDER_INVALID_CONFIGURATION',
  INVALID_INPUT: 'PROMPT_BUILDER_INVALID_INPUT',
  INVALID_TEMPLATE: 'PROMPT_BUILDER_INVALID_TEMPLATE',
  INVALID_SECTION: 'PROMPT_BUILDER_INVALID_SECTION',
  INVALID_SECTION_ORDER: 'PROMPT_BUILDER_INVALID_SECTION_ORDER',
  DUPLICATE_IDENTIFIER: 'PROMPT_BUILDER_DUPLICATE_IDENTIFIER',
  MISSING_SLOT_VALUE: 'PROMPT_BUILDER_MISSING_SLOT_VALUE',
  UNKNOWN_SLOT_VALUE: 'PROMPT_BUILDER_UNKNOWN_SLOT_VALUE',
  SLOT_TYPE_MISMATCH: 'PROMPT_BUILDER_SLOT_TYPE_MISMATCH',
  AGENT_MISMATCH: 'PROMPT_BUILDER_AGENT_MISMATCH',
  INVALID_CONTEXT: 'PROMPT_BUILDER_INVALID_CONTEXT',
  INVALID_OUTPUT_CONTRACT: 'PROMPT_BUILDER_INVALID_OUTPUT_CONTRACT',
  BUDGET_EXCEEDED: 'PROMPT_BUILDER_BUDGET_EXCEEDED',
  RENDER_FAILED: 'PROMPT_BUILDER_RENDER_FAILED',
} as const;

export type PromptBuilderErrorCode =
  (typeof PROMPT_BUILDER_ERROR_CODES)[keyof typeof PROMPT_BUILDER_ERROR_CODES];

export interface PromptBuilderErrorOptions {
  code: PromptBuilderErrorCode;
  promptId?: string;
  sectionId?: string;
  slotName?: string;
  cause?: unknown;
}

export class PromptBuilderError extends Error {
  readonly code: PromptBuilderErrorCode;
  readonly promptId: string | undefined;
  readonly sectionId: string | undefined;
  readonly slotName: string | undefined;

  constructor(message: string, options: PromptBuilderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'PromptBuilderError';
    this.code = options.code;
    this.promptId = options.promptId;
    this.sectionId = options.sectionId;
    this.slotName = options.slotName;
  }
}
