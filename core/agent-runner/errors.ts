export const AGENT_RUN_ERROR_CODES = {
  INVALID_CONFIGURATION: 'AGENT_RUN_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'AGENT_RUN_INVALID_REQUEST',
  PROMPT_BUILD_FAILED: 'AGENT_RUN_PROMPT_BUILD_FAILED',
  INVALID_PROMPT_RESULT: 'AGENT_RUN_INVALID_PROMPT_RESULT',
  PROVIDER_FAILED: 'AGENT_RUN_PROVIDER_FAILED',
  INVALID_PROVIDER_RESPONSE: 'AGENT_RUN_INVALID_PROVIDER_RESPONSE',
  TIMEOUT: 'AGENT_RUN_TIMEOUT',
  CANCELLED: 'AGENT_RUN_CANCELLED',
  INTERNAL_ERROR: 'AGENT_RUN_INTERNAL_ERROR',
} as const;

export const AGENT_RUN_STAGES = [
  'REQUEST_VALIDATION',
  'PROMPT_BUILD',
  'PROMPT_VALIDATION',
  'PROVIDER_REQUEST_MAPPING',
  'PROVIDER_CALL',
  'PROVIDER_RESPONSE_VALIDATION',
  'FINALIZATION',
] as const;

export type AgentRunErrorCode = (typeof AGENT_RUN_ERROR_CODES)[keyof typeof AGENT_RUN_ERROR_CODES];
export type AgentRunStage = (typeof AGENT_RUN_STAGES)[number];

export interface AgentRunErrorOptions {
  readonly code: AgentRunErrorCode;
  readonly stage: AgentRunStage;
  readonly elapsedMs: number;
  readonly executionId?: string;
  readonly agentExecutionId?: string;
  readonly provider?: string;
  readonly sourceCode?: string;
  readonly providerRetryable?: boolean;
  readonly cause?: unknown;
}

export class AgentRunError extends Error {
  readonly code: AgentRunErrorCode;
  readonly stage: AgentRunStage;
  readonly elapsedMs: number;
  readonly executionId: string | undefined;
  readonly agentExecutionId: string | undefined;
  readonly provider: string | undefined;
  readonly sourceCode: string | undefined;
  readonly providerRetryable: boolean | undefined;

  constructor(message: string, options: AgentRunErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'AgentRunError';
    this.code = options.code;
    this.stage = options.stage;
    this.elapsedMs = options.elapsedMs;
    this.executionId = options.executionId;
    this.agentExecutionId = options.agentExecutionId;
    this.provider = options.provider;
    this.sourceCode = options.sourceCode;
    this.providerRetryable = options.providerRetryable;
  }
}
