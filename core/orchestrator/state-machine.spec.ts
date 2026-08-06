import { describe, expect, it } from 'vitest';

import { canTransitionWorkflowState, transitionWorkflowState } from './state-machine';

describe('Orchestrator state machine', () => {
  it.each([
    ['CREATED', 'RUNNING'],
    ['CREATED', 'CANCELLED'],
    ['RUNNING', 'SUCCESS'],
    ['RUNNING', 'FAILED'],
    ['RUNNING', 'CANCELLED'],
  ] as const)('permite a transição %s → %s', (current, next) => {
    expect(canTransitionWorkflowState(current, next)).toBe(true);
    expect(transitionWorkflowState(current, next)).toBe(next);
  });

  it.each(['SUCCESS', 'FAILED', 'CANCELLED'] as const)(
    'mantém %s como estado terminal',
    (status) => {
      expect(canTransitionWorkflowState(status, 'RUNNING')).toBe(false);
      expect(() => transitionWorkflowState(status, 'RUNNING')).toThrow(
        'Invalid workflow state transition',
      );
    },
  );
});
