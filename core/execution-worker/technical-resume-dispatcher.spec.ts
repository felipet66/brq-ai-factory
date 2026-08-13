import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXECUTION_REPOSITORY_ERROR_CODES,
  ExecutionRepositoryError,
} from '@brq/execution-repository';
import { FactoryTechnicalResumeError } from '@brq/factory-pipeline';

import { createTechnicalResumeDispatcher } from './technical-resume-dispatcher';

const checkpoint = {
  checkpointHash: 'a'.repeat(64),
  source: { executionId: `execution-${'1'.repeat(32)}` },
} as const;

interface ResumeOptions {
  readonly attemptId: string;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
}

vi.mock('@brq/factory-pipeline', async (importOriginal) => {
  const original = await importOriginal<typeof import('@brq/factory-pipeline')>();
  return {
    ...original,
    parseFactoryTechnicalCheckpoint: vi.fn((value: unknown) => value),
  };
});

function harness(
  cleanup: object | null = { releaseStatus: 'RELEASED' },
  timing:
    | { readonly leaseDurationMs: number; readonly heartbeatIntervalMs: number }
    | undefined = undefined,
) {
  const repository = {
    findTechnicalCheckpointOwned: vi.fn(async () => ({
      checkpoint,
      createdAt: '2026-08-13T12:00:00.000Z',
      cleanup,
    })),
    reconcileTechnicalResumeAttemptOwned: vi.fn(async () => ({
      outcome: 'NONE',
      attempt: null,
    })),
    createTechnicalResumeAttempt: vi.fn(async (input: unknown) => input),
    renewTechnicalResumeAttemptLease: vi.fn(async () => true),
    stageTechnicalResumeAttemptResult: vi.fn(async (input: unknown) => input),
    completeTechnicalResumeAttempt: vi.fn(async (input: unknown) => input),
    failTechnicalResumeAttempt: vi.fn(async (input: unknown) => input),
  };
  const executor = {
    resumeTechnical: vi.fn(async (_checkpoint: unknown, options: ResumeOptions) => ({
      attemptId: options.attemptId,
      checkpointHash: checkpoint.checkpointHash,
      sourceExecutionId: checkpoint.source.executionId,
      sourceWorkflowId: 'workflow-source',
      status: 'SUCCESS',
      resultHash: 'b'.repeat(64),
    })),
  };
  const dispatcher = createTechnicalResumeDispatcher({
    repository: repository as never,
    executor: executor as never,
    idFactory: () => '123e4567-e89b-42d3-a456-426614174000',
    now: () => 1_786_593_600_000,
    ...timing,
  });
  return { dispatcher, executor, repository };
}

