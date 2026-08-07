import { describe, expect, it } from 'vitest';

import * as publicApi from '@brq/execution-worker';
import * as testingApi from '@brq/execution-worker/testing';

describe('execution worker public exports', () => {
  it('exports only the dispatcher, worker, stable errors and job identity helper', () => {
    expect(publicApi.createExecutionDispatcher).toBeTypeOf('function');
    expect(publicApi.createExecutionWorker).toBeTypeOf('function');
    expect(publicApi.createJobId).toBeTypeOf('function');
    expect(publicApi.ExecutionWorkerError).toBeTypeOf('function');
    expect(publicApi.EXECUTION_WORKER_ERROR_CODES.SHUTDOWN).toBe('EXECUTION_WORKER_SHUTDOWN');
    expect(publicApi).not.toHaveProperty('logWorkerEvent');
  });

  it('provides deterministic fake-only fixtures through the testing subpath', () => {
    const request = testingApi.createWorkerExecutionRequestFixture();
    expect(request.workflowId).toMatch(/^workflow-/);
    expect(testingApi.createFailedExecutionResultFixture(request).workflowId).toBe(
      request.workflowId,
    );
    expect(testingApi.incrementalWorkerClock(0, 10)()).toBe(10);
  });
});
