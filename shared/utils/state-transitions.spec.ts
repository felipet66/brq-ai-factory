import { describe, expect, it } from 'vitest';

import {
  canTransitionAgentExecutionStatus,
  canTransitionExecutionStatus,
  canTransitionProjectStatus,
} from './state-transitions';

describe('project status transitions', () => {
  it('should only allow archiving an active project', () => {
    expect(canTransitionProjectStatus('ACTIVE', 'ARCHIVED')).toBe(true);
    expect(canTransitionProjectStatus('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(canTransitionProjectStatus('ACTIVE', 'ACTIVE')).toBe(false);
  });
});

describe('execution status transitions', () => {
  it('should allow the canonical execution flow', () => {
    expect(canTransitionExecutionStatus('CREATED', 'RUNNING')).toBe(true);
    expect(canTransitionExecutionStatus('RUNNING', 'REQUIRES_REVIEW')).toBe(true);
    expect(canTransitionExecutionStatus('RUNNING', 'SUCCESS')).toBe(true);
    expect(canTransitionExecutionStatus('RUNNING', 'FAILED')).toBe(true);
    expect(canTransitionExecutionStatus('RUNNING', 'CANCELLED')).toBe(true);
  });

  it('should expose only the documented resume edges', () => {
    expect(canTransitionExecutionStatus('FAILED', 'RUNNING')).toBe(true);
    expect(canTransitionExecutionStatus('REQUIRES_REVIEW', 'RUNNING')).toBe(true);
    expect(canTransitionExecutionStatus('SUCCESS', 'RUNNING')).toBe(false);
    expect(canTransitionExecutionStatus('CANCELLED', 'RUNNING')).toBe(false);
  });
});

describe('agent execution status transitions', () => {
  it('should allow one attempt to move from CREATED to RUNNING and then finish', () => {
    expect(canTransitionAgentExecutionStatus('CREATED', 'RUNNING')).toBe(true);
    expect(canTransitionAgentExecutionStatus('RUNNING', 'SUCCESS')).toBe(true);
    expect(canTransitionAgentExecutionStatus('RUNNING', 'PARTIAL_SUCCESS')).toBe(true);
    expect(canTransitionAgentExecutionStatus('RUNNING', 'REQUIRES_REVIEW')).toBe(true);
    expect(canTransitionAgentExecutionStatus('RUNNING', 'FAILED')).toBe(true);
    expect(canTransitionAgentExecutionStatus('RUNNING', 'CANCELLED')).toBe(true);
  });

  it('should require a new AgentExecution for retry', () => {
    expect(canTransitionAgentExecutionStatus('FAILED', 'RUNNING')).toBe(false);
    expect(canTransitionAgentExecutionStatus('REQUIRES_REVIEW', 'RUNNING')).toBe(false);
  });
});
