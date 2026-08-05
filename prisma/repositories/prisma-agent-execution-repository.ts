import { identifierSchema } from '@brq/shared/schemas/common.schema';
import {
  agentExecutionCreateInputSchema,
  agentExecutionSchema,
} from '@brq/shared/schemas/domain.schema';
import type { AgentExecution, AgentExecutionCreateInput } from '@brq/shared/types/domain';
import type { AgentExecutionRepository } from '@brq/shared/types/repositories';

import { Prisma } from '../../generated/prisma/client';
import type { DatabaseClient } from '../client';
import { mapAgentExecution } from '../mappers';
import {
  entityNotFound,
  invalidRelation,
  parseRepositoryInput,
  runPersistenceOperation,
} from './prisma-errors';

function toNullableDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function assertEnvelopeCoherence(agentExecution: AgentExecutionCreateInput | AgentExecution): void {
  if (agentExecution.input.executionId !== agentExecution.executionId) {
    throw invalidRelation('input.executionId deve corresponder à AgentExecution.');
  }

  if (agentExecution.input.agent !== agentExecution.agent) {
    throw invalidRelation('input.agent deve corresponder à AgentExecution.');
  }

  if (
    agentExecution.output !== null &&
    (agentExecution.output.metadata.agent !== agentExecution.agent ||
      agentExecution.output.metadata.promptVersion !== agentExecution.promptVersion ||
      agentExecution.output.metadata.schemaVersion !== agentExecution.schemaVersion)
  ) {
    throw invalidRelation('Os metadados do output devem corresponder à AgentExecution.');
  }
}

export class PrismaAgentExecutionRepository implements AgentExecutionRepository {
  constructor(private readonly client: DatabaseClient) {}

  async create(input: AgentExecutionCreateInput): Promise<AgentExecution> {
    const validInput = parseRepositoryInput(agentExecutionCreateInputSchema, input);
    assertEnvelopeCoherence(validInput);

    return runPersistenceOperation(async () => {
      const execution = await this.client.execution.findUnique({
        where: { id: validInput.executionId },
        select: { projectId: true },
      });

      if (execution === null) {
        throw entityNotFound('Execution', validInput.executionId);
      }

      if (execution.projectId !== validInput.input.projectId) {
        throw invalidRelation('input.projectId deve corresponder ao projeto da Execution.');
      }

      const record = await this.client.agentExecution.create({
        data: {
          executionId: validInput.executionId,
          agent: validInput.agent,
          status: validInput.status,
          attempt: validInput.attempt,
          input: validInput.input,
          output: validInput.output === null ? Prisma.DbNull : validInput.output,
          agentVersion: validInput.agentVersion,
          promptVersion: validInput.promptVersion,
          schemaVersion: validInput.schemaVersion,
          model: validInput.model,
          inputTokens: validInput.usage?.inputTokens ?? null,
          outputTokens: validInput.usage?.outputTokens ?? null,
          durationMs: validInput.durationMs,
          startedAt: toNullableDate(validInput.startedAt),
          finishedAt: toNullableDate(validInput.finishedAt),
        },
      });
      return mapAgentExecution(record);
    });
  }

  async findById(id: string): Promise<AgentExecution | null> {
    const validId = parseRepositoryInput(identifierSchema, id);

    return runPersistenceOperation(async () => {
      const record = await this.client.agentExecution.findUnique({ where: { id: validId } });
      return record === null ? null : mapAgentExecution(record);
    });
  }

  async listByExecution(executionId: string): Promise<AgentExecution[]> {
    const validExecutionId = parseRepositoryInput(identifierSchema, executionId);

    return runPersistenceOperation(async () => {
      const records = await this.client.agentExecution.findMany({
        where: { executionId: validExecutionId },
        orderBy: [{ createdAt: 'asc' }, { attempt: 'asc' }],
      });
      return records.map(mapAgentExecution);
    });
  }

  async update(agentExecution: AgentExecution): Promise<AgentExecution> {
    const validAgentExecution = parseRepositoryInput(agentExecutionSchema, agentExecution);
    assertEnvelopeCoherence(validAgentExecution);

    return runPersistenceOperation(async () => {
      const execution = await this.client.execution.findUnique({
        where: { id: validAgentExecution.executionId },
        select: { projectId: true },
      });

      if (execution === null) {
        throw entityNotFound('Execution', validAgentExecution.executionId);
      }

      if (execution.projectId !== validAgentExecution.input.projectId) {
        throw invalidRelation('input.projectId deve corresponder ao projeto da Execution.');
      }

      const record = await this.client.agentExecution.update({
        where: { id: validAgentExecution.id },
        data: {
          executionId: validAgentExecution.executionId,
          agent: validAgentExecution.agent,
          status: validAgentExecution.status,
          attempt: validAgentExecution.attempt,
          input: validAgentExecution.input,
          output: validAgentExecution.output === null ? Prisma.DbNull : validAgentExecution.output,
          agentVersion: validAgentExecution.agentVersion,
          promptVersion: validAgentExecution.promptVersion,
          schemaVersion: validAgentExecution.schemaVersion,
          model: validAgentExecution.model,
          inputTokens: validAgentExecution.usage?.inputTokens ?? null,
          outputTokens: validAgentExecution.usage?.outputTokens ?? null,
          durationMs: validAgentExecution.durationMs,
          startedAt: toNullableDate(validAgentExecution.startedAt),
          finishedAt: toNullableDate(validAgentExecution.finishedAt),
        },
      });
      return mapAgentExecution(record);
    });
  }
}
