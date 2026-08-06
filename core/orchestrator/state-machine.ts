import type { WorkflowStatus } from './contracts';

const TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  CREATED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCESS', 'FAILED', 'CANCELLED'],
  SUCCESS: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionWorkflowState(current: WorkflowStatus, next: WorkflowStatus): boolean {
  return TRANSITIONS[current].includes(next);
}

export function transitionWorkflowState(
  current: WorkflowStatus,
  next: WorkflowStatus,
): WorkflowStatus {
  if (!canTransitionWorkflowState(current, next)) {
    throw new Error(`Invalid workflow state transition: ${current} -> ${next}`);
  }
  return next;
}
