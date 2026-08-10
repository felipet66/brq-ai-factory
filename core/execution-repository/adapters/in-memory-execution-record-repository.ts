import type { FactoryExecutionResult } from '@brq/factory-pipeline';
import type {
  ExecutionObservabilitySnapshot,
  FactoryExecutionObservabilitySnapshot,
} from '@brq/observability';

import type {
  ExecutionRecord,
  ExecutionRecordCreatedInput,
  ExecutionRecordJobRunningInput,
  ExecutionRecordJobTerminalInput,
  ExecutionRecordListQuery,
  ExecutionRecordPage,
  ExecutionRecordQueuedInput,
  ExecutionRecordRunningInput,
  FactoryExecutionRecordRepository,
} from '../contracts';
import { EXECUTION_REPOSITORY_ERROR_CODES, ExecutionRepositoryError } from '../errors';
import { immutableClone } from '../immutability';
import {
  createExecutionRecord,
  createQueuedExecutionRecord,
  projectJobRunningExecutionRecord,
  projectJobTerminalExecutionRecord,
  projectObservedExecutionRecord,
  projectRunningExecutionRecord,
  projectTerminalFactoryExecutionRecord,
  projectTerminalExecutionRecord,
} from '../mapper';
import {
  executionRecordCreatedInputSchema,
  executionRecordJobRunningInputSchema,
  executionRecordJobTerminalInputSchema,
  executionRecordListQuerySchema,
  executionRecordQueuedInputSchema,
  executionRecordRunningInputSchema,
} from '../schemas';
import type { ExecutionResult } from '@brq/execution-engine';

function notFound(workflowId: string): ExecutionRepositoryError {
  return new ExecutionRepositoryError(`Registro de execução não encontrado: ${workflowId}.`, {
    code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
  });
}

function conflict(message: string): ExecutionRepositoryError {
  return new ExecutionRepositoryError(message, {
    code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
  });
}

