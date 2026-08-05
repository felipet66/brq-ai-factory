import { createHash } from 'node:crypto';

import {
  agentNameSchema,
  identifierSchema,
  semanticVersionSchema,
} from '@brq/shared/schemas/common.schema';
import {
  promptVersionCreateInputSchema,
  promptVersionStatusSchema,
} from '@brq/shared/schemas/prompt-version.schema';
import type {
  PromptVersion,
  PromptVersionCreateInput,
  PromptVersionStatus,
} from '@brq/shared/types/prompt-version';
import type { PromptVersionRepository } from '@brq/shared/types/repositories';

import type { DatabaseClient } from '../client';
import { mapPromptVersion } from '../mappers';
import { parseRepositoryInput, runPersistenceOperation } from './prisma-errors';

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export class PrismaPromptVersionRepository implements PromptVersionRepository {
  constructor(private readonly client: DatabaseClient) {}

  async create(input: PromptVersionCreateInput): Promise<PromptVersion> {
    const validInput = parseRepositoryInput(promptVersionCreateInputSchema, input);

    return runPersistenceOperation(async () => {
      const record = await this.client.promptVersion.create({
        data: {
          ...validInput,
          hash: hashContent(validInput.content),
        },
      });
      return mapPromptVersion(record);
    });
  }

  async findById(id: string): Promise<PromptVersion | null> {
    const validId = parseRepositoryInput(identifierSchema, id);

    return runPersistenceOperation(async () => {
      const record = await this.client.promptVersion.findUnique({ where: { id: validId } });
      return record === null ? null : mapPromptVersion(record);
    });
  }

  async findByAgentVersion(agent: string, version: string): Promise<PromptVersion | null> {
    const validAgent = parseRepositoryInput(agentNameSchema, agent);
    const validVersion = parseRepositoryInput(semanticVersionSchema, version);

    return runPersistenceOperation(async () => {
      const record = await this.client.promptVersion.findUnique({
        where: {
          agent_version: {
            agent: validAgent,
            version: validVersion,
          },
        },
      });
      return record === null ? null : mapPromptVersion(record);
    });
  }

  async listByAgent(agent: string): Promise<PromptVersion[]> {
    const validAgent = parseRepositoryInput(agentNameSchema, agent);

    return runPersistenceOperation(async () => {
      const records = await this.client.promptVersion.findMany({
        where: { agent: validAgent },
        orderBy: { createdAt: 'asc' },
      });
      return records.map(mapPromptVersion);
    });
  }

  async updateStatus(id: string, status: PromptVersionStatus): Promise<PromptVersion> {
    const validId = parseRepositoryInput(identifierSchema, id);
    const validStatus = parseRepositoryInput(promptVersionStatusSchema, status);

    return runPersistenceOperation(async () => {
      const record = await this.client.promptVersion.update({
        where: { id: validId },
        data: { status: validStatus },
      });
      return mapPromptVersion(record);
    });
  }
}
