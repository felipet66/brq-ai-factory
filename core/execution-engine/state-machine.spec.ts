import { describe, expect, it } from 'vitest';

import { canTransitionExecutionState, transitionExecutionState } from './state-machine';

describe('Execution state machine', () => {
  it('aceita somente o ciclo local aprovado', () => {
    expect(canTransitionExecutionState('CREATED', 'RUNNING')).toBe(true);
    expect(canTransitionExecutionState('CREATED', 'CANCELLED')).toBe(true);
    expect(canTransitionExecutionState('RUNNING', 'SUCCESS')).toBe(true);
    expect(canTransitionExecutionState('RUNNING', 'FAILED')).toBe(true);
    expect(canTransitionExecutionState('RUNNING', 'CANCELLED')).toBe(true);
  });

  it.each(['SUCCESS', 'FAILED', 'CANCELLED'] as const)(
    'mantém %s como estado terminal sem retomada',
    (terminal) => {
      expect(canTransitionExecutionState(terminal, 'RUNNING')).toBe(false);
      expect(() => transitionExecutionState(terminal, 'RUNNING')).toThrow(
        `Invalid execution state transition: ${terminal} -> RUNNING`,
      );
    },
  );
});
