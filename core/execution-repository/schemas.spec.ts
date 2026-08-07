import { describe, expect, it } from 'vitest';

import { createExecutionRecordFixture } from './testing/execution-record-fixtures';
import {
  executionRecordCreatedInputSchema,
  executionRecordListQuerySchema,
  executionRecordSchema,
} from './schemas';

describe('execution record schemas', () => {
  it('rejects unknown and sensitive creation fields', () => {
    expect(
      executionRecordCreatedInputSchema.safeParse({
        workflowId: 'workflow-001',
        requestId: null,
        traceId: null,
        projectName: 'Safe title',
        createdAt: '2026-08-07T12:00:00.000Z',
        metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
        prompt: 'must never persist',
      }).success,
    ).toBe(false);
  });

  it('enforces contiguous lifecycle events and terminal identifiers', () => {
    const record = createExecutionRecordFixture();
    expect(
      executionRecordSchema.safeParse({
        ...record,
        lifecycle: record.lifecycle.map((event, index) =>
          index === 1 ? { ...event, sequence: 7 } : event,
        ),
      }).success,
    ).toBe(false);
    expect(executionRecordSchema.safeParse({ ...record, executionId: null }).success).toBe(false);
  });

  it('rejects terminal metadata on active records and mismatched observations', () => {
    const terminal = createExecutionRecordFixture();
    const active = {
      ...terminal,
      status: 'RUNNING',
      workflowStatus: null,
      executionId: terminal.executionId,
      lifecycle: terminal.lifecycle.slice(0, 2),
    };
    expect(executionRecordSchema.safeParse(active).success).toBe(false);
    expect(
      executionRecordSchema.safeParse({
        ...terminal,
        workflowId: 'different-workflow',
      }).success,
    ).toBe(false);
  });

  it('defaults page size and validates date ranges', () => {
    expect(executionRecordListQuerySchema.parse({}).limit).toBe(20);
    expect(
      executionRecordListQuerySchema.safeParse({
        createdAfter: '2026-08-08T00:00:00.000Z',
        createdBefore: '2026-08-07T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
