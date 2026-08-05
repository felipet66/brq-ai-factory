import { describe, expect, it } from 'vitest';

import { logRecordCreateInputSchema, logRecordSchema } from './log-record.schema';
import { promptVersionCreateInputSchema, promptVersionSchema } from './prompt-version.schema';

const NOW = '2026-08-04T18:00:00.000Z';

describe('prompt version persistence contracts', () => {
  const createInput = {
    agent: 'PRODUCT_OWNER',
    version: '1.0.0',
    schemaVersion: '1.0.0',
    content: 'Prompt fictício para teste.',
    status: 'ACTIVE',
    description: 'Versão inicial fictícia.',
    source: 'integration-test',
  } as const;

  it('should accept creation input without infrastructure fields', () => {
    expect(promptVersionCreateInputSchema.safeParse(createInput).success).toBe(true);
  });

  it('should accept a persisted prompt version with a SHA-256 hash', () => {
    expect(
      promptVersionSchema.safeParse({
        ...createInput,
        id: 'prompt_version_123',
        hash: 'a'.repeat(64),
        createdAt: NOW,
        updatedAt: NOW,
      }).success,
    ).toBe(true);
  });

  it('should reject invalid semantic versions and hashes', () => {
    expect(
      promptVersionSchema.safeParse({
        ...createInput,
        id: 'prompt_version_123',
        version: 'latest',
        hash: 'invalid',
        createdAt: NOW,
        updatedAt: NOW,
      }).success,
    ).toBe(false);
  });
});

describe('log persistence contracts', () => {
  const createInput = {
    executionId: 'execution_123',
    agentExecutionId: null,
    artifactId: null,
    level: 'info',
    event: 'execution.created',
    message: null,
    context: { projectId: 'project_123' },
    requestId: null,
    traceId: 'trace_123',
  } as const;

  it('should accept structured creation input and persisted logs', () => {
    expect(logRecordCreateInputSchema.safeParse(createInput).success).toBe(true);
    expect(
      logRecordSchema.safeParse({
        ...createInput,
        id: 'log_123',
        createdAt: NOW,
      }).success,
    ).toBe(true);
  });

  it('should reject unknown log levels and malformed event names', () => {
    expect(
      logRecordCreateInputSchema.safeParse({
        ...createInput,
        level: 'critical',
        event: 'Execution Created',
      }).success,
    ).toBe(false);
  });
});
