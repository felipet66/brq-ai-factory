import type { FactoryExecutionResult, FactoryTechnicalResumeResult } from '@brq/factory-pipeline';
import type {
  ExecutionObservabilitySnapshot,
  FactoryExecutionObservabilitySnapshot,
} from '@brq/observability';

import type {
  ExecutionRecord,
  ExecutionRecordCreatedInput,
  ExecutionRecordInfrastructureFailureInput,
  ExecutionRecordJobRunningInput,
  ExecutionRecordJobTerminalInput,
  ExecutionRecordListQuery,
  ExecutionRecordPage,
  ExecutionRecordQueuedInput,
  ExecutionRecordRunningInput,
  FactoryExecutionRecordRepository,
  FactoryTechnicalCheckpointRecord,
  FactoryTechnicalCheckpointLookup,
  FactoryTechnicalCheckpointSaveInput,
  FactoryTechnicalResumeAttemptCompleteInput,
  FactoryTechnicalResumeAttemptCreateInput,
  FactoryTechnicalResumeAttemptFailInput,
  FactoryTechnicalResumeAttemptHeartbeatInput,
  FactoryTechnicalResumeAttemptLookup,
  FactoryTechnicalResumeAttemptReconcileInput,
  FactoryTechnicalResumeAttemptRecord,
  FactoryTechnicalResumeAttemptStageResultInput,
  FactoryTechnicalResumeReconciliation,
} from '../contracts';
import { EXECUTION_REPOSITORY_ERROR_CODES, ExecutionRepositoryError } from '../errors';
import { immutableClone } from '../immutability';
import {
  createExecutionRecord,
  createQueuedExecutionRecord,
  projectInfrastructureFailedExecutionRecord,
  projectJobRunningExecutionRecord,
  projectJobTerminalExecutionRecord,
  projectObservedExecutionRecord,
  projectRunningExecutionRecord,
  projectTerminalFactoryExecutionRecord,
  projectTerminalExecutionRecord,
} from '../mapper';
import {
  executionRecordCreatedInputSchema,
  executionRecordInfrastructureFailureInputSchema,
  executionRecordJobRunningInputSchema,
  executionRecordJobTerminalInputSchema,
  executionRecordListQuerySchema,
  executionRecordQueuedInputSchema,
  executionRecordRunningInputSchema,
} from '../schemas';
import {
  factoryTechnicalCheckpointRecordSchema,
  factoryTechnicalCheckpointSaveInputSchema,
  factoryTechnicalResumeAttemptCompleteInputSchema,
  factoryTechnicalResumeAttemptCreateInputSchema,
  factoryTechnicalResumeAttemptFailInputSchema,
  factoryTechnicalResumeAttemptHeartbeatInputSchema,
  factoryTechnicalResumeAttemptReconcileInputSchema,
  factoryTechnicalResumeAttemptRecordSchema,
  factoryTechnicalResumeAttemptStageResultInputSchema,
  factoryTechnicalResumeReconciliationSchema,
  isTechnicalResumeResultCleanupConfirmed,
} from '../technical-resume-schemas';
import type { ExecutionResult } from '@brq/execution-engine';

type InternalTechnicalResumeAttempt = FactoryTechnicalResumeAttemptRecord & {
  readonly leaseId: string | null;
  readonly leaseVersion: number;
  readonly pendingResultHash: string | null;
  readonly pendingResult: FactoryTechnicalResumeResult | null;
};

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

