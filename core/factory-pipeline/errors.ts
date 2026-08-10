export const FACTORY_PIPELINE_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'FACTORY_PIPELINE_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'FACTORY_PIPELINE_INVALID_REQUEST',
  EXECUTION_FAILED: 'FACTORY_PIPELINE_EXECUTION_FAILED',
  QA_NOT_READY: 'FACTORY_PIPELINE_QA_NOT_READY',
  INVALID_APPROVAL: 'FACTORY_PIPELINE_INVALID_APPROVAL',
  CODE_GENERATION_REJECTED: 'FACTORY_PIPELINE_CODE_GENERATION_REJECTED',
  CODE_GENERATION_FAILED: 'FACTORY_PIPELINE_CODE_GENERATION_FAILED',
  WORKSPACE_PLAN_FAILED: 'FACTORY_PIPELINE_WORKSPACE_PLAN_FAILED',
  WORKSPACE_MATERIALIZATION_FAILED: 'FACTORY_PIPELINE_WORKSPACE_MATERIALIZATION_FAILED',
  WORKSPACE_RELEASE_FAILED: 'FACTORY_PIPELINE_WORKSPACE_RELEASE_FAILED',
  SANDBOX_FAILED: 'FACTORY_PIPELINE_SANDBOX_FAILED',
  CONTRACT_VIOLATION: 'FACTORY_PIPELINE_CONTRACT_VIOLATION',
  CANCELLED: 'FACTORY_PIPELINE_CANCELLED',
  INTERNAL_ERROR: 'FACTORY_PIPELINE_INTERNAL_ERROR',
} as const);

export type FactoryPipelineErrorCode =
  (typeof FACTORY_PIPELINE_ERROR_CODES)[keyof typeof FACTORY_PIPELINE_ERROR_CODES];

export class FactoryPipelineError extends Error {
  readonly code: FactoryPipelineErrorCode;
  readonly stage: string;
  readonly executionId: string | undefined;
  readonly sourceCode: string | undefined;
  readonly result: FactoryExecutionResult | undefined;

  constructor(
    message: string,
    options: {
      readonly code: FactoryPipelineErrorCode;
      readonly stage: string;
      readonly executionId?: string;
      readonly sourceCode?: string;
      readonly result?: FactoryExecutionResult;
      readonly cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FactoryPipelineError';
    this.code = options.code;
    this.stage = options.stage;
    this.executionId = options.executionId;
    this.sourceCode = options.sourceCode;
    this.result = options.result;
  }
}
import type { FactoryExecutionResult } from './contracts';
