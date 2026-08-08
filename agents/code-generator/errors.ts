import { AGENT_RUN_ERROR_CODES } from '@brq/agent-runner';
import { KNOWLEDGE_ERROR_CODES } from '@brq/knowledge-loader';
import { RESPONSE_VALIDATOR_ERROR_CODES } from '@brq/response-validator';

export const CODE_GENERATOR_AGENT_ERROR_CODES = {
  INVALID_CONFIGURATION: 'CODE_GENERATOR_AGENT_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'CODE_GENERATOR_AGENT_INVALID_REQUEST',
  SOURCE_NOT_APPROVED: 'CODE_GENERATOR_AGENT_SOURCE_NOT_APPROVED',
  INVALID_PROMPT_ASSETS: 'CODE_GENERATOR_AGENT_INVALID_PROMPT_ASSETS',
  KNOWLEDGE_LOAD_FAILED: 'CODE_GENERATOR_AGENT_KNOWLEDGE_LOAD_FAILED',
  CONTEXT_PROJECTION_FAILED: 'CODE_GENERATOR_AGENT_CONTEXT_PROJECTION_FAILED',
  RUN_FAILED: 'CODE_GENERATOR_AGENT_RUN_FAILED',
  VALIDATION_FAILED: 'CODE_GENERATOR_AGENT_VALIDATION_FAILED',
  VALIDATED_OUTPUT_INCOMPATIBLE: 'CODE_GENERATOR_AGENT_VALIDATED_OUTPUT_INCOMPATIBLE',
  BUNDLE_ASSEMBLY_FAILED: 'CODE_GENERATOR_AGENT_BUNDLE_ASSEMBLY_FAILED',
  TIMEOUT: 'CODE_GENERATOR_AGENT_TIMEOUT',
  CANCELLED: 'CODE_GENERATOR_AGENT_CANCELLED',
  INTERNAL_ERROR: 'CODE_GENERATOR_AGENT_INTERNAL_ERROR',
} as const;

export const CODE_GENERATOR_AGENT_STAGES = [
  'ASSET_VALIDATION',
  'REQUEST_VALIDATION',
  'SOURCE_VALIDATION',
  'KNOWLEDGE_LOADING',
  'CONTEXT_PROJECTION',
  'RUNNER_EXECUTION',
  'RESPONSE_VALIDATION',
  'BUSINESS_VALIDATION',
  'BUNDLE_ASSEMBLY',
  'FINALIZATION',
] as const;

export type CodeGeneratorAgentErrorCode =
  (typeof CODE_GENERATOR_AGENT_ERROR_CODES)[keyof typeof CODE_GENERATOR_AGENT_ERROR_CODES];
export type CodeGeneratorAgentStage = (typeof CODE_GENERATOR_AGENT_STAGES)[number];

const SAFE_SOURCE_CODES = new Set<string>([
  ...Object.values(AGENT_RUN_ERROR_CODES),
  ...Object.values(KNOWLEDGE_ERROR_CODES),
  ...Object.values(RESPONSE_VALIDATOR_ERROR_CODES),
  'CODE_GENERATOR_PROMPT_ASSETS_INVALID',
]);

export function sanitizeCodeGeneratorSourceCode(code: unknown): string | undefined {
  return typeof code === 'string' && SAFE_SOURCE_CODES.has(code) ? code : undefined;
}

export interface CodeGeneratorAgentErrorOptions {
  readonly code: CodeGeneratorAgentErrorCode;
  readonly stage: CodeGeneratorAgentStage;
  readonly durationMs: number;
  readonly executionId?: string;
  readonly agentExecutionId?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly sourceCode?: string;
  readonly cause?: unknown;
}

export class CodeGeneratorAgentError extends Error {
  readonly code: CodeGeneratorAgentErrorCode;
  readonly stage: CodeGeneratorAgentStage;
  readonly durationMs: number;
  readonly executionId: string | undefined;
  readonly agentExecutionId: string | undefined;
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  readonly sourceCode: string | undefined;

  constructor(message: string, options: CodeGeneratorAgentErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'CodeGeneratorAgentError';
    this.code = options.code;
    this.stage = options.stage;
    this.durationMs = options.durationMs;
    this.executionId = options.executionId;
    this.agentExecutionId = options.agentExecutionId;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.sourceCode = sanitizeCodeGeneratorSourceCode(options.sourceCode);
  }
}
