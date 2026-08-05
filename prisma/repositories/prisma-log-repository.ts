import { identifierSchema } from '@brq/shared/schemas/common.schema';
import { logRecordCreateInputSchema } from '@brq/shared/schemas/log-record.schema';
import type { LogRecord, LogRecordCreateInput } from '@brq/shared/types/log-record';
import type { LogRepository } from '@brq/shared/types/repositories';

import type { DatabaseClient } from '../client';
import { mapLogRecord } from '../mappers';
import {
  entityNotFound,
  invalidRelation,
  parseRepositoryInput,
  runPersistenceOperation,
} from './prisma-errors';

export class PrismaLogRepository implements LogRepository {
  constructor(private readonly client: DatabaseClient) {}

  async append(input: LogRecordCreateInput): Promise<LogRecord> {
    const validInput = parseRepositoryInput(logRecordCreateInputSchema, input);

    return runPersistenceOperation(() =>
      this.client.$transaction(async (transaction) => {
        const execution = await transaction.execution.findUnique({
          where: { id: validInput.executionId },
          select: { id: true },
        });

        if (execution === null) {
          throw entityNotFound('Execution', validInput.executionId);
        }

        if (validInput.agentExecutionId !== null) {
          const agentExecution = await transaction.agentExecution.findUnique({
            where: { id: validInput.agentExecutionId },
            select: { executionId: true },
          });

          if (agentExecution === null) {
            throw entityNotFound('AgentExecution', validInput.agentExecutionId);
          }

          if (agentExecution.executionId !== validInput.executionId) {
            throw invalidRelation('Log e AgentExecution devem pertencer à mesma Execution.');
          }
        }

        if (validInput.artifactId !== null) {
          const artifact = await transaction.artifact.findUnique({
            where: { id: validInput.artifactId },
            select: { executionId: true },
          });

          if (artifact === null) {
            throw entityNotFound('Artifact', validInput.artifactId);
          }

          if (artifact.executionId !== validInput.executionId) {
            throw invalidRelation('Log e Artifact devem pertencer à mesma Execution.');
          }
        }

        const record = await transaction.log.create({ data: validInput });
        return mapLogRecord(record);
      }),
    );
  }

  async listByExecution(executionId: string): Promise<LogRecord[]> {
    const validExecutionId = parseRepositoryInput(identifierSchema, executionId);

    return runPersistenceOperation(async () => {
      const records = await this.client.log.findMany({
        where: { executionId: validExecutionId },
        orderBy: { createdAt: 'asc' },
      });
      return records.map(mapLogRecord);
    });
  }
}
