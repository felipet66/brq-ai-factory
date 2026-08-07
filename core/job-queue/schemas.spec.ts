import { describe, expect, it } from 'vitest';

import { createJobInputFixture } from './testing/job-queue-fixtures';
import {
  claimedJobSchema,
  enqueueJobInputSchema,
  jobRecordSchema,
  queueMetricsSchema,
} from './schemas';

const queuedRecord = () => {
  const input = createJobInputFixture();
  return {
    jobId: input.jobId,
    executionId: input.executionId,
    workflowId: input.request.workflowId,
    status: 'QUEUED' as const,
    attempt: 1 as const,
    queuedAt: '2026-08-07T12:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failure: null,
    events: [
      {
        sequence: 1,
        type: 'job.created' as const,
        jobId: input.jobId,
        executionId: input.executionId,
        workflowId: input.request.workflowId,
        status: 'QUEUED' as const,
        occurredAt: '2026-08-07T12:00:00.000Z',
        durationMs: null,
        errorCode: null,
      },
    ],
  };
};

const runningRecord = () => {
  const queued = queuedRecord();
  return {
    ...queued,
    status: 'RUNNING' as const,
    startedAt: '2026-08-07T12:00:01.000Z',
    events: [
      ...queued.events,
      {
        ...queued.events[0],
        sequence: 2,
        type: 'job.started' as const,
        status: 'RUNNING' as const,
        occurredAt: '2026-08-07T12:00:01.000Z',
      },
    ],
  };
};

describe('job queue schemas', () => {
  it('accepts only strict enqueue inputs and preserves the execution request contract', () => {
    const input = createJobInputFixture();
    expect(enqueueJobInputSchema.parse(input)).toEqual(input);
    expect(enqueueJobInputSchema.safeParse({ ...input, retry: 2 }).success).toBe(false);
    expect(
      enqueueJobInputSchema.safeParse({ ...input, request: { ...input.request, prompt: 'secret' } })
        .success,
    ).toBe(false);
  });

  it('enforces metadata-only lifecycle invariants', () => {
    const record = queuedRecord();
    expect(jobRecordSchema.safeParse(record).success).toBe(true);
    expect(jobRecordSchema.safeParse({ ...record, startedAt: record.queuedAt }).success).toBe(
      false,
    );
    expect(
      jobRecordSchema.safeParse({
        ...record,
        events: [{ ...record.events[0], workflowId: 'workflow-mismatch' }],
      }).success,
    ).toBe(false);
    expect(
      jobRecordSchema.safeParse({
        ...record,
        events: [{ ...record.events[0], type: 'job.started' }],
      }).success,
    ).toBe(false);
    expect(
      jobRecordSchema.safeParse({
        ...record,
        events: [{ ...record.events[0], sequence: 2 }],
      }).success,
    ).toBe(false);
  });

  it('requires a RUNNING record correlated with the claimed payload', () => {
    const input = createJobInputFixture();
    expect(
      claimedJobSchema.safeParse({ record: queuedRecord(), request: input.request }).success,
    ).toBe(false);
    expect(
      claimedJobSchema.safeParse({
        record: runningRecord(),
        request: input.request,
      }).success,
    ).toBe(true);
    expect(
      claimedJobSchema.safeParse({
        record: runningRecord(),
        request: createJobInputFixture(2).request,
      }).success,
    ).toBe(false);
  });

  it('rejects non-monotonic events, temporal inversions and incoherent terminal data', () => {
    const running = runningRecord();
    expect(
      jobRecordSchema.safeParse({
        ...running,
        events: running.events.map((event, index) =>
          index === 1 ? { ...event, occurredAt: '2026-08-07T11:59:59.000Z' } : event,
        ),
      }).success,
    ).toBe(false);
    expect(
      jobRecordSchema.safeParse({
        ...running,
        startedAt: '2026-08-07T11:59:59.000Z',
      }).success,
    ).toBe(false);
    expect(
      jobRecordSchema.safeParse({
        ...running,
        status: 'SUCCESS',
        finishedAt: '2026-08-07T12:00:00.500Z',
        durationMs: 0,
        events: [
          ...running.events,
          {
            ...running.events[0],
            sequence: 3,
            type: 'job.finished',
            status: 'SUCCESS',
            occurredAt: '2026-08-07T12:00:00.500Z',
            durationMs: 0,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      jobRecordSchema.safeParse({
        ...running,
        status: 'FAILED',
        finishedAt: '2026-08-07T12:00:02.000Z',
        durationMs: 1_000,
        failure: null,
        events: [
          ...running.events,
          {
            ...running.events[0],
            sequence: 3,
            type: 'job.failed',
            status: 'FAILED',
            occurredAt: '2026-08-07T12:00:02.000Z',
            durationMs: 1_000,
            errorCode: 'FAILED',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('validates that queue metrics add up', () => {
    expect(
      queueMetricsSchema.safeParse({
        totalJobs: 3,
        queued: 1,
        running: 1,
        success: 1,
        failed: 0,
        cancelled: 0,
        retainedPayloads: 2,
        acceptingJobs: true,
      }).success,
    ).toBe(true);
    expect(
      queueMetricsSchema.safeParse({
        totalJobs: 7,
        queued: 1,
        running: 1,
        success: 1,
        failed: 0,
        cancelled: 0,
        retainedPayloads: 2,
        acceptingJobs: true,
      }).success,
    ).toBe(false);
    expect(
      queueMetricsSchema.safeParse({
        totalJobs: 1,
        queued: 0,
        running: 0,
        success: 1,
        failed: 0,
        cancelled: 0,
        retainedPayloads: 1,
        acceptingJobs: true,
      }).success,
    ).toBe(false);
  });
});
