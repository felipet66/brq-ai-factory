import {
  ORCHESTRATOR_ERROR_CODES,
  createOrchestrator,
  workflowRequestSchema,
  workflowResultSchema,
  type WorkflowRequest,
  type WorkflowResult,
} from '@brq/orchestrator';
import { describe, expect, it } from 'vitest';

import { createWorkflowRequestFixture } from './testing/orchestrator-fixtures';

describe('@brq/orchestrator package exports', () => {
  it('expõe somente a fachada, contratos, schemas e erros públicos', () => {
    const request: WorkflowRequest = createWorkflowRequestFixture();
    const resultTypeCheck: WorkflowResult | undefined = undefined;
    expect(createOrchestrator).toBeTypeOf('function');
    expect(workflowRequestSchema.safeParse(request).success).toBe(true);
    expect(workflowResultSchema).toBeDefined();
    expect(resultTypeCheck).toBeUndefined();
    expect(ORCHESTRATOR_ERROR_CODES.CANCELLED).toBe('ORCHESTRATOR_CANCELLED');
  });

  it('não expõe helpers internos de hashing, estado, métricas ou logging', async () => {
    const publicApi: Record<string, unknown> = await import('@brq/orchestrator');
    expect(publicApi).not.toHaveProperty('deepFreeze');
    expect(publicApi).not.toHaveProperty('calculateCanonicalJsonHash');
    expect(publicApi).not.toHaveProperty('transitionWorkflowState');
    expect(publicApi).not.toHaveProperty('createWorkflowMetrics');
    expect(publicApi).not.toHaveProperty('workflowLogContext');
  });
});
