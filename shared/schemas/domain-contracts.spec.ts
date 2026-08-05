import { describe, expect, it } from 'vitest';

import { agentExecutionSchema, executionSchema, projectSchema } from './domain.schema';

const CREATED_AT = '2026-08-04T18:00:00.000Z';
const STARTED_AT = '2026-08-04T18:01:00.000Z';
const FINISHED_AT = '2026-08-04T18:02:00.000Z';

const baseAgentInput = {
  executionId: 'execution_123',
  projectId: 'project_123',
  agent: 'PRODUCT_OWNER',
  input: { title: 'Demanda fictícia' },
  context: {},
  constraints: {},
  metadata: { requestedAt: CREATED_AT },
} as const;

const baseAgentExecution = {
  id: 'agent_execution_123',
  executionId: 'execution_123',
  agent: 'PRODUCT_OWNER',
  attempt: 1,
  input: baseAgentInput,
  output: null,
  agentVersion: '1.0.0',
  promptVersion: '1.0.0',
  schemaVersion: '1.0.0',
  model: null,
  usage: null,
  durationMs: null,
  createdAt: CREATED_AT,
} as const;

describe('projectSchema', () => {
  it('should accept a project with a canonical status', () => {
    const result = projectSchema.safeParse({
      id: 'project_123',
      name: 'Projeto demonstrativo',
      description: 'Projeto criado somente com dados fictícios.',
      status: 'ACTIVE',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(result.success).toBe(true);
  });

  it('should reject a non-canonical project status', () => {
    const result = projectSchema.safeParse({
      id: 'project_123',
      name: 'Projeto demonstrativo',
      description: 'Projeto criado somente com dados fictícios.',
      status: 'DELETED',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(result.success).toBe(false);
  });
});

describe('executionSchema date coherence', () => {
  it('should require null lifecycle dates for CREATED', () => {
    expect(
      executionSchema.safeParse({
        id: 'execution_123',
        projectId: 'project_123',
        status: 'CREATED',
        createdAt: CREATED_AT,
        startedAt: null,
        finishedAt: null,
      }).success,
    ).toBe(true);

    expect(
      executionSchema.safeParse({
        id: 'execution_123',
        projectId: 'project_123',
        status: 'CREATED',
        createdAt: CREATED_AT,
        startedAt: STARTED_AT,
        finishedAt: null,
      }).success,
    ).toBe(false);
  });

  it('should require startedAt and a null finishedAt for RUNNING', () => {
    expect(
      executionSchema.safeParse({
        id: 'execution_123',
        projectId: 'project_123',
        status: 'RUNNING',
        createdAt: CREATED_AT,
        startedAt: STARTED_AT,
        finishedAt: null,
      }).success,
    ).toBe(true);

    expect(
      executionSchema.safeParse({
        id: 'execution_123',
        projectId: 'project_123',
        status: 'RUNNING',
        createdAt: CREATED_AT,
        startedAt: null,
        finishedAt: null,
      }).success,
    ).toBe(false);
  });

  it('should keep REQUIRES_REVIEW open until a resolution exists', () => {
    expect(
      executionSchema.safeParse({
        id: 'execution_123',
        projectId: 'project_123',
        status: 'REQUIRES_REVIEW',
        createdAt: CREATED_AT,
        startedAt: STARTED_AT,
        finishedAt: null,
      }).success,
    ).toBe(true);
  });

  it.each(['SUCCESS', 'FAILED', 'CANCELLED'] as const)(
    'should require finishedAt for final status %s',
    (status) => {
      expect(
        executionSchema.safeParse({
          id: 'execution_123',
          projectId: 'project_123',
          status,
          createdAt: CREATED_AT,
          startedAt: status === 'CANCELLED' ? null : STARTED_AT,
          finishedAt: FINISHED_AT,
        }).success,
      ).toBe(true);

      expect(
        executionSchema.safeParse({
          id: 'execution_123',
          projectId: 'project_123',
          status,
          createdAt: CREATED_AT,
          startedAt: status === 'CANCELLED' ? null : STARTED_AT,
          finishedAt: null,
        }).success,
      ).toBe(false);
    },
  );

  it('should reject finishedAt before startedAt', () => {
    const result = executionSchema.safeParse({
      id: 'execution_123',
      projectId: 'project_123',
      status: 'SUCCESS',
      createdAt: CREATED_AT,
      startedAt: FINISHED_AT,
      finishedAt: STARTED_AT,
    });

    expect(result.success).toBe(false);
  });
});

describe('agentExecutionSchema date coherence', () => {
  it('should require null lifecycle dates for CREATED', () => {
    expect(
      agentExecutionSchema.safeParse({
        ...baseAgentExecution,
        status: 'CREATED',
        startedAt: null,
        finishedAt: null,
      }).success,
    ).toBe(true);

    expect(
      agentExecutionSchema.safeParse({
        ...baseAgentExecution,
        status: 'CREATED',
        startedAt: STARTED_AT,
        finishedAt: null,
      }).success,
    ).toBe(false);
  });

  it('should require startedAt and a null finishedAt for RUNNING', () => {
    expect(
      agentExecutionSchema.safeParse({
        ...baseAgentExecution,
        status: 'RUNNING',
        startedAt: STARTED_AT,
        finishedAt: null,
      }).success,
    ).toBe(true);

    expect(
      agentExecutionSchema.safeParse({
        ...baseAgentExecution,
        status: 'RUNNING',
        startedAt: null,
        finishedAt: null,
      }).success,
    ).toBe(false);
  });

  it.each(['SUCCESS', 'PARTIAL_SUCCESS', 'REQUIRES_REVIEW', 'FAILED', 'CANCELLED'] as const)(
    'should require finishedAt for final status %s',
    (status) => {
      expect(
        agentExecutionSchema.safeParse({
          ...baseAgentExecution,
          status,
          startedAt: status === 'CANCELLED' ? null : STARTED_AT,
          finishedAt: FINISHED_AT,
        }).success,
      ).toBe(true);

      expect(
        agentExecutionSchema.safeParse({
          ...baseAgentExecution,
          status,
          startedAt: status === 'CANCELLED' ? null : STARTED_AT,
          finishedAt: null,
        }).success,
      ).toBe(false);
    },
  );

  it('should reject finishedAt before startedAt', () => {
    const result = agentExecutionSchema.safeParse({
      ...baseAgentExecution,
      status: 'FAILED',
      startedAt: FINISHED_AT,
      finishedAt: STARTED_AT,
    });

    expect(result.success).toBe(false);
  });

  it('should restrict agent-specific output fields to JSON values', () => {
    const output = {
      status: 'SUCCESS',
      summary: 'Resultado fictício.',
      artifacts: [],
      nextContext: {},
      warnings: [],
      metadata: {
        agent: 'PRODUCT_OWNER',
        promptVersion: '1.0.0',
        schemaVersion: '1.0.0',
      },
      customField: () => 'not-json',
    } as const;

    expect(
      agentExecutionSchema.safeParse({
        ...baseAgentExecution,
        status: 'SUCCESS',
        output,
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
      }).success,
    ).toBe(false);
  });
});
