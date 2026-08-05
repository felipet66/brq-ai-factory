import type { AgentExecutionStatus, ExecutionStatus, ProjectStatus } from '../types/domain';

const PROJECT_STATUS_TRANSITIONS = {
  ACTIVE: ['ARCHIVED'],
  ARCHIVED: [],
} as const satisfies Record<ProjectStatus, readonly ProjectStatus[]>;

const EXECUTION_STATUS_TRANSITIONS = {
  CREATED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['REQUIRES_REVIEW', 'SUCCESS', 'FAILED', 'CANCELLED'],
  REQUIRES_REVIEW: ['RUNNING', 'FAILED', 'CANCELLED'],
  SUCCESS: [],
  FAILED: ['RUNNING'],
  CANCELLED: [],
} as const satisfies Record<ExecutionStatus, readonly ExecutionStatus[]>;

const AGENT_EXECUTION_STATUS_TRANSITIONS = {
  CREATED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCESS', 'PARTIAL_SUCCESS', 'REQUIRES_REVIEW', 'FAILED', 'CANCELLED'],
  SUCCESS: [],
  PARTIAL_SUCCESS: [],
  REQUIRES_REVIEW: [],
  FAILED: [],
  CANCELLED: [],
} as const satisfies Record<AgentExecutionStatus, readonly AgentExecutionStatus[]>;

export function canTransitionProjectStatus(from: ProjectStatus, to: ProjectStatus): boolean {
  return (PROJECT_STATUS_TRANSITIONS[from] as readonly ProjectStatus[]).includes(to);
}

/**
 * This guard only describes the canonical state graph. Callers must ensure that
 * FAILED -> RUNNING is an explicit resume and that REQUIRES_REVIEW -> RUNNING
 * follows a human, auditable resolution before applying either transition.
 */
export function canTransitionExecutionStatus(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return (EXECUTION_STATUS_TRANSITIONS[from] as readonly ExecutionStatus[]).includes(to);
}

export function canTransitionAgentExecutionStatus(
  from: AgentExecutionStatus,
  to: AgentExecutionStatus,
): boolean {
  return (AGENT_EXECUTION_STATUS_TRANSITIONS[from] as readonly AgentExecutionStatus[]).includes(to);
}
