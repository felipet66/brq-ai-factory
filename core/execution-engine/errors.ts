import type { ExecutionResult, ExecutionState } from './contracts';

export const EXECUTION_ENGINE_ERROR_CODES = {
  INVALID_CONFIGURATION: 'EXECUTION_ENGINE_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'EXECUTION_ENGINE_INVALID_REQUEST',
  ORCHESTRATOR_FAILED: 'EXECUTION_ENGINE_ORCHESTRATOR_FAILED',
  CONTRACT_VIOLATION: 'EXECUTION_ENGINE_CONTRACT_VIOLATION',
  CANCELLED: 'EXECUTION_ENGINE_CANCELLED',
  INTERNAL_ERROR: 'EXECUTION_ENGINE_INTERNAL_ERROR',
} as const;

export type ExecutionEngineErrorCode =
  (typeof EXECUTION_ENGINE_ERROR_CODES)[keyof typeof EXECUTION_ENGINE_ERROR_CODES];

export interface ExecutionEngineErrorOptions {
  readonly code: ExecutionEngineErrorCode;
  readonly state: ExecutionState;
  readonly durationMs: number;
  readonly executionId?: string;
  readonly workflowId?: string;
  readonly sourceCode?: string;
  readonly result?: ExecutionResult;
  readonly cause?: unknown;
}

export class ExecutionEngineError extends Error {
  readonly code: ExecutionEngineErrorCode;
  readonly state: ExecutionState;
  readonly durationMs: number;
  readonly executionId: string | undefined;
  readonly workflowId: string | undefined;
  readonly sourceCode: string | undefined;
  readonly result: ExecutionResult | undefined;

  constructor(message: string, options: ExecutionEngineErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ExecutionEngineError';
    this.code = options.code;
    this.state = options.state;
    this.durationMs = options.durationMs;
    this.executionId = options.executionId;
    this.workflowId = options.workflowId;
    this.sourceCode = options.sourceCode;
    this.result = options.result;
  }
}
