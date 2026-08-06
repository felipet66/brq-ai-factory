import { describe, expect, it } from 'vitest';

import { createWorkflowRequestFixture } from './testing/orchestrator-fixtures';
import { workflowRequestSchema, workflowTimelineEventSchema } from './schemas';

describe('Orchestrator schemas', () => {
  it('aceita um WorkflowRequest estrito com três execuções distintas', () => {
    expect(workflowRequestSchema.safeParse(createWorkflowRequestFixture()).success).toBe(true);
  });

  it('rejeita propriedades desconhecidas e agentExecutionIds repetidos', () => {
    const request = createWorkflowRequestFixture();
    expect(workflowRequestSchema.safeParse({ ...request, retry: 3 }).success).toBe(false);
    expect(
      workflowRequestSchema.safeParse({
        ...request,
        agents: {
          ...request.agents,
          qa: {
            ...request.agents.qa,
            agentExecutionId: request.agents.productOwner.agentExecutionId,
          },
        },
      }).success,
    ).toBe(false);
  });

  it('mantém timestamps da timeline como observações explícitas', () => {
    expect(
      workflowTimelineEventSchema.safeParse({
        sequence: 1,
        event: 'WORKFLOW_STARTED',
        stage: 'INITIALIZATION',
        agent: null,
        timestampMs: 10,
        durationMs: null,
      }).success,
    ).toBe(true);
  });
});
