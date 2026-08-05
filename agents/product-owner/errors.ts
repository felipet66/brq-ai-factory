export const PRODUCT_OWNER_AGENT_ERROR_CODES = {
  INVALID_CONFIGURATION: 'PRODUCT_OWNER_AGENT_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'PRODUCT_OWNER_AGENT_INVALID_REQUEST',
  INVALID_PROMPT_ASSETS: 'PRODUCT_OWNER_AGENT_INVALID_PROMPT_ASSETS',
  KNOWLEDGE_LOAD_FAILED: 'PRODUCT_OWNER_AGENT_KNOWLEDGE_LOAD_FAILED',
  CONTEXT_PROJECTION_FAILED: 'PRODUCT_OWNER_AGENT_CONTEXT_PROJECTION_FAILED',
  RUN_FAILED: 'PRODUCT_OWNER_AGENT_RUN_FAILED',
  VALIDATION_FAILED: 'PRODUCT_OWNER_AGENT_VALIDATION_FAILED',
  VALIDATED_OUTPUT_INCOMPATIBLE: 'PRODUCT_OWNER_AGENT_VALIDATED_OUTPUT_INCOMPATIBLE',
  ARTIFACT_GENERATION_FAILED: 'PRODUCT_OWNER_AGENT_ARTIFACT_GENERATION_FAILED',
  TIMEOUT: 'PRODUCT_OWNER_AGENT_TIMEOUT',
  CANCELLED: 'PRODUCT_OWNER_AGENT_CANCELLED',
  INTERNAL_ERROR: 'PRODUCT_OWNER_AGENT_INTERNAL_ERROR',
} as const;

export const PRODUCT_OWNER_AGENT_STAGES = [
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

export type ProductOwnerAgentErrorCode =
  (typeof PRODUCT_OWNER_AGENT_ERROR_CODES)[keyof typeof PRODUCT_OWNER_AGENT_ERROR_CODES];
export type ProductOwnerAgentStage = (typeof PRODUCT_OWNER_AGENT_STAGES)[number];

const SAFE_SOURCE_CODES = new Set<string>([
  ...Object.values(AGENT_RUN_ERROR_CODES),
  ...Object.values(ARTIFACT_GENERATOR_ERROR_CODES),
  ...Object.values(KNOWLEDGE_ERROR_CODES),
  ...Object.values(RESPONSE_VALIDATOR_ERROR_CODES),
  'PRODUCT_OWNER_PROMPT_ASSETS_INVALID',
]);

export function sanitizeProductOwnerSourceCode(code: unknown): string | undefined {
  return typeof code === 'string' && SAFE_SOURCE_CODES.has(code) ? code : undefined;
}

export interface ProductOwnerAgentErrorOptions {
  readonly code: ProductOwnerAgentErrorCode;
  readonly stage: ProductOwnerAgentStage;
  readonly durationMs: number;
  readonly executionId?: string;
  readonly agentExecutionId?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly sourceCode?: string;
  readonly cause?: unknown;
}

export class ProductOwnerAgentError extends Error {
  readonly code: ProductOwnerAgentErrorCode;
  readonly stage: ProductOwnerAgentStage;
  readonly durationMs: number;
  readonly executionId: string | undefined;
  readonly agentExecutionId: string | undefined;
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  readonly sourceCode: string | undefined;

  constructor(message: string, options: ProductOwnerAgentErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ProductOwnerAgentError';
    this.code = options.code;
    this.stage = options.stage;
    this.durationMs = options.durationMs;
    this.executionId = options.executionId;
    this.agentExecutionId = options.agentExecutionId;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.sourceCode = sanitizeProductOwnerSourceCode(options.sourceCode);
  }
}
import { AGENT_RUN_ERROR_CODES } from '@brq/agent-runner';
import { ARTIFACT_GENERATOR_ERROR_CODES } from '@brq/artifact-generator';
import { KNOWLEDGE_ERROR_CODES } from '@brq/knowledge-loader';
import { RESPONSE_VALIDATOR_ERROR_CODES } from '@brq/response-validator';
