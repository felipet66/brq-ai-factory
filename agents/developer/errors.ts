import { AGENT_RUN_ERROR_CODES } from '@brq/agent-runner';
import { ARTIFACT_GENERATOR_ERROR_CODES } from '@brq/artifact-generator';
import { KNOWLEDGE_ERROR_CODES } from '@brq/knowledge-loader';
import { RESPONSE_VALIDATOR_ERROR_CODES } from '@brq/response-validator';

export const DEVELOPER_AGENT_ERROR_CODES = {
  INVALID_CONFIGURATION: 'DEVELOPER_AGENT_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'DEVELOPER_AGENT_INVALID_REQUEST',
  INVALID_PROMPT_ASSETS: 'DEVELOPER_AGENT_INVALID_PROMPT_ASSETS',
  KNOWLEDGE_LOAD_FAILED: 'DEVELOPER_AGENT_KNOWLEDGE_LOAD_FAILED',
  CONTEXT_PROJECTION_FAILED: 'DEVELOPER_AGENT_CONTEXT_PROJECTION_FAILED',
  RUN_FAILED: 'DEVELOPER_AGENT_RUN_FAILED',
  VALIDATION_FAILED: 'DEVELOPER_AGENT_VALIDATION_FAILED',
  VALIDATED_OUTPUT_INCOMPATIBLE: 'DEVELOPER_AGENT_VALIDATED_OUTPUT_INCOMPATIBLE',
  ARTIFACT_GENERATION_FAILED: 'DEVELOPER_AGENT_ARTIFACT_GENERATION_FAILED',
  TIMEOUT: 'DEVELOPER_AGENT_TIMEOUT',
  CANCELLED: 'DEVELOPER_AGENT_CANCELLED',
  INTERNAL_ERROR: 'DEVELOPER_AGENT_INTERNAL_ERROR',
} as const;

export const DEVELOPER_AGENT_STAGES = [
  'ASSET_VALIDATION',
  'REQUEST_VALIDATION',
  'KNOWLEDGE_LOADING',
  'CONTEXT_PROJECTION',
  'RUNNER_EXECUTION',
  'RESPONSE_VALIDATION',
  'BUSINESS_VALIDATION',
  'ARTIFACT_GENERATION',
  'FINALIZATION',
] as const;

export type DeveloperAgentErrorCode =
  (typeof DEVELOPER_AGENT_ERROR_CODES)[keyof typeof DEVELOPER_AGENT_ERROR_CODES];
export type DeveloperAgentStage = (typeof DEVELOPER_AGENT_STAGES)[number];

const SAFE_SOURCE_CODES = new Set<string>([
  ...Object.values(AGENT_RUN_ERROR_CODES),
  ...Object.values(ARTIFACT_GENERATOR_ERROR_CODES),
  ...Object.values(KNOWLEDGE_ERROR_CODES),
  ...Object.values(RESPONSE_VALIDATOR_ERROR_CODES),
  'AI_PROVIDER_CACHE_MISS',
  'DEVELOPER_PROMPT_ASSETS_INVALID',
]);

export function sanitizeDeveloperSourceCode(code: unknown): string | undefined {
  return typeof code === 'string' && SAFE_SOURCE_CODES.has(code) ? code : undefined;
}

export interface DeveloperAgentErrorOptions {
  readonly code: DeveloperAgentErrorCode;
  readonly stage: DeveloperAgentStage;
  readonly durationMs: number;
  readonly executionId?: string;
  readonly agentExecutionId?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly sourceCode?: string;
  readonly cause?: unknown;
}

export class DeveloperAgentError extends Error {
  readonly code: DeveloperAgentErrorCode;
  readonly stage: DeveloperAgentStage;
  readonly durationMs: number;
  readonly executionId: string | undefined;
  readonly agentExecutionId: string | undefined;
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  readonly sourceCode: string | undefined;

  constructor(message: string, options: DeveloperAgentErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'DeveloperAgentError';
    this.code = options.code;
    this.stage = options.stage;
    this.durationMs = options.durationMs;
    this.executionId = options.executionId;
    this.agentExecutionId = options.agentExecutionId;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.sourceCode = sanitizeDeveloperSourceCode(options.sourceCode);
  }
}
