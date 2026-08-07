import {
  createExecutionEngine,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';

import { EXECUTION_CONTRACT_VERSION } from '../../execution-engine/execution-engine';
import {
  calculateCanonicalJsonHash,
  createDeterministicExecutionId,
} from '../../execution-engine/hashing';
import {
  createExecutionRequestFixture,
  createSuccessfulWorkflowResultFixture,
  createWorkflowRequestForExecution,
  incrementalClock,
} from '../../execution-engine/testing/execution-engine-fixtures';

export function createObservabilityRequest(
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return createExecutionRequestFixture(overrides);
}

export async function createSuccessfulExecutionResult(
  request: ExecutionRequest = createObservabilityRequest(),
): Promise<ExecutionResult> {
  const executionRequestHash = calculateCanonicalJsonHash(request);
  const executionId = createDeterministicExecutionId(
    executionRequestHash,
    EXECUTION_CONTRACT_VERSION,
  );
  const workflowRequest = createWorkflowRequestForExecution(request, executionId);
  const workflowResult = await createSuccessfulWorkflowResultFixture(workflowRequest);
  return createExecutionEngine({
    orchestrator: { execute: async () => workflowResult },
    now: incrementalClock(1_000, 10),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  }).execute(request);
}

export function fixedClock(start = 1_000, step = 10): () => number {
  let current = start;
  return () => {
    current += step;
    return current;
  };
}
