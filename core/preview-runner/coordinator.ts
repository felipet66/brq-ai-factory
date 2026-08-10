import { createLogger } from '@brq/shared/logger/logger';

import type {
  CreatePreviewSessionCoordinatorOptions,
  PreviewFailure,
  PreviewRunnerOptions,
  PreviewRuntimeInspection,
  PreviewRuntimeResult,
  PreviewSession,
  PreviewSessionCoordinator,
  PreviewSessionCoordinatorStartOptions,
  PreviewStartRequest,
  PreviewStopResult,
} from './contracts';
import {
  PREVIEW_RUNNER_ERROR_CODES,
  PREVIEW_RUNNER_ERROR_STAGES,
  PreviewRunnerError,
  type PreviewRunnerErrorCode,
  type PreviewRunnerErrorStage,
} from './errors';
import { isPreviewTerminalStatus } from './lifecycle';
import { logPreviewEvent, previewSessionLogContext } from './logging';
import {
  createPreviewSessionEvent,
  resolvePreviewStart,
  transitionPreviewSession,
} from './session';
import {
  previewRuntimeInspectionSchema,
  previewRuntimeResultSchema,
  previewStopResultSchema,
} from './schemas';

function validDependencies(options: CreatePreviewSessionCoordinatorOptions): boolean {
  return (
    typeof options.runner?.start === 'function' &&
    typeof options.runner?.inspect === 'function' &&
    typeof options.runner?.stop === 'function' &&
    typeof options.store?.createOrGet === 'function' &&
    typeof options.store?.getByPreviewId === 'function' &&
    typeof options.store?.getByExecutionId === 'function' &&
    typeof options.store?.replace === 'function' &&
    typeof options.store?.listEvents === 'function' &&
    Array.isArray(options.policies) &&
    (options.now === undefined || typeof options.now === 'function')
  );
}

function sanitizeSourceCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/gu, '_')
    .slice(0, 128);
  return sanitized.length === 0 ? null : sanitized;
}

function classifyFailure(error: unknown): PreviewFailure {
  if (error instanceof PreviewRunnerError) {
    return {
      code: error.code,
      stage: error.stage,
      sourceCode: sanitizeSourceCode(error.sourceCode),
      message: 'A sessão de Preview não pôde concluir esta etapa.',
    };
  }
  const candidate = error as { code?: unknown; stage?: unknown } | null;
  const code =
    typeof candidate?.code === 'string' &&
    Object.values(PREVIEW_RUNNER_ERROR_CODES).includes(candidate.code as PreviewRunnerErrorCode)
      ? (candidate.code as PreviewRunnerErrorCode)
      : PREVIEW_RUNNER_ERROR_CODES.INTERNAL_ERROR;
  const stage =
    typeof candidate?.stage === 'string' &&
    Object.values(PREVIEW_RUNNER_ERROR_STAGES).includes(candidate.stage as PreviewRunnerErrorStage)
      ? (candidate.stage as PreviewRunnerErrorStage)
      : PREVIEW_RUNNER_ERROR_STAGES.START;
  return {
    code,
    stage,
    sourceCode: sanitizeSourceCode(candidate?.code),
    message: 'A sessão de Preview não pôde concluir esta etapa.',
  };
}

function cancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return error instanceof PreviewRunnerError && error.code === PREVIEW_RUNNER_ERROR_CODES.CANCELLED;
}

function assertRunnerCorrelation(
  result: Pick<PreviewRuntimeInspection | PreviewStopResult, 'previewId' | 'executionId'>,
  session: PreviewSession,
  stage: PreviewRunnerErrorStage,
): void {
  if (result.previewId !== session.previewId || result.executionId !== session.executionId) {
    throw new PreviewRunnerError('O Preview Runner retornou correlação divergente.', {
      code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_INTEGRITY_MISMATCH,
      stage,
      previewId: session.previewId,
      sourceCode: 'RUNTIME_CORRELATION_MISMATCH',
    });
  }
}