export function createInMemoryExecutionRecordRepository(
  options: { readonly ownerId?: string } = {},
): FactoryExecutionRecordRepository {
  const records = new Map<string, ExecutionRecord>();
  const executionIds = new Map<string, string>();
  const jobIds = new Map<string, string>();
  const ownerId = options.ownerId ?? 'in-memory-owner';
  const checkpoints = new Map<
    string,
    FactoryTechnicalCheckpointRecord & { readonly ownerId: string }
  >();
  const checkpointByExecutionId = new Map<string, string>();
  const resumeAttempts = new Map<string, InternalTechnicalResumeAttempt>();
  const activeResumeAttemptByCheckpoint = new Map<string, string>();
  let sequence = 0;

  const publicTechnicalAttempt = (
    attempt: InternalTechnicalResumeAttempt,
  ): FactoryTechnicalResumeAttemptRecord =>
    immutableClone(
      factoryTechnicalResumeAttemptRecordSchema.parse({
        attemptId: attempt.attemptId,
        checkpointHash: attempt.checkpointHash,
        ownerId: attempt.ownerId,
        requestId: attempt.requestId,
        status: attempt.status,
        activePhase: attempt.activePhase,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        heartbeatAt: attempt.heartbeatAt,
        leaseExpiresAt: attempt.leaseExpiresAt,
        completionRecordedAt: attempt.completionRecordedAt,
        result: attempt.result,
        cleanupConfirmed: attempt.cleanupConfirmed,
        failureReasonCode: attempt.failureReasonCode,
        recoveryReasonCode: attempt.recoveryReasonCode,
      }),
    );

  const preferredTechnicalAttempt = (
    attemptOwnerId: string,
    checkpointHash: string,
  ): InternalTechnicalResumeAttempt | undefined => {
    const attempts = [...resumeAttempts.values()].filter(
      (attempt) => attempt.ownerId === attemptOwnerId && attempt.checkpointHash === checkpointHash,
    );
    const newest = (candidates: readonly InternalTechnicalResumeAttempt[]) =>
      [...candidates].sort(
        (left, right) =>
          Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
          right.attemptId.localeCompare(left.attemptId),
      )[0];
    return (
      newest(attempts.filter((attempt) => attempt.status === 'RUNNING')) ??
      newest(attempts.filter((attempt) => attempt.status === 'SUCCESS')) ??
      newest(attempts)
    );
  };

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

    async failInfrastructure(
      input: ExecutionRecordInfrastructureFailureInput,
    ): Promise<ExecutionRecord> {
      const parsed = executionRecordInfrastructureFailureInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Entrada de falha infraestrutural inválida.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      const workflowId = jobIds.get(parsed.data.jobId);
      if (workflowId === undefined) throw notFound(parsed.data.jobId);
      const record = records.get(workflowId)!;
      if (
        record.status === 'FAILED' &&
        record.job?.status === 'FAILED' &&
        record.finishedAt === parsed.data.finishedAt &&
        record.job.finishedAt === parsed.data.finishedAt &&
        record.failure?.kind === 'INFRASTRUCTURE' &&
        record.failure.code === parsed.data.code
      ) {
        return immutableClone(record);
      }
      try {
        return store(projectInfrastructureFailedExecutionRecord(record, parsed.data));
      } catch (error) {
        throw conflict(
          error instanceof Error ? error.message : 'Transição infraestrutural inválida.',
        );
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
      const terminal = store(projectTerminalFactoryExecutionRecord(record, result, snapshot));
      const checkpointHash = checkpointByExecutionId.get(result.executionId);
      if (
        checkpointHash !== undefined &&
        (result.workspace.releaseStatus === 'RELEASED' ||
          result.workspace.releaseStatus === 'NOT_REQUIRED') &&
        result.sandbox.cleanupFailure === null
      ) {
        const checkpoint = checkpoints.get(checkpointHash)!;
        checkpoints.set(
          checkpointHash,
          immutableClone({
            ...checkpoint,
            cleanup: {
              factoryResultHash: result.hashes.factoryResultHash,
              releaseStatus: result.workspace.releaseStatus,
              completedAt: result.finishedAt,
            },
          }),
        );
      }
      return terminal;
    },

    async saveTechnicalCheckpoint(
      input: FactoryTechnicalCheckpointSaveInput,
    ): Promise<FactoryTechnicalCheckpointRecord> {
      const parsed = factoryTechnicalCheckpointSaveInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Checkpoint técnico inválido.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      const { checkpoint } = parsed.data;
      const workflowRecord = records.get(checkpoint.source.workflowId);
      if (
        workflowRecord === undefined ||
        (workflowRecord.executionId !== null &&
          workflowRecord.executionId !== checkpoint.source.executionId) ||
        workflowRecord.status !== 'RUNNING'
      ) {
        throw conflict('O checkpoint não pertence à execução RUNNING informada.');
      }
      const existing = checkpoints.get(checkpoint.checkpointHash);
      if (existing !== undefined) {
        return factoryTechnicalCheckpointRecordSchema.parse(existing);
      }
      if (checkpointByExecutionId.has(checkpoint.source.executionId)) {
        throw conflict('A execução já possui um checkpoint técnico imutável divergente.');
      }
      const record = immutableClone({
        checkpoint,
        createdAt: parsed.data.createdAt,
        cleanup: null,
        ownerId,
      });
      checkpoints.set(checkpoint.checkpointHash, record);
      checkpointByExecutionId.set(checkpoint.source.executionId, checkpoint.checkpointHash);
      return factoryTechnicalCheckpointRecordSchema.parse({
        checkpoint: record.checkpoint,
        createdAt: record.createdAt,
        cleanup: record.cleanup,
      });
    },

    async findTechnicalCheckpointOwned(
      lookup: FactoryTechnicalCheckpointLookup,
    ): Promise<FactoryTechnicalCheckpointRecord | null> {
      if (lookup.ownerId !== ownerId) return null;
      const checkpointHash = checkpointByExecutionId.get(lookup.sourceExecutionId);
      if (checkpointHash === undefined) return null;
      const record = checkpoints.get(checkpointHash)!;
      return immutableClone(
        factoryTechnicalCheckpointRecordSchema.parse({
          checkpoint: record.checkpoint,
          createdAt: record.createdAt,
          cleanup: record.cleanup,
        }),
      );
    },

    async createTechnicalResumeAttempt(
      input: FactoryTechnicalResumeAttemptCreateInput,
    ): Promise<FactoryTechnicalResumeAttemptRecord> {
      const parsed = factoryTechnicalResumeAttemptCreateInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Tentativa técnica inválida.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      if (parsed.data.ownerId !== ownerId) throw notFound(parsed.data.checkpointHash);
      if (resumeAttempts.has(parsed.data.attemptId)) {
        throw conflict('A tentativa técnica já existe.');
      }
      const checkpoint = checkpoints.get(parsed.data.checkpointHash);
      if (checkpoint === undefined || checkpoint.cleanup === null) {
        throw conflict('O checkpoint não possui cleanup terminal atestado.');
      }
      const source = records.get(checkpoint.checkpoint.source.workflowId);
      if (source?.status !== 'FAILED') {
        throw conflict('Somente uma execução de origem FAILED pode ser retomada.');
      }
      if (
        [...resumeAttempts.values()].some(
          (attempt) =>
            attempt.checkpointHash === parsed.data.checkpointHash &&
            (attempt.status === 'SUCCESS' ||
              (attempt.status !== 'RUNNING' && !attempt.cleanupConfirmed)),
        )
      ) {
        throw conflict('O checkpoint já possui um terminal definitivo ou cleanup pendente.');
      }
      if (activeResumeAttemptByCheckpoint.has(parsed.data.checkpointHash)) {
        throw conflict('O checkpoint já possui uma tentativa técnica em andamento.');
      }
      const publicAttempt = factoryTechnicalResumeAttemptRecordSchema.parse({
        attemptId: parsed.data.attemptId,
        checkpointHash: parsed.data.checkpointHash,
        ownerId: parsed.data.ownerId,
        requestId: parsed.data.requestId,
        status: 'RUNNING',
        activePhase: 'EXECUTING',
        startedAt: parsed.data.startedAt,
        finishedAt: null,
        heartbeatAt: parsed.data.heartbeatAt,
        leaseExpiresAt: parsed.data.leaseExpiresAt,
        completionRecordedAt: null,
        result: null,
        cleanupConfirmed: false,
        failureReasonCode: null,
        recoveryReasonCode: null,
      });
      const attempt: InternalTechnicalResumeAttempt = immutableClone({
        ...publicAttempt,
        leaseId: parsed.data.leaseId,
        leaseVersion: parsed.data.leaseVersion,
        pendingResultHash: null,
        pendingResult: null,
      });
      resumeAttempts.set(attempt.attemptId, attempt);
      activeResumeAttemptByCheckpoint.set(attempt.checkpointHash, attempt.attemptId);
      return publicTechnicalAttempt(attempt);
    },

    async renewTechnicalResumeAttemptLease(
      input: FactoryTechnicalResumeAttemptHeartbeatInput,
    ): Promise<boolean> {
      const parsed = factoryTechnicalResumeAttemptHeartbeatInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Heartbeat da tentativa técnica inválido.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      const current = resumeAttempts.get(parsed.data.attemptId);
      if (
        current === undefined ||
        current.ownerId !== ownerId ||
        current.status !== 'RUNNING' ||
        current.activePhase !== 'EXECUTING' ||
        current.leaseId !== parsed.data.leaseId ||
        current.leaseVersion !== parsed.data.leaseVersion ||
        current.leaseExpiresAt === null ||
        Date.parse(current.leaseExpiresAt) < Date.parse(parsed.data.heartbeatAt) ||
        current.heartbeatAt === null ||
        Date.parse(parsed.data.heartbeatAt) < Date.parse(current.heartbeatAt) ||
        Date.parse(parsed.data.leaseExpiresAt) < Date.parse(current.leaseExpiresAt) ||
        activeResumeAttemptByCheckpoint.get(current.checkpointHash) !== current.attemptId
      ) {
        return false;
      }
      resumeAttempts.set(
        current.attemptId,
        immutableClone({
          ...current,
          heartbeatAt: parsed.data.heartbeatAt,
          leaseExpiresAt: parsed.data.leaseExpiresAt,
        }),
      );
      return true;
    },

    async stageTechnicalResumeAttemptResult(
      input: FactoryTechnicalResumeAttemptStageResultInput,
    ): Promise<FactoryTechnicalResumeAttemptRecord> {
      const parsed = factoryTechnicalResumeAttemptStageResultInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Journal da tentativa técnica inválido.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      const current = resumeAttempts.get(parsed.data.attemptId);
      if (current === undefined || current.ownerId !== ownerId) {
        throw notFound(parsed.data.attemptId);
      }
      if (current.status !== 'RUNNING') {
        if (current.result?.resultHash === parsed.data.result.resultHash) {
          return publicTechnicalAttempt(current);
        }
        throw conflict('O resultado terminal diverge da tentativa já concluída.');
      }
      if (
        current.activePhase === 'COMPLETION_PENDING' &&
        current.pendingResultHash === parsed.data.result.resultHash
      ) {
        return publicTechnicalAttempt(current);
      }
      const persistedCheckpoint = checkpoints.get(current.checkpointHash);
      if (
        persistedCheckpoint === undefined ||
        persistedCheckpoint.ownerId !== current.ownerId ||
        current.activePhase !== 'EXECUTING' ||
        current.leaseId !== parsed.data.leaseId ||
        current.leaseVersion !== parsed.data.leaseVersion ||
        current.leaseExpiresAt === null ||
        Date.parse(current.leaseExpiresAt) < Date.parse(parsed.data.recordedAt) ||
        Date.parse(parsed.data.result.startedAt) < Date.parse(current.startedAt) ||
        Date.parse(parsed.data.result.finishedAt) < Date.parse(current.startedAt) ||
        activeResumeAttemptByCheckpoint.get(current.checkpointHash) !== current.attemptId ||
        parsed.data.result.attemptId !== current.attemptId ||
        parsed.data.result.checkpointHash !== persistedCheckpoint.checkpoint.checkpointHash ||
        parsed.data.result.sourceExecutionId !==
          persistedCheckpoint.checkpoint.source.executionId ||
        parsed.data.result.sourceWorkflowId !== persistedCheckpoint.checkpoint.source.workflowId
      ) {
        throw conflict('A tentativa técnica não aceita este journal terminal.');
      }
      const pending: InternalTechnicalResumeAttempt = immutableClone({
        ...current,
        activePhase: 'COMPLETION_PENDING' as const,
        completionRecordedAt: parsed.data.recordedAt,
        pendingResultHash: parsed.data.result.resultHash,
        pendingResult: parsed.data.result,
      });
      resumeAttempts.set(current.attemptId, pending);
      return publicTechnicalAttempt(pending);
    },

    async completeTechnicalResumeAttempt(
      input: FactoryTechnicalResumeAttemptCompleteInput,
    ): Promise<FactoryTechnicalResumeAttemptRecord> {
      const parsed = factoryTechnicalResumeAttemptCompleteInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Resultado da tentativa técnica inválido.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      const current = resumeAttempts.get(parsed.data.attemptId);
      if (current === undefined) throw notFound(parsed.data.attemptId);
      if (current.ownerId !== ownerId) throw notFound(parsed.data.attemptId);
      if (current.status !== 'RUNNING') {
        if (current.result?.resultHash === parsed.data.pendingResultHash) {
          return publicTechnicalAttempt(current);
        }
        throw conflict('TECHNICAL_TERMINAL_RESULT_DIVERGENCE');
      }
      if (
        current.activePhase !== 'COMPLETION_PENDING' ||
        current.pendingResult === null ||
        current.pendingResultHash !== parsed.data.pendingResultHash ||
        activeResumeAttemptByCheckpoint.get(current.checkpointHash) !== current.attemptId
      ) {
        throw conflict('A tentativa técnica não possui este journal terminal.');
      }
      const result = current.pendingResult;
      const publicTerminal = factoryTechnicalResumeAttemptRecordSchema.parse({
        ...publicTechnicalAttempt(current),
        status: result.status,
        activePhase: null,
        finishedAt: result.finishedAt,
        result,
        cleanupConfirmed: isTechnicalResumeResultCleanupConfirmed(result),
        failureReasonCode: result.failure?.reasonCode ?? null,
        recoveryReasonCode: null,
      });
      const terminal: InternalTechnicalResumeAttempt = immutableClone({
        ...publicTerminal,
        leaseId: null,
        leaseVersion: current.leaseVersion,
        pendingResultHash: null,
        pendingResult: null,
      });
      resumeAttempts.set(terminal.attemptId, terminal);
      activeResumeAttemptByCheckpoint.delete(terminal.checkpointHash);
      return publicTechnicalAttempt(terminal);
    },

    async failTechnicalResumeAttempt(
      input: FactoryTechnicalResumeAttemptFailInput,
    ): Promise<FactoryTechnicalResumeAttemptRecord> {
      const parsed = factoryTechnicalResumeAttemptFailInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Falha da tentativa técnica inválida.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      const current = resumeAttempts.get(parsed.data.attemptId);
      if (current === undefined) throw notFound(parsed.data.attemptId);
      if (current.ownerId !== ownerId) throw notFound(parsed.data.attemptId);
      const persistedCheckpoint = checkpoints.get(current.checkpointHash);
      if (persistedCheckpoint === undefined || persistedCheckpoint.ownerId !== current.ownerId) {
        throw conflict('A tentativa técnica não pertence ao checkpoint informado.');
      }
      if (
        current.status !== 'RUNNING' ||
        current.activePhase !== 'EXECUTING' ||
        current.leaseId !== parsed.data.leaseId ||
        current.leaseVersion !== parsed.data.leaseVersion ||
        current.leaseExpiresAt === null ||
        Date.parse(parsed.data.finishedAt) < Date.parse(current.startedAt) ||
        Date.parse(parsed.data.finishedAt) > Date.parse(current.leaseExpiresAt) ||
        activeResumeAttemptByCheckpoint.get(current.checkpointHash) !== current.attemptId
      ) {
        throw conflict('A tentativa técnica já está terminal.');
      }
      const publicTerminal = factoryTechnicalResumeAttemptRecordSchema.parse({
        ...publicTechnicalAttempt(current),
        status: 'FAILED',
        activePhase: null,
        finishedAt: parsed.data.finishedAt,
        result: null,
        cleanupConfirmed: parsed.data.cleanupConfirmed,
        failureReasonCode: parsed.data.reasonCode,
        recoveryReasonCode: null,
      });
      const terminal: InternalTechnicalResumeAttempt = immutableClone({
        ...publicTerminal,
        leaseId: null,
        leaseVersion: current.leaseVersion,
        pendingResultHash: null,
        pendingResult: null,
      });
      resumeAttempts.set(terminal.attemptId, terminal);
      activeResumeAttemptByCheckpoint.delete(terminal.checkpointHash);
      return publicTechnicalAttempt(terminal);
    },

    async findLatestTechnicalResumeAttemptOwned(
      lookup: FactoryTechnicalResumeAttemptLookup,
    ): Promise<FactoryTechnicalResumeAttemptRecord | null> {
      if (lookup.ownerId !== ownerId) return null;
      const checkpointHash = checkpointByExecutionId.get(lookup.sourceExecutionId);
      if (checkpointHash === undefined) return null;
      const latest = preferredTechnicalAttempt(lookup.ownerId, checkpointHash);
      return latest === undefined ? null : publicTechnicalAttempt(latest);
    },

    async reconcileTechnicalResumeAttemptOwned(
      input: FactoryTechnicalResumeAttemptReconcileInput,
    ): Promise<FactoryTechnicalResumeReconciliation> {
      const parsed = factoryTechnicalResumeAttemptReconcileInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ExecutionRepositoryError('Reconciliação da tentativa técnica inválida.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          cause: parsed.error,
        });
      }
      if (parsed.data.ownerId !== ownerId) {
        return factoryTechnicalResumeReconciliationSchema.parse({ outcome: 'NONE', attempt: null });
      }
      const checkpointHash = checkpointByExecutionId.get(parsed.data.sourceExecutionId);
      if (checkpointHash === undefined) {
        return factoryTechnicalResumeReconciliationSchema.parse({ outcome: 'NONE', attempt: null });
      }
      const latest = preferredTechnicalAttempt(parsed.data.ownerId, checkpointHash);
      if (latest === undefined) {
        return factoryTechnicalResumeReconciliationSchema.parse({ outcome: 'NONE', attempt: null });
      }
      if (latest.status !== 'RUNNING') {
        return factoryTechnicalResumeReconciliationSchema.parse({
          outcome: 'TERMINAL',
          attempt: publicTechnicalAttempt(latest),
        });
      }
      if (
        latest.activePhase === 'COMPLETION_PENDING' &&
        latest.pendingResultHash !== null &&
        latest.pendingResult !== null &&
        latest.pendingResult.resultHash === latest.pendingResultHash
      ) {
        const terminal = await this.completeTechnicalResumeAttempt({
          attemptId: latest.attemptId,
          pendingResultHash: latest.pendingResultHash,
        });
        return factoryTechnicalResumeReconciliationSchema.parse({
          outcome: 'FINALIZED',
          attempt: terminal,
        });
      }
      if (
        latest.activePhase === 'EXECUTING' &&
        latest.leaseExpiresAt !== null &&
        Date.parse(latest.leaseExpiresAt) > Date.parse(parsed.data.observedAt)
      ) {
        return factoryTechnicalResumeReconciliationSchema.parse({
          outcome: 'ACTIVE',
          attempt: publicTechnicalAttempt(latest),
        });
      }
      const recovery: InternalTechnicalResumeAttempt = immutableClone({
        ...latest,
        activePhase: 'RECOVERY_REQUIRED' as const,
        leaseId: null,
        recoveryReasonCode:
          latest.activePhase === 'COMPLETION_PENDING'
            ? 'TECHNICAL_COMPLETION_JOURNAL_INVALID'
            : (latest.recoveryReasonCode ?? 'TECHNICAL_ATTEMPT_LEASE_EXPIRED'),
      });
      resumeAttempts.set(recovery.attemptId, recovery);
      return factoryTechnicalResumeReconciliationSchema.parse({
        outcome: 'RECOVERY_REQUIRED',
        attempt: publicTechnicalAttempt(recovery),
      });
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
