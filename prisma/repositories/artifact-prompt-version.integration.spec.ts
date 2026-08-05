import { createHash } from 'node:crypto';

import { ERROR_CODES } from '@brq/shared/errors/error-codes';
import type { AgentExecution, Execution, Project } from '@brq/shared/types/domain';
import type { PromptVersion } from '@brq/shared/types/prompt-version';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAgentExecutionRepository } from './prisma-agent-execution-repository';
import { PrismaArtifactRepository } from './prisma-artifact-repository';
import { PrismaExecutionRepository } from './prisma-execution-repository';
import { PrismaProjectRepository } from './prisma-project-repository';
import { PrismaPromptVersionRepository } from './prisma-prompt-version-repository';
import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../tests/database-test-context';

describe('Prisma artifact and prompt version repositories', () => {
  let context: DatabaseTestContext;
  let artifacts: PrismaArtifactRepository;
  let prompts: PrismaPromptVersionRepository;
  let project: Project;
  let execution: Execution;
  let agentExecution: AgentExecution;
  let prompt: PromptVersion;

  beforeAll(async () => {
    context = await createDatabaseTestContext();
    const projects = new PrismaProjectRepository(context.client);
    const executions = new PrismaExecutionRepository(context.client);
    const agentExecutions = new PrismaAgentExecutionRepository(context.client);
    artifacts = new PrismaArtifactRepository(context.client);
    prompts = new PrismaPromptVersionRepository(context.client);

    project = await projects.create({
      name: 'Projeto de artifacts',
      description: 'Projeto fictício para versionamento.',
      status: 'ACTIVE',
    });
    execution = await executions.create({
      projectId: project.id,
      status: 'CREATED',
      startedAt: null,
      finishedAt: null,
    });
    prompt = await prompts.create({
      agent: 'PRODUCT_OWNER',
      version: '1.0.0',
      schemaVersion: '1.0.0',
      content: 'Prompt fictício e imutável.',
      status: 'ACTIVE',
      description: 'Prompt usado apenas por testes.',
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
      promptVersion: prompt.version,
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

  it('should hash, find, list, and update only the prompt status', async () => {
    const expectedHash = createHash('sha256')
      .update('Prompt fictício e imutável.', 'utf8')
      .digest('hex');

    expect(prompt.hash).toBe(expectedHash);
    await expect(prompts.findById(prompt.id)).resolves.toEqual(prompt);
    await expect(prompts.findByAgentVersion('PRODUCT_OWNER', '1.0.0')).resolves.toEqual(prompt);
    await expect(prompts.listByAgent('PRODUCT_OWNER')).resolves.toEqual([prompt]);

    const updated = await prompts.updateStatus(prompt.id, 'DEPRECATED');

    expect(updated).toMatchObject({
      id: prompt.id,
      status: 'DEPRECATED',
      content: prompt.content,
      hash: prompt.hash,
    });
  });

  it('should reject a duplicated prompt version', async () => {
    await expect(
      prompts.create({
        agent: 'PRODUCT_OWNER',
        version: '1.0.0',
        schemaVersion: '1.0.0',
        content: 'Outro conteúdo fictício.',
        status: 'DRAFT',
        description: null,
        source: 'integration-test',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERSISTENCE_CONFLICT });
  });

  it('should create immutable artifact rows with versions scoped by execution and filename', async () => {
    const input = {
      executionId: execution.id,
      agentExecutionId: agentExecution.id,
      name: 'User Story',
      filename: 'user-story.md',
      type: 'USER_STORY',
      content: '# Versão fictícia',
      provenance: {
        agent: 'PRODUCT_OWNER' as const,
        promptVersion: '1.0.0',
        model: 'test-model',
      },
    };

    const first = await artifacts.createNextVersion(input);
    const second = await artifacts.createNextVersion({
      ...input,
      content: '# Segunda versão fictícia',
    });
    const anotherFilename = await artifacts.createNextVersion({
      ...input,
      filename: 'acceptance-criteria.md',
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(anotherFilename.version).toBe(1);
    await expect(artifacts.findById(second.id)).resolves.toEqual(second);
    await expect(artifacts.listByExecution(execution.id)).resolves.toHaveLength(3);
  });

  it('should reject unsafe filenames before persistence', async () => {
    await expect(
      artifacts.createNextVersion({
        executionId: execution.id,
        agentExecutionId: agentExecution.id,
        name: 'Artifact inseguro',
        filename: '../artifact.md',
        type: 'TEST',
        content: 'Conteúdo fictício.',
        provenance: {
          agent: 'PRODUCT_OWNER',
          promptVersion: '1.0.0',
          model: 'test-model',
        },
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_INPUT });
  });

  it('should reject provenance that contradicts the producing AgentExecution', async () => {
    await expect(
      artifacts.createNextVersion({
        executionId: execution.id,
        agentExecutionId: agentExecution.id,
        name: 'Artifact sem rastreabilidade',
        filename: 'invalid-provenance.md',
        type: 'TEST',
        content: 'Conteúdo fictício.',
        provenance: {
          agent: 'QA',
          promptVersion: '1.0.0',
          model: 'test-model',
        },
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_INPUT });
  });

  it('should reject an AgentExecution from another Execution', async () => {
    const projects = new PrismaProjectRepository(context.client);
    const executions = new PrismaExecutionRepository(context.client);
    const anotherProject = await projects.create({
      name: 'Outro projeto',
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
      artifacts.createNextVersion({
        executionId: anotherExecution.id,
        agentExecutionId: agentExecution.id,
        name: 'Artifact inválido',
        filename: 'invalid.md',
        type: 'TEST',
        content: 'Conteúdo fictício.',
        provenance: {
          agent: 'PRODUCT_OWNER',
          promptVersion: '1.0.0',
          model: 'test-model',
        },
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_INPUT });
  });
});
