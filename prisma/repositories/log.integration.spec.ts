import { ERROR_CODES } from '@brq/shared/errors/error-codes';
import type { AgentExecution, Execution, Project } from '@brq/shared/types/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAgentExecutionRepository } from './prisma-agent-execution-repository';
import { PrismaArtifactRepository } from './prisma-artifact-repository';
import { PrismaExecutionRepository } from './prisma-execution-repository';
import { PrismaLogRepository } from './prisma-log-repository';
import { PrismaProjectRepository } from './prisma-project-repository';
import { PrismaPromptVersionRepository } from './prisma-prompt-version-repository';
import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../tests/database-test-context';

describe('Prisma log repository', () => {
  let context: DatabaseTestContext;
  let logs: PrismaLogRepository;
  let artifacts: PrismaArtifactRepository;
  let project: Project;
  let execution: Execution;
  let agentExecution: AgentExecution;

  beforeAll(async () => {
    context = await createDatabaseTestContext();
    const projects = new PrismaProjectRepository(context.client);
    const executions = new PrismaExecutionRepository(context.client);
    const prompts = new PrismaPromptVersionRepository(context.client);
    const agentExecutions = new PrismaAgentExecutionRepository(context.client);
    artifacts = new PrismaArtifactRepository(context.client);
    logs = new PrismaLogRepository(context.client);

    project = await projects.create({
      name: 'Projeto de logs',
      description: 'Projeto fictício para logs persistidos.',
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
      content: 'Prompt fictício para logs.',
      status: 'ACTIVE',
      description: null,
      source: 'integration-test',
    });
    agentExecution = await agentExecutions.create({
      executionId: execution.id,
      agent: 'PRODUCT_OWNER',
      status: 'CREATED',
      attempt: 1,
      input: {
        executionId: execution.id,
        projectId: project.id,
        agent: 'PRODUCT_OWNER',
        input: {},
        context: {},
        constraints: {},
        metadata: { requestedAt: new Date().toISOString() },
      },
      output: null,
      agentVersion: '1.0.0',
      promptVersion: '1.0.0',
      schemaVersion: '1.0.0',
      model: null,
      usage: null,
      durationMs: null,
      startedAt: null,
      finishedAt: null,
    });
  });

  afterAll(async () => {
    await context?.cleanup();
  });

  it('should append and retrieve structured logs with correlation fields', async () => {
    const artifact = await artifacts.createNextVersion({
      executionId: execution.id,
      agentExecutionId: agentExecution.id,
      name: 'Log artifact',
      filename: 'log-artifact.md',
      type: 'TEST',
      content: 'Conteúdo fictício.',
      provenance: {
        agent: 'PRODUCT_OWNER',
        promptVersion: '1.0.0',
        model: 'test-model',
      },
    });
    const created = await logs.append({
      executionId: execution.id,
      agentExecutionId: agentExecution.id,
      artifactId: artifact.id,
      level: 'info',
      event: 'artifact.created',
      message: 'Artifact fictício persistido.',
      context: {
        projectId: project.id,
        durationMs: 25,
      },
      requestId: 'request_123',
      traceId: 'trace_123',
    });

    expect(created).toMatchObject({
      executionId: execution.id,
      agentExecutionId: agentExecution.id,
      artifactId: artifact.id,
      level: 'info',
      event: 'artifact.created',
      context: { projectId: project.id, durationMs: 25 },
    });
    await expect(logs.listByExecution(execution.id)).resolves.toContainEqual(created);
  });

  it('should reject correlations from another Execution', async () => {
    const projects = new PrismaProjectRepository(context.client);
    const executions = new PrismaExecutionRepository(context.client);
    const anotherProject = await projects.create({
      name: 'Projeto sem correlação',
      description: 'Projeto fictício para correlação inválida.',
      status: 'ACTIVE',
    });
    const anotherExecution = await executions.create({
      projectId: anotherProject.id,
      status: 'CREATED',
      startedAt: null,
      finishedAt: null,
    });

    await expect(
      logs.append({
        executionId: anotherExecution.id,
        agentExecutionId: agentExecution.id,
        artifactId: null,
        level: 'warn',
        event: 'correlation.invalid',
        message: null,
        context: {},
        requestId: null,
        traceId: null,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_INPUT });
  });

  it('should preserve logs and null an optional artifact correlation on physical deletion', async () => {
    const artifact = await artifacts.createNextVersion({
      executionId: execution.id,
      agentExecutionId: agentExecution.id,
      name: 'Artifact temporário',
      filename: 'temporary.md',
      type: 'TEST',
      content: 'Conteúdo fictício.',
      provenance: {
        agent: 'PRODUCT_OWNER',
        promptVersion: '1.0.0',
        model: 'test-model',
      },
    });
    const log = await logs.append({
      executionId: execution.id,
      agentExecutionId: agentExecution.id,
      artifactId: artifact.id,
      level: 'info',
      event: 'artifact.versioned',
      message: null,
      context: {},
      requestId: null,
      traceId: null,
    });

    await context.client.artifact.delete({ where: { id: artifact.id } });

    await expect(context.client.log.findUnique({ where: { id: log.id } })).resolves.toMatchObject({
      id: log.id,
      artifactId: null,
      executionId: execution.id,
    });
  });

  it('should report a missing required execution', async () => {
    await expect(
      logs.append({
        executionId: 'missing_execution',
        agentExecutionId: null,
        artifactId: null,
        level: 'error',
        event: 'execution.missing',
        message: null,
        context: {},
        requestId: null,
        traceId: null,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTITY_NOT_FOUND });
  });
});
