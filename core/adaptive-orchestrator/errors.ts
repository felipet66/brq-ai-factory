export const ADAPTIVE_ORCHESTRATOR_ERROR_CODES = {
  INVALID_CONFIGURATION: 'ADAPTIVE_ORCHESTRATOR_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'ADAPTIVE_ORCHESTRATOR_INVALID_REQUEST',
  INVALID_PORT_RESULT: 'ADAPTIVE_ORCHESTRATOR_INVALID_PORT_RESULT',
  PORT_EXECUTION_FAILED: 'ADAPTIVE_ORCHESTRATOR_PORT_EXECUTION_FAILED',
  PLANNER_REQUIRED: 'ADAPTIVE_ORCHESTRATOR_PLANNER_REQUIRED',
  CHECKPOINT_INVALID: 'ADAPTIVE_ORCHESTRATOR_CHECKPOINT_INVALID',
  CHECKPOINT_POLICY_MISMATCH: 'ADAPTIVE_ORCHESTRATOR_CHECKPOINT_POLICY_MISMATCH',
  SAFE_INTEGER_EXCEEDED: 'ADAPTIVE_ORCHESTRATOR_SAFE_INTEGER_EXCEEDED',
  CONTRACT_VIOLATION: 'ADAPTIVE_ORCHESTRATOR_CONTRACT_VIOLATION',
} as const;

export type AdaptiveOrchestratorErrorCode =
  (typeof ADAPTIVE_ORCHESTRATOR_ERROR_CODES)[keyof typeof ADAPTIVE_ORCHESTRATOR_ERROR_CODES];

export type AdaptiveRole = 'PLANNER' | 'BUILDER' | 'VERIFIER' | 'REVIEWER';

export interface AdaptiveOrchestratorErrorOptions {
  readonly code: AdaptiveOrchestratorErrorCode;
  readonly role?: AdaptiveRole;
}

export class AdaptiveOrchestratorError extends Error {
  readonly code: AdaptiveOrchestratorErrorCode;
  readonly role: AdaptiveRole | undefined;

  constructor(message: string, options: AdaptiveOrchestratorErrorOptions) {
    super(message);
    this.name = 'AdaptiveOrchestratorError';
    this.code = options.code;
    this.role = options.role;
  }
}
