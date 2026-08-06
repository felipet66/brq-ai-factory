import type { ExecutionState } from './contracts';

const TRANSITIONS: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = {
  CREATED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCESS', 'FAILED', 'CANCELLED'],
  SUCCESS: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionExecutionState(
  current: ExecutionState,
  next: ExecutionState,
): boolean {
  return TRANSITIONS[current].includes(next);
}

export function transitionExecutionState(
  current: ExecutionState,
  next: ExecutionState,
): ExecutionState {
  if (!canTransitionExecutionState(current, next)) {
    throw new Error(`Invalid execution state transition: ${current} -> ${next}`);
  }
  return next;
}
