import { AGENT_RUN_ERROR_CODES } from '@brq/agent-runner';
import { ARTIFACT_GENERATOR_ERROR_CODES } from '@brq/artifact-generator';
import { KNOWLEDGE_ERROR_CODES } from '@brq/knowledge-loader';
import { RESPONSE_VALIDATOR_ERROR_CODES } from '@brq/response-validator';

export const QA_AGENT_ERROR_CODES = {
  INVALID_CONFIGURATION: 'QA_AGENT_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'QA_AGENT_INVALID_REQUEST',
  INCOMPATIBLE_SOURCE_SPECIFICATIONS: 'QA_AGENT_INCOMPATIBLE_SOURCE_SPECIFICATIONS',
  INVALID_PROMPT_ASSETS: 'QA_AGENT_INVALID_PROMPT_ASSETS',
  KNOWLEDGE_LOAD_FAILED: 'QA_AGENT_KNOWLEDGE_LOAD_FAILED',
  CONTEXT_PROJECTION_FAILED: 'QA_AGENT_CONTEXT_PROJECTION_FAILED',
  RUN_FAILED: 'QA_AGENT_RUN_FAILED',
  VALIDATION_FAILED: 'QA_AGENT_VALIDATION_FAILED',
  VALIDATED_OUTPUT_INCOMPATIBLE: 'QA_AGENT_VALIDATED_OUTPUT_INCOMPATIBLE',
  ARTIFACT_GENERATION_FAILED: 'QA_AGENT_ARTIFACT_GENERATION_FAILED',
  TIMEOUT: 'QA_AGENT_TIMEOUT',
  CANCELLED: 'QA_AGENT_CANCELLED',
  INTERNAL_ERROR: 'QA_AGENT_INTERNAL_ERROR',
} as const;

export const QA_AGENT_STAGES = [
  'ASSET_VALIDATION',
  'REQUEST_VALIDATION',
  'SOURCE_VALIDATION',
  'KNOWLEDGE_LOADING',
  'CONTEXT_PROJECTION',
  'RUNNER_EXECUTION',
  'RESPONSE_VALIDATION',
  'BUSINESS_VALIDATION',
  'ARTIFACT_GENERATION',
  'FINALIZATION',
] as const;

export type QAAgentErrorCode = (typeof QA_AGENT_ERROR_CODES)[keyof typeof QA_AGENT_ERROR_CODES];
export type QAAgentStage = (typeof QA_AGENT_STAGES)[number];

const SAFE_SOURCE_CODES = new Set<string>([
  ...Object.values(AGENT_RUN_ERROR_CODES),
  ...Object.values(ARTIFACT_GENERATOR_ERROR_CODES),
  ...Object.values(KNOWLEDGE_ERROR_CODES),
  ...Object.values(RESPONSE_VALIDATOR_ERROR_CODES),
  'AI_PROVIDER_CACHE_MISS',
  'QA_PROMPT_ASSETS_INVALID',
]);

export function sanitizeQASourceCode(code: unknown): string | undefined {
  return typeof code === 'string' && SAFE_SOURCE_CODES.has(code) ? code : undefined;
}

export interface QAAgentErrorOptions {
  readonly code: QAAgentErrorCode;
  readonly stage: QAAgentStage;
  readonly durationMs: number;
  readonly executionId?: string;
  readonly agentExecutionId?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly sourceCode?: string;
  readonly cause?: unknown;
}

export class QAAgentError extends Error {
  readonly code: QAAgentErrorCode;
  readonly stage: QAAgentStage;
  readonly durationMs: number;
  readonly executionId: string | undefined;
  readonly agentExecutionId: string | undefined;
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  readonly sourceCode: string | undefined;

  constructor(message: string, options: QAAgentErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'QAAgentError';
    this.code = options.code;
    this.stage = options.stage;
    this.durationMs = options.durationMs;
    this.executionId = options.executionId;
    this.agentExecutionId = options.agentExecutionId;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.sourceCode = sanitizeQASourceCode(options.sourceCode);
  }
}
