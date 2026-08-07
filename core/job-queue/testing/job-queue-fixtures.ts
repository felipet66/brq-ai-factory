import type { ExecutionRequest } from '@brq/execution-engine';

import { createExecutionRequestFixture } from '../../execution-engine/testing/execution-engine-fixtures';
import type { EnqueueJobInput } from '../contracts';
import { enqueueJobInputSchema } from '../schemas';

function hexadecimalId(value: number): string {
  return value.toString(16).padStart(32, '0');
}

export function createJobInputFixture(
  sequence = 1,
  overrides: Partial<EnqueueJobInput> = {},
): EnqueueJobInput {
  const overriddenRequest = overrides.request as ExecutionRequest | undefined;
  const request =
    overriddenRequest ??
    createExecutionRequestFixture({
      workflowId: `workflow-00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`,
    });
  return enqueueJobInputSchema.parse({
    jobId: `job-${hexadecimalId(sequence)}`,
    executionId: `execution-${hexadecimalId(sequence)}`,
    request,
    ...overrides,
  });
}

export function incrementalQueueClock(start = 0, step = 10): () => number {
  let value = start;
  return () => {
    value += step;
    return value;
  };
}
