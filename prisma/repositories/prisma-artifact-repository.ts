import { artifactCreateInputSchema } from '@brq/shared/schemas/artifact.schema';
import { identifierSchema } from '@brq/shared/schemas/common.schema';
import type { Artifact, ArtifactCreateInput } from '@brq/shared/types/artifact';
import type { ArtifactRepository } from '@brq/shared/types/repositories';

import type { DatabaseClient } from '../client';
import { mapArtifact } from '../mappers';
import {
  entityNotFound,
  invalidRelation,
  parseRepositoryInput,
  runPersistenceOperation,
} from './prisma-errors';

export class PrismaArtifactRepository implements ArtifactRepository {
  constructor(private readonly client: DatabaseClient) {}

  async createNextVersion(input: ArtifactCreateInput): Promise<Artifact> {
    const validInput = parseRepositoryInput(artifactCreateInputSchema, input);

    return runPersistenceOperation(() =>
      this.client.$transaction(async (transaction) => {
        const agentExecution = await transaction.agentExecution.findUnique({
          where: { id: validInput.agentExecutionId },
          select: {
            executionId: true,
            agent: true,
            promptVersion: true,
            model: true,
          },
        });

        if (agentExecution === null) {
          throw entityNotFound('AgentExecution', validInput.agentExecutionId);
        }

        if (agentExecution.executionId !== validInput.executionId) {
          throw invalidRelation('Artifact e AgentExecution devem pertencer à mesma Execution.');
        }

        if (
          agentExecution.agent !== validInput.provenance.agent ||
          agentExecution.promptVersion !== validInput.provenance.promptVersion ||
          (agentExecution.model !== null && agentExecution.model !== validInput.provenance.model)
        ) {
          throw invalidRelation('A provenance do Artifact deve corresponder à AgentExecution.');
        }

        const latest = await transaction.artifact.findFirst({
          where: {
            executionId: validInput.executionId,
            filename: validInput.filename,
          },
          orderBy: { version: 'desc' },
          select: { version: true },
        });

        const record = await transaction.artifact.create({
          data: {
            executionId: validInput.executionId,
            agentExecutionId: validInput.agentExecutionId,
            name: validInput.name,
            filename: validInput.filename,
            type: validInput.type,
            content: validInput.content,
            version: (latest?.version ?? 0) + 1,
            provenance: validInput.provenance,
          },
        });

        return mapArtifact(record);
      }),
    );
  }

  async findById(id: string): Promise<Artifact | null> {
    const validId = parseRepositoryInput(identifierSchema, id);

    return runPersistenceOperation(async () => {
      const record = await this.client.artifact.findUnique({ where: { id: validId } });
      return record === null ? null : mapArtifact(record);
    });
  }

  async listByExecution(executionId: string): Promise<Artifact[]> {
    const validExecutionId = parseRepositoryInput(identifierSchema, executionId);

    return runPersistenceOperation(async () => {
      const records = await this.client.artifact.findMany({
        where: { executionId: validExecutionId },
        orderBy: [{ filename: 'asc' }, { version: 'asc' }],
      });
      return records.map(mapArtifact);
    });
  }
}
