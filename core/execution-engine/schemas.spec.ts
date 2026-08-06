import { workflowResultSchema } from '@brq/orchestrator';
import { describe, expect, it } from 'vitest';

import { executionRequestSchema, executionStateSchema } from './schemas';
import { createExecutionRequestFixture } from './testing/execution-engine-fixtures';

describe('Execution Engine schemas', () => {
  it('não aceita executionId fornecido pelo caller e mantém estados restritos', () => {
    const request = createExecutionRequestFixture();
    expect(executionRequestSchema.safeParse(request).success).toBe(true);
    expect(executionRequestSchema.safeParse({ ...request, executionId: 'caller-id' }).success).toBe(
      false,
    );
    expect(executionStateSchema.options).toEqual([
      'CREATED',
      'RUNNING',
      'SUCCESS',
      'FAILED',
      'CANCELLED',
    ]);
    expect(executionStateSchema.safeParse('REQUIRES_REVIEW').success).toBe(false);

    expect(
      executionRequestSchema.safeParse({
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

  it('reutiliza somente o contrato público do Orchestrator para o workflow', () => {
    expect(workflowResultSchema).toBeDefined();
    expect(executionRequestSchema.safeParse({}).success).toBe(false);
  });
});
