import {
  createOrchestrator,
  workflowRequestSchema,
  workflowResultSchema,
  type WorkflowRequest,
  type WorkflowResult,
} from '@brq/orchestrator';
import { createLogger } from '@brq/shared/logger/logger';

import {
  createOrchestratorAgentResultFixtures,
  createWorkflowRequestFixture,
} from '../../orchestrator/testing/orchestrator-fixtures';
import type { ExecutionRequest } from '../contracts';
import { executionRequestSchema } from '../schemas';

export function createExecutionRequestFixture(
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  const workflow = createWorkflowRequestFixture();
  return executionRequestSchema.parse({
    workflowId: workflow.workflowId,
    requestId: workflow.requestId,
    traceId: workflow.traceId,
    deliveryIntent: workflow.deliveryIntent,
    demand: workflow.demand,
    additionalContext: workflow.additionalContext,
    agents: workflow.agents,
    ...overrides,
  });
}

export async function createSuccessfulWorkflowResultFixture(
  request: WorkflowRequest,
): Promise<WorkflowResult> {
  const fixtures = await createOrchestratorAgentResultFixtures(request);
  return createOrchestrator({
    productOwnerAgent: { execute: async () => fixtures.generated.productOwner },
    developerAgent: { execute: async () => fixtures.generated.developer },
    qaAgent: { execute: async () => fixtures.generated.qa },
    logger: createLogger({ sink: () => undefined }),
    now: incrementalClock(),
  }).execute(request);
}

export async function createDeveloperRejectedWorkflowResultFixture(
  request: WorkflowRequest,
): Promise<WorkflowResult> {
  const fixtures = await createOrchestratorAgentResultFixtures(request);
  return createOrchestrator({
    productOwnerAgent: { execute: async () => fixtures.generated.productOwner },
    developerAgent: { execute: async () => fixtures.rejected.developer },
    qaAgent: { execute: async () => fixtures.generated.qa },
    logger: createLogger({ sink: () => undefined }),
    now: incrementalClock(),
  }).execute(request);
}

export function createTerminalWorkflowResultFixture(
  successful: WorkflowResult,
  status: 'FAILED' | 'CANCELLED',
): WorkflowResult {
  return workflowResultSchema.parse({
    ...structuredClone(successful),
    status,
    failure:
      status === 'CANCELLED'
        ? {
            kind: 'CANCELLED',
            stage: 'FINALIZATION',
            agent: null,
            code: 'ORCHESTRATOR_CANCELLED',
            sourceCode: null,
            message: 'O workflow foi cancelado.',
          }
        : {
            kind: 'VALIDATION_REJECTED',
            stage: 'QA',
            agent: 'QA',
            code: 'ORCHESTRATOR_QA_FAILED',
            sourceCode: 'QA_BUSINESS_VALIDATION_FAILED',
            message: 'O workflow foi interrompido por rejeição funcional de uma etapa.',
          },
  });
}

export function createWorkflowRequestForExecution(
  request: ExecutionRequest,
  executionId: string,
): WorkflowRequest {
  return workflowRequestSchema.parse({ ...request, executionId });
}

export function incrementalClock(start = 0, step = 10): () => number {
  let value = start;
  return () => {
    value += step;
    return value;
  };
}