describe('TechnicalResumeDispatcher', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens a new physical attempt and invokes only the technical executor', async () => {
    const { dispatcher, executor, repository } = harness();

    const accepted = await dispatcher.dispatch({
      ownerId: 'user-001',
      sourceExecutionId: checkpoint.source.executionId,
      requestId: 'request-resume-001',
    });

    expect(accepted).toEqual({
      attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174000',
      sourceExecutionId: checkpoint.source.executionId,
      checkpointHash: checkpoint.checkpointHash,
      status: 'SUCCESS',
      resultHash: 'b'.repeat(64),
      usesOpenAI: false,
    });
    expect(repository.findTechnicalCheckpointOwned).toHaveBeenCalledWith({
      ownerId: 'user-001',
      sourceExecutionId: checkpoint.source.executionId,
    });
    expect(repository.createTechnicalResumeAttempt).toHaveBeenCalledBefore(
      executor.resumeTechnical,
    );
    expect(executor.resumeTechnical).toHaveBeenCalledWith(
      checkpoint,
      expect.objectContaining({
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174000',
        requestId: 'request-resume-001',
      }),
    );
    expect(repository.completeTechnicalResumeAttempt).toHaveBeenCalledOnce();
    expect(repository.stageTechnicalResumeAttemptResult).toHaveBeenCalledBefore(
      repository.completeTechnicalResumeAttempt,
    );
    expect(repository.failTechnicalResumeAttempt).not.toHaveBeenCalled();
  });

  it('blocks before creating an attempt while source cleanup is pending', async () => {
    const { dispatcher, executor, repository } = harness(null);

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-resume-001',
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_TECHNICAL_CLEANUP_PENDING' });
    expect(repository.createTechnicalResumeAttempt).not.toHaveBeenCalled();
    expect(executor.resumeTechnical).not.toHaveBeenCalled();
  });

  it('maps a rejected single-flight claim to a deterministic conflict before execution', async () => {
    const { dispatcher, executor, repository } = harness();
    repository.createTechnicalResumeAttempt.mockRejectedValueOnce(
      new ExecutionRepositoryError('unique conflict', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
      }),
    );

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-resume-001',
      }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_TECHNICAL_ATTEMPT_CONFLICT',
      reasonCode: 'TECHNICAL_ATTEMPT_NOT_ELIGIBLE',
    });
    expect(executor.resumeTechnical).not.toHaveBeenCalled();
    expect(repository.failTechnicalResumeAttempt).not.toHaveBeenCalled();
  });

  it('persists a failed physical attempt with the deterministic drift reason', async () => {
    const { dispatcher, executor, repository } = harness();
    executor.resumeTechnical.mockRejectedValueOnce(
      new FactoryTechnicalResumeError('drift', 'CHECKPOINT_PROFILE_DRIFT'),
    );

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-resume-001',
      }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_TECHNICAL_RESUME_FAILED',
      reasonCode: 'CHECKPOINT_PROFILE_DRIFT',
    });
    expect(repository.failTechnicalResumeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: 'CHECKPOINT_PROFILE_DRIFT',
        cleanupConfirmed: true,
      }),
    );
  });

  it('does not trust a duck-typed pre-physical reason as cleanup evidence', async () => {
    const { dispatcher, executor, repository } = harness();
    executor.resumeTechnical.mockRejectedValueOnce(
      Object.assign(new Error('untrusted'), { reasonCode: 'CHECKPOINT_PROFILE_DRIFT' }),
    );

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-untrusted-reason',
      }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_TECHNICAL_RESUME_FAILED',
      reasonCode: 'TECHNICAL_RESUME_INTERNAL_ERROR',
    });
    expect(repository.failTechnicalResumeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ cleanupConfirmed: false }),
    );
  });

  it('does not confirm cleanup for a failure after physical execution started', async () => {
    const { dispatcher, executor, repository } = harness();
    executor.resumeTechnical.mockRejectedValueOnce(new Error('sandbox failed'));

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-resume-001',
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_TECHNICAL_RESUME_FAILED' });
    expect(repository.failTechnicalResumeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: 'TECHNICAL_RESUME_INTERNAL_ERROR',
        cleanupConfirmed: false,
      }),
    );
  });

  it('stops heartbeats permanently after the first lease loss', async () => {
    vi.useFakeTimers();
    try {
      const { dispatcher, executor, repository } = harness(
        { releaseStatus: 'RELEASED' },
        { leaseDurationMs: 100, heartbeatIntervalMs: 10 },
      );
      repository.renewTechnicalResumeAttemptLease.mockResolvedValueOnce(false);
      executor.resumeTechnical.mockImplementationOnce(
        async (_checkpoint: unknown, options: ResumeOptions) =>
          new Promise((_resolve, reject) => {
            if (options.signal === undefined) throw new Error('missing execution signal');
            options.signal.addEventListener('abort', () => reject(new Error('lease lost')), {
              once: true,
            });
          }),
      );

      const dispatched = dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-lease-loss',
      });
      const observedRejection = expect(dispatched).rejects.toMatchObject({
        code: 'EXECUTION_TECHNICAL_RESUME_FAILED',
      });
      await vi.advanceTimersByTimeAsync(11);
      await observedRejection;
      await vi.advanceTimersByTimeAsync(100);
      expect(repository.renewTechnicalResumeAttemptLease).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a corrupt checkpoint with a safe reason before opening an attempt', async () => {
    const factoryPipeline = await import('@brq/factory-pipeline');
    vi.mocked(factoryPipeline.parseFactoryTechnicalCheckpoint).mockImplementationOnce(() => {
      throw new Error('invalid private payload');
    });
    const { dispatcher, executor, repository } = harness();

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-resume-001',
      }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_TECHNICAL_RESUME_FAILED',
      reasonCode: 'CHECKPOINT_INVALID',
    });
    expect(repository.createTechnicalResumeAttempt).not.toHaveBeenCalled();
    expect(executor.resumeTechnical).not.toHaveBeenCalled();
  });

  it('returns a durable pending state when finalization fails after the journal was recorded', async () => {
    const { dispatcher, executor, repository } = harness();
    repository.completeTechnicalResumeAttempt.mockRejectedValueOnce(
      new Error('database unavailable after physical success'),
    );

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-resume-001',
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETION_PENDING',
      resultHash: 'b'.repeat(64),
      usesOpenAI: false,
    });
    expect(executor.resumeTechnical).toHaveResolved();
    expect(repository.stageTechnicalResumeAttemptResult).toHaveBeenCalledOnce();
    expect(repository.completeTechnicalResumeAttempt).toHaveBeenCalledOnce();
    expect(repository.failTechnicalResumeAttempt).not.toHaveBeenCalled();
  });

  it('fails closed when physical completion could not be journaled durably', async () => {
    const { dispatcher, executor, repository } = harness();
    repository.stageTechnicalResumeAttemptResult.mockRejectedValueOnce(
      new Error('database unavailable before journal commit'),
    );

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-resume-001',
      }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_TECHNICAL_COMPLETION_PENDING',
      reasonCode: 'TECHNICAL_COMPLETION_JOURNAL_PENDING',
    });
    expect(executor.resumeTechnical).toHaveResolved();
    expect(repository.completeTechnicalResumeAttempt).not.toHaveBeenCalled();
    expect(repository.failTechnicalResumeAttempt).not.toHaveBeenCalled();
  });

  it('reconciles a durable pending result without invoking the physical executor again', async () => {
    const { dispatcher, executor, repository } = harness();
    repository.reconcileTechnicalResumeAttemptOwned.mockResolvedValueOnce({
      outcome: 'FINALIZED',
      attempt: {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174099',
        checkpointHash: checkpoint.checkpointHash,
        status: 'SUCCESS',
        result: { resultHash: 'c'.repeat(64) },
      },
    } as never);

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-resume-reconcile',
      }),
    ).resolves.toMatchObject({ status: 'SUCCESS', resultHash: 'c'.repeat(64) });
    expect(executor.resumeTechnical).not.toHaveBeenCalled();
    expect(repository.createTechnicalResumeAttempt).not.toHaveBeenCalled();
  });

  it('returns an existing SUCCESS terminal idempotently without physical execution', async () => {
    const { dispatcher, executor, repository } = harness();
    repository.reconcileTechnicalResumeAttemptOwned.mockResolvedValueOnce({
      outcome: 'TERMINAL',
      attempt: {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174098',
        checkpointHash: checkpoint.checkpointHash,
        status: 'SUCCESS',
        cleanupConfirmed: true,
        result: { resultHash: 'd'.repeat(64) },
      },
    } as never);

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-existing-success',
      }),
    ).resolves.toMatchObject({ status: 'SUCCESS', resultHash: 'd'.repeat(64) });
    expect(executor.resumeTechnical).not.toHaveBeenCalled();
    expect(repository.createTechnicalResumeAttempt).not.toHaveBeenCalled();
  });

  it('blocks retry after a failed terminal whose cleanup is unconfirmed', async () => {
    const { dispatcher, executor, repository } = harness();
    repository.reconcileTechnicalResumeAttemptOwned.mockResolvedValueOnce({
      outcome: 'TERMINAL',
      attempt: {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174097',
        checkpointHash: checkpoint.checkpointHash,
        status: 'FAILED',
        cleanupConfirmed: false,
        result: null,
      },
    } as never);

    await expect(
      dispatcher.dispatch({
        ownerId: 'user-001',
        sourceExecutionId: checkpoint.source.executionId,
        requestId: 'request-terminal-cleanup-unknown',
      }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_TECHNICAL_RECOVERY_REQUIRED',
      reasonCode: 'TECHNICAL_TERMINAL_CLEANUP_RECOVERY_REQUIRED',
    });
    expect(executor.resumeTechnical).not.toHaveBeenCalled();
    expect(repository.createTechnicalResumeAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ['ACTIVE', 'EXECUTION_TECHNICAL_ATTEMPT_CONFLICT'],
    ['RECOVERY_REQUIRED', 'EXECUTION_TECHNICAL_RECOVERY_REQUIRED'],
  ] as const)(
    'does not run physical work while reconciliation reports %s',
    async (outcome, code) => {
      const { dispatcher, executor, repository } = harness();
      repository.reconcileTechnicalResumeAttemptOwned.mockResolvedValueOnce({
        outcome,
        attempt: {
          activePhase: outcome === 'ACTIVE' ? 'EXECUTING' : 'RECOVERY_REQUIRED',
          recoveryReasonCode:
            outcome === 'RECOVERY_REQUIRED' ? 'TECHNICAL_ATTEMPT_LEASE_EXPIRED' : null,
        },
      } as never);

      await expect(
        dispatcher.dispatch({
          ownerId: 'user-001',
          sourceExecutionId: checkpoint.source.executionId,
          requestId: 'request-resume-blocked',
        }),
      ).rejects.toMatchObject({ code });
      expect(executor.resumeTechnical).not.toHaveBeenCalled();
    },
  );
});
