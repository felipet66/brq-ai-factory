import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { logWorkerEvent } from './logging';

describe('execution worker logging', () => {
  it('emits only the explicit technical allowlist and nests sanitized error codes', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });

    logWorkerEvent(logger, 'error', 'execution.worker.failed', {
      jobId: `job-${'a'.repeat(32)}`,
      executionId: `execution-${'b'.repeat(32)}`,
      workflowId: 'workflow-public',
      status: 'FAILED',
      errorCode: 'EXECUTION_WORKER_EXECUTION_FAILED',
    });

    expect(JSON.parse(lines[0]!)).toEqual({
      level: 'error',
      event: 'execution.worker.failed',
      jobId: `job-${'a'.repeat(32)}`,
      executionId: `execution-${'b'.repeat(32)}`,
      workflowId: 'workflow-public',
      status: 'FAILED',
      error: { code: 'EXECUTION_WORKER_EXECUTION_FAILED' },
      timestamp: '1970-01-01T00:00:00.000Z',
    });
  });

  it('is a no-op without a logger and omits absent fields', () => {
    expect(() => logWorkerEvent(undefined, 'info', 'execution.worker.idle', {})).not.toThrow();
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    logWorkerEvent(logger, 'info', 'execution.worker.idle', {});
    expect(JSON.parse(lines[0]!)).toEqual({
      level: 'info',
      event: 'execution.worker.idle',
      timestamp: '1970-01-01T00:00:00.000Z',
    });
  });
});
