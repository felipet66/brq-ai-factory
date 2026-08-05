import { AppError } from '@brq/shared/errors/app-error';
import { ERROR_CODES } from '@brq/shared/errors/error-codes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaExecutionRepository } from './prisma-execution-repository';
import { PrismaProjectRepository } from './prisma-project-repository';
import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../tests/database-test-context';

describe('Prisma project and execution repositories', () => {
  let context: DatabaseTestContext;
  let projects: PrismaProjectRepository;
  let executions: PrismaExecutionRepository;

  beforeAll(async () => {
    context = await createDatabaseTestContext();
    projects = new PrismaProjectRepository(context.client);
    executions = new PrismaExecutionRepository(context.client);
  });

  afterAll(async () => {
    await context?.cleanup();
  });

  it('should persist, retrieve, list, and update canonical projects', async () => {
    const created = await projects.create({
      name: 'Projeto fictício',
      description: 'Dados sintéticos para teste de integração.',
      status: 'ACTIVE',
    });

    expect(created.id).toBeTruthy();
    expect(Date.parse(created.createdAt)).not.toBeNaN();
    await expect(projects.findById(created.id)).resolves.toEqual(created);
    await expect(projects.list()).resolves.toEqual([created]);

    const updated = await projects.update({
      ...created,
      name: 'Projeto fictício atualizado',
      status: 'ARCHIVED',
    });

    expect(updated).toMatchObject({
      id: created.id,
      name: 'Projeto fictício atualizado',
      status: 'ARCHIVED',
    });
  });

  it('should persist lifecycle dates and list executions by project', async () => {
    const project = await projects.create({
      name: 'Projeto de execução',
      description: 'Projeto fictício para validar datas.',
      status: 'ACTIVE',
    });
    const created = await executions.create({
      projectId: project.id,
      status: 'CREATED',
      startedAt: null,
      finishedAt: null,
    });

    const startedAt = new Date().toISOString();
    const running = await executions.update({
      ...created,
      status: 'RUNNING',
      startedAt,
    });

    expect(running.startedAt).toBe(startedAt);
    expect(running.finishedAt).toBeNull();
    await expect(executions.findById(running.id)).resolves.toEqual(running);
    await expect(executions.listByProject(project.id)).resolves.toEqual([running]);
  });

  it('should reject invalid lifecycle input before accessing the database', async () => {
    const project = await projects.create({
      name: 'Projeto inválido',
      description: 'Projeto fictício para validar erros.',
      status: 'ACTIVE',
    });

    await expect(
      executions.create({
        projectId: project.id,
        status: 'CREATED',
        startedAt: new Date().toISOString(),
        finishedAt: null,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
      statusCode: 400,
    });
  });

  it('should enforce restrictive deletion for persisted execution history', async () => {
    const project = await projects.create({
      name: 'Projeto com histórico',
      description: 'Projeto fictício que não pode ser removido.',
      status: 'ACTIVE',
    });
    await executions.create({
      projectId: project.id,
      status: 'CREATED',
      startedAt: null,
      finishedAt: null,
    });

    await expect(context.client.project.delete({ where: { id: project.id } })).rejects.toThrow();
  });

  it('should translate an update of a missing entity', async () => {
    const now = new Date().toISOString();

    await expect(
      projects.update({
        id: 'missing_project',
        name: 'Projeto inexistente',
        description: 'Dados fictícios para tradução de erro.',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.ENTITY_NOT_FOUND,
      statusCode: 404,
    });
  });

  it('should translate invalid persisted data into a non-exposed persistence error', async () => {
    const record = await context.client.project.create({
      data: {
        name: 'Projeto corrompido',
        description: 'Registro fictício criado fora do repository.',
        status: 'UNKNOWN',
      },
    });

    try {
      await projects.findById(record.id);
      expect.fail('Era esperado um erro de persistência.');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: ERROR_CODES.PERSISTENCE_ERROR,
        expose: false,
      });
    }
  });
});
