export const ARTIFACT_GENERATOR_ERROR_CODES = {
  INVALID_CONFIGURATION: 'ARTIFACT_GENERATOR_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'ARTIFACT_GENERATOR_INVALID_REQUEST',
  SOURCE_VALIDATION_REJECTED: 'ARTIFACT_GENERATOR_SOURCE_VALIDATION_REJECTED',
  SOURCE_INTEGRITY_MISMATCH: 'ARTIFACT_GENERATOR_SOURCE_INTEGRITY_MISMATCH',
  SOURCE_CONTRACT_MISMATCH: 'ARTIFACT_GENERATOR_SOURCE_CONTRACT_MISMATCH',
  SPECIFICATION_LIMIT_EXCEEDED: 'ARTIFACT_GENERATOR_SPECIFICATION_LIMIT_EXCEEDED',
  BINDING_NOT_FOUND: 'ARTIFACT_GENERATOR_BINDING_NOT_FOUND',
  BINDING_TYPE_MISMATCH: 'ARTIFACT_GENERATOR_BINDING_TYPE_MISMATCH',
  CONTENT_LIMIT_EXCEEDED: 'ARTIFACT_GENERATOR_CONTENT_LIMIT_EXCEEDED',
  EMPTY_CONTENT: 'ARTIFACT_GENERATOR_EMPTY_CONTENT',
  INVALID_ARTIFACT_DRAFT: 'ARTIFACT_GENERATOR_INVALID_ARTIFACT_DRAFT',
  INTERNAL_ERROR: 'ARTIFACT_GENERATOR_INTERNAL_ERROR',
} as const;

export const ARTIFACT_GENERATION_STAGES = [
  'REQUEST_VALIDATION',
  'SPECIFICATION_VALIDATION',
  'SOURCE_INTEGRITY_VALIDATION',
  'BINDING_RESOLUTION',
  'RENDERING',
  'DRAFT_VALIDATION',
  'BUDGET_VALIDATION',
  'FINALIZATION',
] as const;

export const ARTIFACT_GENERATOR_ERROR_CLASSIFICATIONS = ['TECHNICAL', 'GENERATION'] as const;

export type ArtifactGeneratorErrorCode =
  (typeof ARTIFACT_GENERATOR_ERROR_CODES)[keyof typeof ARTIFACT_GENERATOR_ERROR_CODES];
export type ArtifactGenerationStage = (typeof ARTIFACT_GENERATION_STAGES)[number];
export type ArtifactGeneratorErrorClassification =
  (typeof ARTIFACT_GENERATOR_ERROR_CLASSIFICATIONS)[number];

function classifyError(code: ArtifactGeneratorErrorCode): ArtifactGeneratorErrorClassification {
  return code === ARTIFACT_GENERATOR_ERROR_CODES.INVALID_CONFIGURATION ||
    code === ARTIFACT_GENERATOR_ERROR_CODES.INVALID_REQUEST ||
    code === ARTIFACT_GENERATOR_ERROR_CODES.INTERNAL_ERROR
    ? 'TECHNICAL'
    : 'GENERATION';
}

export interface ArtifactGeneratorErrorOptions {
  readonly code: ArtifactGeneratorErrorCode;
  readonly stage: ArtifactGenerationStage;
  readonly durationMs: number;
  readonly executionId?: string;
  readonly agentExecutionId?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly specificationId?: string;
  readonly templateId?: string;
  readonly cause?: unknown;
}

export class ArtifactGeneratorError extends Error {
  readonly code: ArtifactGeneratorErrorCode;
  readonly stage: ArtifactGenerationStage;
  readonly durationMs: number;
  readonly classification: ArtifactGeneratorErrorClassification;
  readonly executionId: string | undefined;
  readonly agentExecutionId: string | undefined;
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  readonly specificationId: string | undefined;
  readonly templateId: string | undefined;

  constructor(message: string, options: ArtifactGeneratorErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ArtifactGeneratorError';
    this.code = options.code;
    this.stage = options.stage;
    this.durationMs = options.durationMs;
    this.classification = classifyError(options.code);
    this.executionId = options.executionId;
    this.agentExecutionId = options.agentExecutionId;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.specificationId = options.specificationId;
    this.templateId = options.templateId;
  }
}
