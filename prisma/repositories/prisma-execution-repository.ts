import { identifierSchema } from '@brq/shared/schemas/common.schema';
import { executionCreateInputSchema, executionSchema } from '@brq/shared/schemas/domain.schema';
import type { Execution, ExecutionCreateInput } from '@brq/shared/types/domain';
import type { ExecutionRepository } from '@brq/shared/types/repositories';

import type { DatabaseClient } from '../client';
import { mapExecution } from '../mappers';
import { parseRepositoryInput, runPersistenceOperation } from './prisma-errors';

function toNullableDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

export class PrismaExecutionRepository implements ExecutionRepository {
  constructor(private readonly client: DatabaseClient) {}

  async create(input: ExecutionCreateInput): Promise<Execution> {
    const validInput = parseRepositoryInput(executionCreateInputSchema, input);

    return runPersistenceOperation(async () => {
      const record = await this.client.execution.create({
        data: {
          projectId: validInput.projectId,
          status: validInput.status,
          startedAt: toNullableDate(validInput.startedAt),
          finishedAt: toNullableDate(validInput.finishedAt),
        },
      });
      return mapExecution(record);
    });
  }

  async findById(id: string): Promise<Execution | null> {
    const validId = parseRepositoryInput(identifierSchema, id);

    return runPersistenceOperation(async () => {
      const record = await this.client.execution.findUnique({ where: { id: validId } });
      return record === null ? null : mapExecution(record);
    });
  }

  async listByProject(projectId: string): Promise<Execution[]> {
    const validProjectId = parseRepositoryInput(identifierSchema, projectId);

    return runPersistenceOperation(async () => {
      const records = await this.client.execution.findMany({
        where: { projectId: validProjectId },
        orderBy: { createdAt: 'asc' },
      });
      return records.map(mapExecution);
    });
  }

  async update(execution: Execution): Promise<Execution> {
    const validExecution = parseRepositoryInput(executionSchema, execution);

    return runPersistenceOperation(async () => {
      const record = await this.client.execution.update({
        where: { id: validExecution.id },
        data: {
          projectId: validExecution.projectId,
          status: validExecution.status,
          startedAt: toNullableDate(validExecution.startedAt),
          finishedAt: toNullableDate(validExecution.finishedAt),
        },
      });
      return mapExecution(record);
    });
  }
}
