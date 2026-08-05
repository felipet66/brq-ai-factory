import type { ProjectRepository } from '@brq/shared/types/repositories';
import { identifierSchema } from '@brq/shared/schemas/common.schema';
import { projectCreateInputSchema, projectSchema } from '@brq/shared/schemas/domain.schema';
import type { Project, ProjectCreateInput } from '@brq/shared/types/domain';

import type { DatabaseClient } from '../client';
import { mapProject } from '../mappers';
import { parseRepositoryInput, runPersistenceOperation } from './prisma-errors';

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly client: DatabaseClient) {}

  async create(input: ProjectCreateInput): Promise<Project> {
    const validInput = parseRepositoryInput(projectCreateInputSchema, input);

    return runPersistenceOperation(async () => {
      const record = await this.client.project.create({ data: validInput });
      return mapProject(record);
    });
  }

  async findById(id: string): Promise<Project | null> {
    const validId = parseRepositoryInput(identifierSchema, id);

    return runPersistenceOperation(async () => {
      const record = await this.client.project.findUnique({ where: { id: validId } });
      return record === null ? null : mapProject(record);
    });
  }

  async list(): Promise<Project[]> {
    return runPersistenceOperation(async () => {
      const records = await this.client.project.findMany({ orderBy: { createdAt: 'asc' } });
      return records.map(mapProject);
    });
  }

  async update(project: Project): Promise<Project> {
    const validProject = parseRepositoryInput(projectSchema, project);

    return runPersistenceOperation(async () => {
      const record = await this.client.project.update({
        where: { id: validProject.id },
        data: {
          name: validProject.name,
          description: validProject.description,
          status: validProject.status,
        },
      });
      return mapProject(record);
    });
  }
}
