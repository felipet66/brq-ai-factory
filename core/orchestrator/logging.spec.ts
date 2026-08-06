import { describe, expect, it } from 'vitest';

import { workflowLogContext } from './logging';

describe('Orchestrator logging', () => {
  it('constrói somente o contexto explicitamente permitido', () => {
    const context = workflowLogContext('workflow-001', 'execution-001', 'QA', {
      agent: 'QA',
      durationMs: 12,
      failure: {
        kind: 'AGENT_ERROR',
        stage: 'QA',
        agent: 'QA',
        code: 'ORCHESTRATOR_QA_FAILED',
        sourceCode: 'QA_AGENT_RUN_FAILED',
        message: 'não deve ser logada',
      },
    });
    expect(context).toEqual({
      workflowId: 'workflow-001',
      executionId: 'execution-001',
      stage: 'QA',
      agent: 'QA',
      durationMs: 12,
      error: { code: 'ORCHESTRATOR_QA_FAILED', sourceCode: 'QA_AGENT_RUN_FAILED' },
    });
    expect(JSON.stringify(context)).not.toContain('não deve ser logada');
  });
});
