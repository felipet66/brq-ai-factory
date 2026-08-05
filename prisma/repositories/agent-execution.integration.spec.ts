import { ERROR_CODES } from '@brq/shared/errors/error-codes';
import type { AgentExecution, Execution, Project } from '@brq/shared/types/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAgentExecutionRepository } from './prisma-agent-execution-repository';
import { PrismaExecutionRepository } from './prisma-execution-repository';
import { PrismaProjectRepository } from './prisma-project-repository';
import { PrismaPromptVersionRepository } from './prisma-prompt-version-repository';
import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../tests/database-test-context';

describe('Prisma agent execution repository', () => {
  let context: DatabaseTestContext;
  let repository: PrismaAgentExecutionRepository;
  let project: Project;
  let execution: Execution;
  let firstAgentExecution: AgentExecution;

  beforeAll(async () => {
    context = await createDatabaseTestContext();
    const projects = new PrismaProjectRepository(context.client);
    const executions = new PrismaExecutionRepository(context.client);
    const prompts = new PrismaPromptVersionRepository(context.client);
    repository = new PrismaAgentExecutionRepository(context.client);

    project = await projects.create({
      name: 'Projeto de agentes',
      description: 'Projeto fictício para persistência de agentes.',
      status: 'ACTIVE',
    });
    execution = await executions.create({
      projectId: project.id,
      status: 'CREATED',
      startedAt: null,
      finishedAt: null,
    });
    await prompts.create({
      agent: 'PRODUCT_OWNER',
      version: '1.0.0',
      schemaVersion: '1.0.0',
      content: 'Prompt fictício para integração.',
      status: 'ACTIVE',
      description: null,
      source: 'integration-test',
    });
  });

  afterAll(async () => {
    await context?.cleanup();
  });

  function createdInput(attempt: number, promptVersion = '1.0.0') {
    return {
      executionId: execution.id,
      agent: 'PRODUCT_OWNER' as const,
      status: 'CREATED' as const,
      attempt,
      input: {
        executionId: execution.id,
        projectId: project.id,
        agent: 'PRODUCT_OWNER' as const,
        input: { title: 'Demanda sintética' },
        context: { source: 'integration-test' },
        constraints: {},
        metadata: { requestedAt: new Date().toISOString() },
      },
      output: null,
      agentVersion: '1.0.0',
      promptVersion,
      schemaVersion: '1.0.0',
      model: null,
      usage: null,
      durationMs: null,
      startedAt: null,
      finishedAt: null,
    };
  }

  it('should round-trip JSON, tokens, duration, and lifecycle dates', async () => {
    firstAgentExecution = await repository.create(createdInput(1));

    expect(firstAgentExecution.output).toBeNull();
    expect(firstAgentExecution.usage).toBeNull();

    const startedAt = new Date().toISOString();
    const finishedAt = new Date(Date.parse(startedAt) + 50).toISOString();
    const completed = await repository.update({
      ...firstAgentExecution,
      status: 'SUCCESS',
      output: {
        status: 'SUCCESS',
        summary: 'Demanda fictícia processada.',
        artifacts: [],
        nextContext: { storyId: 'US-001' },
        warnings: [],
        metadata: {
          agent: 'PRODUCT_OWNER',
          promptVersion: '1.0.0',
          schemaVersion: '1.0.0',
        },
        details: { acceptanceCriteria: 3 },
      },
      model: 'test-model',
      usage: { inputTokens: 120, outputTokens: 45 },
      durationMs: 50,
      startedAt,
      finishedAt,
    });

    expect(completed).toMatchObject({
      status: 'SUCCESS',
      model: 'test-model',
      usage: { inputTokens: 120, outputTokens: 45 },
      durationMs: 50,
    });
    expect(completed.output).toMatchObject({
      details: { acceptanceCriteria: 3 },
    });
    await expect(repository.findById(completed.id)).resolves.toEqual(completed);
  });

  it('should translate a duplicated attempt into a persistence conflict', async () => {
    await expect(repository.create(createdInput(1))).rejects.toMatchObject({
      code: ERROR_CODES.PERSISTENCE_CONFLICT,
      statusCode: 409,
    });
  });

  it('should allow a retry as a new AgentExecution in the same Execution', async () => {
    const retry = await repository.create(createdInput(2));

    expect(retry.attempt).toBe(2);
    await expect(repository.listByExecution(execution.id)).resolves.toHaveLength(2);
  });

  it('should validate envelope correlation before persistence', async () => {
    const input = createdInput(3);

    await expect(
      repository.create({
        ...input,
        input: {
          ...input.input,
          executionId: 'another_execution',
        },
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_INPUT });
  });

  it('should require the referenced prompt version', async () => {
    await expect(repository.create(createdInput(3, '9.9.9'))).rejects.toMatchObject({
      code: ERROR_CODES.PERSISTENCE_CONFLICT,
    });
  });
});