function parseCreated(input: ExecutionRecordCreatedInput) {
  const parsed = executionRecordCreatedInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ExecutionRepositoryError('Entrada de criação do registro inválida.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function parseRunning(input: ExecutionRecordRunningInput) {
  const parsed = executionRecordRunningInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ExecutionRepositoryError('Entrada de execução em andamento inválida.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function createInMemoryExecutionRecordRepository(): FactoryExecutionRecordRepository {
  const records = new Map<string, ExecutionRecord>();
  const executionIds = new Map<string, string>();
  const jobIds = new Map<string, string>();
  let sequence = 0;

  const store = (record: ExecutionRecord): ExecutionRecord => {
    const previous = records.get(record.workflowId);
    if (
      record.executionId !== null &&
      executionIds.has(record.executionId) &&
      executionIds.get(record.executionId) !== record.workflowId
    ) {
      throw conflict('O executionId já pertence a outro workflow.');
    }
    if (previous?.executionId !== null && previous?.executionId !== undefined) {
      executionIds.delete(previous.executionId);
    }
    if (previous?.job !== null && previous?.job !== undefined) {
      jobIds.delete(previous.job.jobId);
    }
    const immutable = immutableClone(record);
    records.set(record.workflowId, immutable);
    if (record.executionId !== null) executionIds.set(record.executionId, record.workflowId);
    if (record.job !== null) jobIds.set(record.job.jobId, record.workflowId);
    return immutableClone(immutable);
  };

  return Object.freeze({
    async create(input: ExecutionRecordCreatedInput): Promise<ExecutionRecord> {
      const validInput = parseCreated(input);
      if (records.has(validInput.workflowId)) {
        throw conflict('Já existe um registro para o workflow informado.');
      }
      sequence += 1;
      return store(
        createExecutionRecord(`execution-record-${String(sequence).padStart(6, '0')}`, validInput),
      );
    },

    async createQueued(input: ExecutionRecordQueuedInput): Promise<ExecutionRecord> {
      const parsed = executionRecordQueuedInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Entrada de enfileiramento inválida.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      if (
        records.has(parsed.data.workflowId) ||
        executionIds.has(parsed.data.executionId) ||
        jobIds.has(parsed.data.jobId)
      ) {
        throw conflict('Já existe um registro para o job, workflow ou execução informado.');
      }
      sequence += 1;
      return store(
        createQueuedExecutionRecord(
          `execution-record-${String(sequence).padStart(6, '0')}`,
          parsed.data,
        ),
      );
    },

    async markJobRunning(input: ExecutionRecordJobRunningInput): Promise<ExecutionRecord> {
      const parsed = executionRecordJobRunningInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Entrada de início do job inválida.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      const workflowId = jobIds.get(parsed.data.jobId);
      if (workflowId === undefined) throw notFound(parsed.data.jobId);
      const record = records.get(workflowId)!;
      try {
        return store(projectJobRunningExecutionRecord(record, parsed.data));
      } catch (error) {
        throw conflict(error instanceof Error ? error.message : 'Transição de job inválida.');
      }
    },

    async markJobTerminal(input: ExecutionRecordJobTerminalInput): Promise<ExecutionRecord> {
      const parsed = executionRecordJobTerminalInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Entrada terminal do job inválida.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      const workflowId = jobIds.get(parsed.data.jobId);
      if (workflowId === undefined) throw notFound(parsed.data.jobId);
      const record = records.get(workflowId)!;
      if (
        record.job?.status === parsed.data.status &&
        record.job.finishedAt === parsed.data.finishedAt
      ) {
        return immutableClone(record);
      }
      try {
        return store(projectJobTerminalExecutionRecord(record, parsed.data));
      } catch (error) {
        throw conflict(error instanceof Error ? error.message : 'Transição de job inválida.');
      }
    },

    async markRunning(input: ExecutionRecordRunningInput): Promise<ExecutionRecord> {
      const validInput = parseRunning(input);
      const record = records.get(validInput.workflowId);
      if (record === undefined) throw notFound(validInput.workflowId);
      if (record.status !== 'CREATED') {
        throw conflict('Somente um registro CREATED pode transicionar para RUNNING.');
      }
      return store(projectRunningExecutionRecord(record, validInput.startedAt));
    },

    async saveObservation(
      workflowId: string,
      snapshot: ExecutionObservabilitySnapshot,
    ): Promise<ExecutionRecord> {
      const record = records.get(workflowId);
      if (record === undefined) throw notFound(workflowId);
      if (
        record.status === 'SUCCESS' ||
        record.status === 'FAILED' ||
        record.status === 'CANCELLED'
      ) {
        return immutableClone(record);
      }
      return store(projectObservedExecutionRecord(record, snapshot));
    },

    async complete(
      workflowId: string,
      result: ExecutionResult,
      snapshot: ExecutionObservabilitySnapshot | null,
    ): Promise<ExecutionRecord> {
      const record = records.get(workflowId);
      if (record === undefined) throw notFound(workflowId);
      if (
        record.status === 'SUCCESS' ||
        record.status === 'FAILED' ||
        record.status === 'CANCELLED'
      ) {
        if (
          record.executionId === result.executionId &&
          record.hashes.executionHash === result.hashes.executionHash
        ) {
          return immutableClone(record);
        }
        throw conflict('O registro já possui um resultado terminal divergente.');
      }
      return store(projectTerminalExecutionRecord(record, result, snapshot));
    },

    async completeFactory(
      workflowId: string,
      result: FactoryExecutionResult,
      snapshot: FactoryExecutionObservabilitySnapshot | null,
    ): Promise<ExecutionRecord> {
      const record = records.get(workflowId);
      if (record === undefined) throw notFound(workflowId);
      if (
        record.status === 'SUCCESS' ||
        record.status === 'FAILED' ||
        record.status === 'CANCELLED'
      ) {
        if (
          record.executionId === result.executionId &&
          record.factoryResult?.hashes.factoryResultHash === result.hashes.factoryResultHash
        ) {
          return immutableClone(record);
        }
        throw conflict('O registro já possui um resultado terminal da Factory divergente.');
      }
      return store(projectTerminalFactoryExecutionRecord(record, result, snapshot));
    },

    async findByExecutionId(executionId: string): Promise<ExecutionRecord | null> {
      const workflowId = executionIds.get(executionId);
      return workflowId === undefined ? null : immutableClone(records.get(workflowId)!);
    },

    async findByJobId(jobId: string): Promise<ExecutionRecord | null> {
      const workflowId = jobIds.get(jobId);
      return workflowId === undefined ? null : immutableClone(records.get(workflowId)!);
    },

    async findByWorkflowId(workflowId: string): Promise<ExecutionRecord | null> {
      const record = records.get(workflowId);
      return record === undefined ? null : immutableClone(record);
    },

    async list(rawQuery: ExecutionRecordListQuery = {}): Promise<ExecutionRecordPage> {
      const parsed = executionRecordListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Filtros de execução inválidos.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      const query = parsed.data;
      const ordered = [...records.values()]
        .filter((record) => query.status === undefined || record.status === query.status)
        .filter((record) => query.readiness === undefined || record.readiness === query.readiness)
        .filter(
          (record) =>
            query.createdAfter === undefined ||
            Date.parse(record.createdAt) >= Date.parse(query.createdAfter),
        )
        .filter(
          (record) =>
            query.createdBefore === undefined ||
            Date.parse(record.createdAt) <= Date.parse(query.createdBefore),
        )
        .sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
            right.workflowId.localeCompare(left.workflowId),
        );
      const cursorIndex =
        query.cursor === undefined
          ? -1
          : ordered.findIndex((record) => record.workflowId === query.cursor);
      const offset = cursorIndex < 0 ? 0 : cursorIndex + 1;
      const page = ordered.slice(offset, offset + query.limit + 1);
      const hasMore = page.length > query.limit;
      const items = page.slice(0, query.limit);
      return immutableClone({
        items,
        nextCursor: hasMore ? items.at(-1)!.workflowId : null,
      });
    },
  });
}
