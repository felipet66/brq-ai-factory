import type { WorkflowResult, WorkflowStage } from './contracts';

export const ORCHESTRATOR_ERROR_CODES = {
  INVALID_CONFIGURATION: 'ORCHESTRATOR_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'ORCHESTRATOR_INVALID_REQUEST',
  PRODUCT_OWNER_FAILED: 'ORCHESTRATOR_PRODUCT_OWNER_FAILED',
  DEVELOPER_FAILED: 'ORCHESTRATOR_DEVELOPER_FAILED',
  QA_FAILED: 'ORCHESTRATOR_QA_FAILED',
  CONTRACT_VIOLATION: 'ORCHESTRATOR_CONTRACT_VIOLATION',
  LINEAGE_MISMATCH: 'ORCHESTRATOR_LINEAGE_MISMATCH',
  CANCELLED: 'ORCHESTRATOR_CANCELLED',
  INTERNAL_ERROR: 'ORCHESTRATOR_INTERNAL_ERROR',
} as const;

export type OrchestratorErrorCode =
  (typeof ORCHESTRATOR_ERROR_CODES)[keyof typeof ORCHESTRATOR_ERROR_CODES];

export interface OrchestratorErrorOptions {
  readonly code: OrchestratorErrorCode;
  readonly stage: WorkflowStage;
  readonly durationMs: number;
  readonly workflowId?: string;
  readonly executionId?: string;
  readonly sourceCode?: string;
  readonly result?: WorkflowResult;
  readonly cause?: unknown;
}

export class OrchestratorError extends Error {
  readonly code: OrchestratorErrorCode;
  readonly stage: WorkflowStage;
  readonly durationMs: number;
  readonly workflowId: string | undefined;
  readonly executionId: string | undefined;
  readonly sourceCode: string | undefined;
  readonly result: WorkflowResult | undefined;

  constructor(message: string, options: OrchestratorErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'OrchestratorError';
    this.code = options.code;
    this.stage = options.stage;
    this.durationMs = options.durationMs;
    this.workflowId = options.workflowId;
    this.executionId = options.executionId;
    this.sourceCode = options.sourceCode;
    this.result = options.result;
  }
}