export function createPreviewSessionCoordinator(
  options: CreatePreviewSessionCoordinatorOptions,
): PreviewSessionCoordinator {
  if (!validDependencies(options)) {
    throw new PreviewRunnerError('A configuração do PreviewSessionCoordinator é inválida.', {
      code: PREVIEW_RUNNER_ERROR_CODES.CONFIGURATION_INVALID,
      stage: PREVIEW_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  const logger = options.logger ?? createLogger();
  const observe = options.now ?? (() => performance.timeOrigin + performance.now());
  const startOperations = new Map<string, Promise<PreviewSession>>();
  const stopOperations = new Map<string, Promise<PreviewSession>>();
  let lastObservedAt = 0;

  const timestamp = (): string => {
    const observed = observe();
    if (!Number.isFinite(observed) || observed < 0) {
      throw new PreviewRunnerError('A fonte temporal do Preview Runner é inválida.', {
        code: PREVIEW_RUNNER_ERROR_CODES.INTERNAL_ERROR,
        stage: PREVIEW_RUNNER_ERROR_STAGES.CONFIGURATION,
      });
    }
    lastObservedAt = Math.max(lastObservedAt, Math.round(observed));
    return new Date(lastObservedAt).toISOString();
  };

  const persistTransition = async (
    previous: PreviewSession,
    next: PreviewSession,
    eventName: Parameters<typeof createPreviewSessionEvent>[1],
    observedAt: string,
  ): Promise<PreviewSession> => {
    const event = createPreviewSessionEvent(next, eventName, observedAt);
    const stored = await options.store.replace(previous.revision, next, event);
    logPreviewEvent(
      logger,
      next.status === 'FAILED' ? 'error' : 'info',
      eventName,
      previewSessionLogContext(stored),
    );
    return stored;
  };

  const stopLifecycle = async (
    initial: PreviewSession,
    reason: 'MANUAL' | 'EXPIRATION' | 'CANCELLATION' | 'RECONCILIATION',
    runnerOptions: PreviewRunnerOptions = {},
  ): Promise<PreviewSession> => {
    if (isPreviewTerminalStatus(initial.status)) return initial;
    let current = initial;
    if (current.status !== 'STOPPING') {
      const stoppingAt = timestamp();
      const stopping = transitionPreviewSession({
        session: current,
        status: 'STOPPING',
        observedAt: stoppingAt,
      });
      current = await persistTransition(current, stopping, 'preview.stopping', stoppingAt);
    }
    try {
      const result = previewStopResultSchema.parse(
        await options.runner.stop(
          { previewId: current.previewId, executionId: current.executionId, reason },
          runnerOptions,
        ),
      );
      assertRunnerCorrelation(result, current, PREVIEW_RUNNER_ERROR_STAGES.CLEANUP);
      const stoppedAt = timestamp();
      const terminalStatus = reason === 'EXPIRATION' ? 'EXPIRED' : 'STOPPED';
      const terminal = transitionPreviewSession({
        session: current,
        status: terminalStatus,
        observedAt: stoppedAt,
      });
      return persistTransition(
        current,
        terminal,
        terminalStatus === 'EXPIRED' ? 'preview.expired' : 'preview.stopped',
        stoppedAt,
      );
    } catch (error) {
      const failedAt = timestamp();
      const failure = classifyFailure(error);
      const failed = transitionPreviewSession({
        session: current,
        status: 'FAILED',
        observedAt: failedAt,
        failure: {
          ...failure,
          code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.CLEANUP,
        },
      });
      return persistTransition(current, failed, 'preview.failed', failedAt);
    }
  };

  const stopOnce = (
    session: PreviewSession,
    reason: 'MANUAL' | 'EXPIRATION' | 'CANCELLATION' | 'RECONCILIATION',
    runnerOptions: PreviewRunnerOptions = {},
  ): Promise<PreviewSession> => {
    const pending = stopOperations.get(session.previewId);
    if (pending !== undefined) return pending;
    const operation = stopLifecycle(session, reason, runnerOptions).finally(() => {
      stopOperations.delete(session.previewId);
    });
    stopOperations.set(session.previewId, operation);
    return operation;
  };

  const failAfterReconciliationCleanup = async (
    initial: PreviewSession,
    primaryFailure: PreviewFailure,
  ): Promise<PreviewSession> => {
    let current = initial;
    if (current.status !== 'STOPPING') {
      const stoppingAt = timestamp();
      const stopping = transitionPreviewSession({
        session: current,
        status: 'STOPPING',
        observedAt: stoppingAt,
      });
      current = await persistTransition(current, stopping, 'preview.stopping', stoppingAt);
    }
    let failure = primaryFailure;
    try {
      const result = previewStopResultSchema.parse(
        await options.runner.stop(
          {
            previewId: current.previewId,
            executionId: current.executionId,
            reason: 'RECONCILIATION',
          },
          {},
        ),
      );
      assertRunnerCorrelation(result, current, PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION);
    } catch (error) {
      failure = {
        ...classifyFailure(error),
        code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
        stage: PREVIEW_RUNNER_ERROR_STAGES.CLEANUP,
      };
    }
    const failedAt = timestamp();
    const failed = transitionPreviewSession({
      session: current,
      status: 'FAILED',
      observedAt: failedAt,
      failure,
    });
    return persistTransition(current, failed, 'preview.failed', failedAt);
  };

  return {
    async start(
      rawRequest: PreviewStartRequest,
      startOptions: PreviewSessionCoordinatorStartOptions = {},
    ): Promise<PreviewSession> {
      const resolved = resolvePreviewStart({
        request: rawRequest,
        policies: options.policies,
        observedAt: timestamp(),
      });
      const pending = startOperations.get(resolved.session.previewId);
      if (pending !== undefined) return pending;
      const operation = (async (): Promise<PreviewSession> => {
        const requestedEvent = createPreviewSessionEvent(
          resolved.session,
          'preview.requested',
          resolved.session.createdAt,
        );
        const creation = await options.store.createOrGet(resolved.session, requestedEvent);
        if (!creation.created) return creation.session;
        logPreviewEvent(
          logger,
          'info',
          'preview.requested',
          previewSessionLogContext(creation.session),
        );
        const startingAt = timestamp();
        let current = await persistTransition(
          creation.session,
          transitionPreviewSession({
            session: creation.session,
            status: 'STARTING',
            observedAt: startingAt,
          }),
          'preview.starting',
          startingAt,
        );
        let runtimeReturned = false;
        try {
          const rawRuntime = await options.runner.start(
            resolved.request,
            startOptions.signal === undefined ? {} : { signal: startOptions.signal },
          );
          runtimeReturned = true;
          const runtime = previewRuntimeResultSchema.parse(rawRuntime) as PreviewRuntimeResult;
          if (
            runtime.previewId !== current.previewId ||
            runtime.executionId !== current.executionId ||
            runtime.expiresAt !== current.expiresAt
          ) {
            throw new PreviewRunnerError('O runtime retornou correlação divergente.', {
              code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_INTEGRITY_MISMATCH,
              stage: PREVIEW_RUNNER_ERROR_STAGES.START,
              previewId: current.previewId,
            });
          }
          const running = transitionPreviewSession({
            session: current,
            status: 'RUNNING',
            observedAt: runtime.startedAt,
            runtime: runtime.runtime,
          });
          return await persistTransition(current, running, 'preview.running', runtime.startedAt);
        } catch (error) {
          if (cancellation(error, startOptions.signal)) {
            return stopOnce(current, 'CANCELLATION');
          }
          let failureError = error;
          if (runtimeReturned) {
            try {
              const cleanupResult = previewStopResultSchema.parse(
                await options.runner.stop(
                  {
                    previewId: current.previewId,
                    executionId: current.executionId,
                    reason: 'RECONCILIATION',
                  },
                  {},
                ),
              );
              assertRunnerCorrelation(cleanupResult, current, PREVIEW_RUNNER_ERROR_STAGES.CLEANUP);
            } catch (cleanupError) {
              failureError = new PreviewRunnerError(
                'O runtime iniciado após uma falha de persistência não pôde ser removido.',
                {
                  code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
                  stage: PREVIEW_RUNNER_ERROR_STAGES.CLEANUP,
                  previewId: current.previewId,
                  sourceCode: 'START_FAILURE_CLEANUP_FAILED',
                  cause: new AggregateError(
                    [error, cleanupError],
                    'Falha primária e falha de cleanup do Preview.',
                  ),
                },
              );
            }
          }
          const failedAt = timestamp();
          const failed = transitionPreviewSession({
            session: current,
            status: 'FAILED',
            observedAt: failedAt,
            failure: classifyFailure(failureError),
          });
          try {
            current = await persistTransition(current, failed, 'preview.failed', failedAt);
          } catch {
            throw failureError;
          }
          return current;
        }
      })().finally(() => {
        startOperations.delete(resolved.session.previewId);
      });
      startOperations.set(resolved.session.previewId, operation);
      return operation;
    },

    getByPreviewId(previewId) {
      return options.store.getByPreviewId(previewId);
    },

    getByExecutionId(executionId) {
      return options.store.getByExecutionId(executionId);
    },

    async stop(previewId, runnerOptions = {}) {
      const session = await options.store.getByPreviewId(previewId);
      if (session === null) {
        throw new PreviewRunnerError('A PreviewSession não foi encontrada.', {
          code: PREVIEW_RUNNER_ERROR_CODES.NOT_FOUND,
          stage: PREVIEW_RUNNER_ERROR_STAGES.STOP,
          previewId,
        });
      }
      return stopOnce(session, 'MANUAL', runnerOptions);
    },

    async expire(previewId) {
      const session = await options.store.getByPreviewId(previewId);
      if (session === null) {
        throw new PreviewRunnerError('A PreviewSession não foi encontrada.', {
          code: PREVIEW_RUNNER_ERROR_CODES.NOT_FOUND,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          previewId,
        });
      }
      if (Date.parse(timestamp()) < Date.parse(session.expiresAt)) {
        throw new PreviewRunnerError('A PreviewSession ainda não expirou.', {
          code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          previewId,
        });
      }
      return stopOnce(session, 'EXPIRATION');
    },

    async reconcile(previewId) {
      const session = await options.store.getByPreviewId(previewId);
      if (session === null) {
        throw new PreviewRunnerError('A PreviewSession não foi encontrada.', {
          code: PREVIEW_RUNNER_ERROR_CODES.NOT_FOUND,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          previewId,
        });
      }
      if (
        Date.parse(timestamp()) >= Date.parse(session.expiresAt) &&
        !isPreviewTerminalStatus(session.status)
      ) {
        return stopOnce(session, 'EXPIRATION');
      }
      if (isPreviewTerminalStatus(session.status)) {
        try {
          await options.runner.stop(
            {
              previewId: session.previewId,
              executionId: session.executionId,
              reason: 'RECONCILIATION',
            },
            {},
          );
        } catch {
          // A terminal session remains authoritative; orphan cleanup is best effort here.
        }
        return session;
      }
      const inspection = previewRuntimeInspectionSchema.parse(
        await options.runner.inspect({
          previewId: session.previewId,
          executionId: session.executionId,
        }),
      );
      if (
        inspection.previewId !== session.previewId ||
        inspection.executionId !== session.executionId
      ) {
        return failAfterReconciliationCleanup(session, {
          code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_INTEGRITY_MISMATCH,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          sourceCode: 'RUNTIME_CORRELATION_MISMATCH',
          message: 'O runtime observado não corresponde à PreviewSession.',
        });
      }
      if (inspection.status === 'RUNNING') {
        if (session.status === 'RUNNING') return session;
        const running = transitionPreviewSession({
          session,
          status: 'RUNNING',
          observedAt: inspection.observedAt,
          runtime: inspection.runtime,
        });
        return persistTransition(session, running, 'preview.running', inspection.observedAt);
      }
      return failAfterReconciliationCleanup(session, {
        code: PREVIEW_RUNNER_ERROR_CODES.RUNTIME_LOST,
        stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
        sourceCode: null,
        message: 'O runtime da sessão de Preview não está mais disponível.',
      });
    },
  };
}
