import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { logQueueEvent, logQueueShutdown } from './logging';
import type { JobRecord, QueueEvent } from './contracts';
import { createInMemoryJobQueue } from './in-memory-job-queue';
import { createJobInputFixture } from './testing/job-queue-fixtures';

describe('job queue logging', () => {
  it('logs only allowlisted queue metadata at the appropriate level', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({ logger });
    const input = createJobInputFixture();
    await queue.enqueue(input);
    await queue.claimNext();
    await queue.fail(input.jobId, { code: 'EXECUTION_FAILED', message: 'private detail' });

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"event":"job.created"');
    expect(lines[1]).toContain('"event":"job.started"');
    expect(lines[2]).toContain('"level":"error"');
    expect(lines[2]).toContain('EXECUTION_FAILED');
    expect(lines.join('\n')).not.toContain('private detail');
    expect(lines.join('\n')).not.toContain(input.request.demand.description);
  });

  it('covers cancellation/shutdown logs and treats an absent logger as a no-op', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const input = createJobInputFixture();
    const event: QueueEvent = {
      sequence: 2,
      type: 'job.cancelled',
      jobId: input.jobId,
      executionId: input.executionId,
      workflowId: input.request.workflowId,
      status: 'CANCELLED',
      occurredAt: '2026-08-07T12:00:00.000Z',
      durationMs: 5,
      errorCode: 'JOB_QUEUE_CANCELLED',
    };
    const record = {
      status: 'CANCELLED',
    } as JobRecord;

    expect(() => logQueueEvent(undefined, event)).not.toThrow();
    expect(() => logQueueShutdown(undefined, [record])).not.toThrow();
    logQueueEvent(logger, event);
    logQueueShutdown(logger, [record, { status: 'RUNNING' } as JobRecord]);

    expect(lines[0]).toContain('"level":"warn"');
    expect(lines[0]).toContain('"durationMs":5');
    expect(lines[1]).toContain('"cancelledJobs":1');
    expect(lines[1]).toContain('"runningJobs":1');
  });
});
