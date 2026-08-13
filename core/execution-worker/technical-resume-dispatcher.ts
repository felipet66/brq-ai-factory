import {
  FactoryTechnicalResumeError,
  parseFactoryTechnicalCheckpoint,
} from '@brq/factory-pipeline';
import {
  EXECUTION_REPOSITORY_ERROR_CODES,
  ExecutionRepositoryError,
  isTechnicalResumePrePhysicalFailure,
  type FactoryTechnicalResumeAttemptRecord,
} from '@brq/execution-repository';

import type {
  CreateTechnicalResumeDispatcherOptions,
  TechnicalResumeDispatchInput,
  TechnicalResumeDispatchResult,
  TechnicalResumeDispatcher,
} from './contracts';
import { EXECUTION_WORKER_ERROR_CODES, ExecutionWorkerError } from './errors';

const EXECUTION_ID_PATTERN = /^execution-[a-f0-9]{32}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{1,127}$/u;
const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const LEASE_VERSION = 1;

function currentTime(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value)) {
    throw new ExecutionWorkerError('Fonte temporal do resume técnico inválida.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CLOCK,
    });
  }
  return Math.max(0, Math.round(value));
}

function isoAt(value: number): string {
  return new Date(value).toISOString();
}

function failureReason(error: unknown): string {
  if (error instanceof FactoryTechnicalResumeError) return error.reasonCode;
  if (error !== null && typeof error === 'object' && 'reasonCode' in error) {
    const reasonCode = (error as { readonly reasonCode?: unknown }).reasonCode;
    if (
      typeof reasonCode === 'string' &&
      SAFE_REASON_CODE.test(reasonCode) &&
      !isTechnicalResumePrePhysicalFailure(reasonCode)
    ) {
      return reasonCode;
    }
  }
  return 'TECHNICAL_RESUME_INTERNAL_ERROR';
}

function terminalDispatchResult(
  sourceExecutionId: string,
  attempt: FactoryTechnicalResumeAttemptRecord,
): TechnicalResumeDispatchResult | null {
  if (attempt.status === 'RUNNING' || attempt.result === null) return null;
  return Object.freeze({
    attemptId: attempt.attemptId,
    sourceExecutionId,
    checkpointHash: attempt.checkpointHash,
    status: attempt.status,
    resultHash: attempt.result.resultHash,
    usesOpenAI: false as const,
  });
}

function validateDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ExecutionWorkerError(`${label} do resume técnico inválido.`, {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
  return value;
}

export function createTechnicalResumeDispatcher(
  options: CreateTechnicalResumeDispatcherOptions,
): TechnicalResumeDispatcher {
  if (
    typeof options.repository?.findTechnicalCheckpointOwned !== 'function' ||
    typeof options.repository?.reconcileTechnicalResumeAttemptOwned !== 'function' ||
    typeof options.repository?.createTechnicalResumeAttempt !== 'function' ||
    typeof options.repository?.renewTechnicalResumeAttemptLease !== 'function' ||
    typeof options.repository?.stageTechnicalResumeAttemptResult !== 'function' ||
    typeof options.repository?.completeTechnicalResumeAttempt !== 'function' ||
    typeof options.repository?.failTechnicalResumeAttempt !== 'function' ||
    typeof options.executor?.resumeTechnical !== 'function' ||
    (options.idFactory !== undefined && typeof options.idFactory !== 'function') ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new ExecutionWorkerError('Configuração do resume técnico inválida.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
  const idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? Date.now;
  const leaseDurationMs = validateDuration(
    options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
    'Deadline da lease',
  );
  const heartbeatIntervalMs = validateDuration(
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    'Intervalo de heartbeat',
  );
  if (heartbeatIntervalMs >= leaseDurationMs) {
    throw new ExecutionWorkerError('O heartbeat deve ocorrer antes da expiração da lease.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }

  return Object.freeze({
    async dispatch(input: TechnicalResumeDispatchInput) {
      if (
        typeof input.ownerId !== 'string' ||
        input.ownerId.trim().length === 0 ||
        !EXECUTION_ID_PATTERN.test(input.sourceExecutionId) ||
        typeof input.requestId !== 'string' ||
        input.requestId.trim().length === 0
      ) {
        throw new ExecutionWorkerError('Entrada do resume técnico inválida.', {
          code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
        });
      }
      const record = await options.repository.findTechnicalCheckpointOwned({
        ownerId: input.ownerId,
        sourceExecutionId: input.sourceExecutionId,
      });
      if (record === null) {
        throw new ExecutionWorkerError('Checkpoint técnico não encontrado.', {
          code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_CHECKPOINT_NOT_FOUND,
        });
      }
      if (record.cleanup === null) {
        throw new ExecutionWorkerError(
          'O cleanup da execução de origem ainda não possui atestado terminal.',
          { code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_CLEANUP_PENDING },
        );
      }
      let checkpoint;
      try {
        checkpoint = parseFactoryTechnicalCheckpoint(record.checkpoint);
      } catch (error) {
        throw new ExecutionWorkerError('O checkpoint técnico persistido é inválido.', {
          code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RESUME_FAILED,
          reasonCode: 'CHECKPOINT_INVALID',
          cause: error,
        });
      }

      const reconciled = await options.repository.reconcileTechnicalResumeAttemptOwned({
        ownerId: input.ownerId,
        sourceExecutionId: input.sourceExecutionId,
        observedAt: isoAt(currentTime(now)),
      });
      if (reconciled.outcome === 'FINALIZED' && reconciled.attempt !== null) {
        const terminal = terminalDispatchResult(input.sourceExecutionId, reconciled.attempt);
        if (terminal !== null) return terminal;
        throw new ExecutionWorkerError('O journal técnico não produziu um terminal íntegro.', {
          code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_COMPLETION_PENDING,
          reasonCode: 'TECHNICAL_COMPLETION_RECONCILIATION_PENDING',
        });
      }
      if (reconciled.outcome === 'TERMINAL' && reconciled.attempt !== null) {
        if (reconciled.attempt.status === 'SUCCESS') {
          const terminal = terminalDispatchResult(input.sourceExecutionId, reconciled.attempt);
          if (terminal !== null) return terminal;
          throw new ExecutionWorkerError('A tentativa SUCCESS persistida está incompleta.', {
            code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RECOVERY_REQUIRED,
            reasonCode: 'TECHNICAL_TERMINAL_RESULT_INVALID',
          });
        }
        if (!reconciled.attempt.cleanupConfirmed) {
          throw new ExecutionWorkerError('A tentativa terminal não confirmou o cleanup.', {
            code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RECOVERY_REQUIRED,
            reasonCode: 'TECHNICAL_TERMINAL_CLEANUP_RECOVERY_REQUIRED',
          });
        }
      }
      if (reconciled.outcome === 'ACTIVE') {
        throw new ExecutionWorkerError('Uma tentativa técnica permanece ativa.', {
          code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_ATTEMPT_CONFLICT,
          reasonCode: 'TECHNICAL_ATTEMPT_ACTIVE',
        });
      }
      if (reconciled.outcome === 'RECOVERY_REQUIRED') {
        throw new ExecutionWorkerError('A tentativa técnica exige recuperação explícita.', {
          code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RECOVERY_REQUIRED,
          reasonCode:
            reconciled.attempt?.recoveryReasonCode ?? 'TECHNICAL_ATTEMPT_RECOVERY_REQUIRED',
        });
      }

      const technicalId = idFactory();
      const leaseToken = idFactory();
      if (!UUID_PATTERN.test(technicalId) || !UUID_PATTERN.test(leaseToken)) {
        throw new ExecutionWorkerError('O gerador de tentativas técnicas é inválido.', {
          code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
        });
      }
      const attemptId = `technical-resume-${technicalId}`;
      const leaseId = `technical-lease-${leaseToken}`;
      const startedAtMs = currentTime(now);
      try {
        await options.repository.createTechnicalResumeAttempt({
          attemptId,
          checkpointHash: checkpoint.checkpointHash,
          ownerId: input.ownerId,
          requestId: input.requestId,
          startedAt: isoAt(startedAtMs),
          leaseId,
          leaseVersion: LEASE_VERSION,
          heartbeatAt: isoAt(startedAtMs),
          leaseExpiresAt: isoAt(startedAtMs + leaseDurationMs),
        });
      } catch (error) {
        if (
          !(error instanceof ExecutionRepositoryError) ||
          error.code !== EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT
        ) {
          throw error;
        }
        throw new ExecutionWorkerError('Uma tentativa técnica não pôde ser aberta.', {
          code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_ATTEMPT_CONFLICT,
          reasonCode: 'TECHNICAL_ATTEMPT_NOT_ELIGIBLE',
          cause: error,
        });
      }

      const leaseController = new AbortController();
      const executionSignal =
        input.signal === undefined
          ? leaseController.signal
          : AbortSignal.any([input.signal, leaseController.signal]);
      let heartbeatInFlight: Promise<void> | null = null;
      let heartbeatStopped = false;
      const loseLease = (reason: string): void => {
        heartbeatStopped = true;
        clearInterval(timer);
        if (!leaseController.signal.aborted) leaseController.abort(reason);
      };
      const heartbeat = (): void => {
        if (heartbeatStopped || heartbeatInFlight !== null) return;
        let heartbeatAtMs: number;
        try {
          heartbeatAtMs = currentTime(now);
        } catch {
          loseLease('TECHNICAL_ATTEMPT_CLOCK_FAILED');
          return;
        }
        heartbeatInFlight = options.repository
          .renewTechnicalResumeAttemptLease({
            attemptId,
            leaseId,
            leaseVersion: LEASE_VERSION,
            heartbeatAt: isoAt(heartbeatAtMs),
            leaseExpiresAt: isoAt(heartbeatAtMs + leaseDurationMs),
          })
          .then((renewed) => {
            if (!renewed) loseLease('TECHNICAL_ATTEMPT_LEASE_LOST');
          })
          .catch(() => {
            loseLease('TECHNICAL_ATTEMPT_HEARTBEAT_FAILED');
          })
          .finally(() => {
            heartbeatInFlight = null;
          });
      };
      const timer = setInterval(heartbeat, heartbeatIntervalMs);
      timer.unref?.();
      const stopHeartbeat = async (): Promise<void> => {
        heartbeatStopped = true;
        clearInterval(timer);
        await heartbeatInFlight;
      };

      let result: Awaited<ReturnType<typeof options.executor.resumeTechnical>>;
      try {
        result = await options.executor.resumeTechnical(checkpoint, {
          attemptId,
          requestId: input.requestId,
          signal: executionSignal,
        });
      } catch (error) {
        await stopHeartbeat();
        const reasonCode = failureReason(error);
        const prePhysicalFailure = error instanceof FactoryTechnicalResumeError;
        try {
          await options.repository.failTechnicalResumeAttempt({
            attemptId,
            leaseId,
            leaseVersion: LEASE_VERSION,
            finishedAt: isoAt(currentTime(now)),
            reasonCode,
            cleanupConfirmed: prePhysicalFailure && isTechnicalResumePrePhysicalFailure(reasonCode),
          });
        } catch (persistenceError) {
          throw new ExecutionWorkerError('A tentativa técnica exige reconciliação após falhar.', {
            code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RECOVERY_REQUIRED,
            reasonCode: 'TECHNICAL_FAILURE_PERSISTENCE_RECOVERY_REQUIRED',
            cause: persistenceError,
          });
        }
        throw new ExecutionWorkerError(
          'O resume técnico foi rejeitado antes de concluir workspace e sandbox.',
          {
            code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RESUME_FAILED,
            reasonCode,
            cause: error,
          },
        );
      }
      await stopHeartbeat();

      try {
        await options.repository.stageTechnicalResumeAttemptResult({
          attemptId,
          leaseId,
          leaseVersion: LEASE_VERSION,
          recordedAt: isoAt(currentTime(now)),
          result,
        });
      } catch (error) {
        throw new ExecutionWorkerError(
          'A execução física terminou, mas seu journal durável ainda não foi confirmado.',
          {
            code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_COMPLETION_PENDING,
            reasonCode: 'TECHNICAL_COMPLETION_JOURNAL_PENDING',
            cause: error,
          },
        );
      }
      try {
        await options.repository.completeTechnicalResumeAttempt({
          attemptId,
          pendingResultHash: result.resultHash,
        });
      } catch {
        return Object.freeze({
          attemptId,
          sourceExecutionId: input.sourceExecutionId,
          checkpointHash: checkpoint.checkpointHash,
          status: 'COMPLETION_PENDING' as const,
          resultHash: result.resultHash,
          usesOpenAI: false as const,
        });
      }
      return Object.freeze({
        attemptId,
        sourceExecutionId: input.sourceExecutionId,
        checkpointHash: checkpoint.checkpointHash,
        status: result.status,
        resultHash: result.resultHash,
        usesOpenAI: false as const,
      });
    },
  });
}
