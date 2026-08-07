import {
  ExecutionEngineError,
  createExecutionEngine,
  deriveExecutionIdentity,
  executionResultSchema,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';
import { createLogger } from '@brq/shared/logger/logger';

import {
  createExecutionRequestFixture as createBaseExecutionRequestFixture,
  createSuccessfulWorkflowResultFixture,
  createWorkflowRequestForExecution,
  incrementalClock,
} from '../../execution-engine/testing/execution-engine-fixtures';
import { createExecutionResultFixture as createBaseExecutionResultFixture } from '../../execution-repository/testing/execution-record-fixtures';

export const EXECUTION_WORKER_FIXTURE_EPOCH = Date.parse('2026-08-07T12:00:00.000Z');

export function createWorkerExecutionRequestFixture(
  sequence = 1,
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  const suffix = sequence.toString(16).padStart(12, '0');
  return createBaseExecutionRequestFixture({
    workflowId: `workflow-00000000-0000-4000-8000-${suffix}`,
    requestId: `request-00000000-0000-4000-8000-${suffix}`,
    traceId: `trace-00000000-0000-4000-8000-${suffix}`,
    agents: {
      productOwner: {
        agentExecutionId: `product-owner-${suffix}`,
        agentVersion: '1.0.0',
        model: 'fake-model',
      },
      developer: {
        agentExecutionId: `developer-${suffix}`,
        agentVersion: '1.0.0',
        model: 'fake-model',
      },
      qa: {
        agentExecutionId: `qa-${suffix}`,
        agentVersion: '1.0.0',
        model: 'fake-model',
      },
    },
    ...overrides,
  });
}

export async function createSuccessfulExecutionResultFixture(
  request: ExecutionRequest,
): Promise<ExecutionResult> {
  const identity = deriveExecutionIdentity(request);
  const workflowRequest = createWorkflowRequestForExecution(request, identity.executionId);
  const workflowResult = await createSuccessfulWorkflowResultFixture(workflowRequest);
  return createExecutionEngine({
    orchestrator: { execute: async () => workflowResult },
    logger: createLogger({ sink: () => undefined }),
    now: incrementalClock(EXECUTION_WORKER_FIXTURE_EPOCH, 10),
  }).execute(request);
}

export function createFailedExecutionResultFixture(request: ExecutionRequest): ExecutionResult {
  const identity = deriveExecutionIdentity(request);
  return createBaseExecutionResultFixture({
    executionId: identity.executionId,
    workflowId: request.workflowId,
  });
}

export function createCancelledExecutionResultFixture(request: ExecutionRequest): ExecutionResult {
  const failed = createFailedExecutionResultFixture(request);
  return executionResultSchema.parse({
    ...failed,
    status: 'CANCELLED',
    timeline: [
      failed.timeline[0],
      failed.timeline[1],
      {
        sequence: 3,
        event: 'EXECUTION_CANCELLED',
        state: 'CANCELLED',
        timestampMs: 40,
        durationMs: 40,
      },
    ],
    failure: {
      kind: 'CANCELLED',
      code: 'EXECUTION_ENGINE_CANCELLED',
      sourceCode: null,
      message: 'A execução foi cancelada.',
    },
  });
}

export function createCancellationError(result: ExecutionResult): ExecutionEngineError {
  return new ExecutionEngineError('Execução cancelada.', {
    code: 'EXECUTION_ENGINE_CANCELLED',
    state: 'CANCELLED',
    durationMs: result.metrics.observed.totalDurationMs,
    executionId: result.executionId,
    workflowId: result.workflowId,
    result,
  });
}

export function incrementalWorkerClock(start = EXECUTION_WORKER_FIXTURE_EPOCH, step = 10) {
  let value = start;
  return () => {
    value += step;
    return value;
  };
}
