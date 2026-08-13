import { describe, expect, it } from 'vitest';
import {
  calculateFactoryPipelineResultHash,
  factoryExecutionResultSchema,
  type FactoryExecutionResult,
  type FactoryResultHashInput,
} from '@brq/factory-pipeline';
import {
  createFactoryExecutionResultFixture,
  createFactoryTechnicalCheckpointFixture,
} from '@brq/factory-pipeline/testing';

import { createInMemoryExecutionRecordRepository } from './adapters/in-memory-execution-record-repository';
import { EXECUTION_REPOSITORY_ERROR_CODES } from './errors';
import {
  EXECUTION_JOB_FIXTURE_ID,
  EXECUTION_RECORD_FIXTURE_ID,
  createExecutionObservationFixture,
  createExecutionResultFixture,
} from './testing/execution-record-fixtures';
import { createFactoryTechnicalResumeResultFixture } from './testing/technical-resume-fixtures';
import { createFailedTechnicalResumeSourceResultFixture } from './testing/technical-resume-fixtures';

const createdInput = (workflowId: string, createdAt = '2026-08-07T12:00:00.000Z') => ({
  workflowId,
  requestId: `request-${workflowId}`,
  traceId: null,
  projectName: `Project ${workflowId}`,
  createdAt,
  metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 as const },
});

const TECHNICAL_LEASE_ID = 'technical-lease-123e4567-e89b-42d3-a456-426614174000';
const TECHNICAL_LEASE_VERSION = 1;

function technicalAttempt<T extends { readonly startedAt: string }>(input: T) {
  return {
    ...input,
    leaseId: TECHNICAL_LEASE_ID,
    leaseVersion: TECHNICAL_LEASE_VERSION,
    heartbeatAt: input.startedAt,
    leaseExpiresAt: new Date(Date.parse(input.startedAt) + 60_000).toISOString(),
  };
}

function technicalFailure<T extends object>(input: T) {
  return {
    ...input,
    leaseId: TECHNICAL_LEASE_ID,
    leaseVersion: TECHNICAL_LEASE_VERSION,
  };
}

async function prepareTechnicalResumeSource(ownerId: string) {
  const repository = createInMemoryExecutionRecordRepository({ ownerId });
  const checkpoint = createFactoryTechnicalCheckpointFixture();
  await repository.create(createdInput(checkpoint.source.workflowId));
  await repository.markRunning({
    workflowId: checkpoint.source.workflowId,
    startedAt: '2026-08-13T12:00:00.000Z',
  });
  await repository.saveTechnicalCheckpoint({
    checkpoint,
    createdAt: '2026-08-13T12:00:01.000Z',
  });
  await repository.completeFactory(
    checkpoint.source.workflowId,
    createFailedTechnicalResumeSourceResultFixture({
      executionId: checkpoint.source.executionId,
      workflowId: checkpoint.source.workflowId,
    }),
    null,
  );
  return { checkpoint, repository };
}

function factoryResultWithCleanupPending(input: {
  readonly executionId: string;
  readonly workflowId: string;
}): FactoryExecutionResult {
  const source = createFactoryExecutionResultFixture(input);
  const hashes = {
    executionHash: source.hashes.executionHash,
    workflowHash: source.hashes.workflowHash,
    generationHash: source.hashes.generationHash,
    bundleHash: source.hashes.bundleHash,
    workspacePlanHash: source.hashes.workspacePlanHash,
    workspaceHash: source.hashes.workspaceHash,
    sandboxRequestHash: source.hashes.sandboxRequestHash,
    sandboxResultHash: source.hashes.sandboxResultHash,
    lineageHash: source.hashes.lineageHash,
    provenanceHash: source.hashes.provenanceHash,
  };
  const projection: FactoryResultHashInput = {
    ...source,
    status: 'FAILED',
    terminalStage: 'SANDBOX',
    sandbox: {
      ...source.sandbox,
      status: 'FAILED',
      cleanupFailure: {
        code: 'SANDBOX_CLEANUP_FAILED',
        stage: 'CLEANUP',
        sourceCode: 'REMOVAL_NOT_CONFIRMED',
        reasonCode: null,
        diagnosticSummary: null,
        message: 'A remoção do container não pôde ser confirmada.',
      },
    },
    hashes,
    failure: {
      code: 'SANDBOX_CLEANUP_FAILED',
      stage: 'SANDBOX',
      sourceCode: null,
      reasonCode: null,
      profileRuleId: null,
      diagnosticSummary: null,
      message: 'A execução isolada não concluiu todas as verificações.',
    },
  };
  return factoryExecutionResultSchema.parse({
    ...projection,
    hashes: {
      ...hashes,
      factoryResultHash: calculateFactoryPipelineResultHash(projection),
    },
  });
}

describe('in-memory execution record repository', () => {
  it('persists queued job metadata independently and resolves it by jobId', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const queued = await repository.createQueued({
      workflowId: 'workflow-001',
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      jobId: EXECUTION_JOB_FIXTURE_ID,
      requestId: 'request-001',
      traceId: null,
      projectName: 'Queued project',
      queuedAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    const runningJob = await repository.markJobRunning({
      jobId: EXECUTION_JOB_FIXTURE_ID,
      startedAt: '2026-08-07T12:00:00.005Z',
    });
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    const completed = await repository.complete(
      'workflow-001',
      createExecutionResultFixture(),
      createExecutionObservationFixture(),
    );
    const settled = await repository.markJobTerminal({
      jobId: EXECUTION_JOB_FIXTURE_ID,
      status: 'FAILED',
      finishedAt: '2026-08-07T12:00:00.060Z',
    });

    expect(queued).toMatchObject({ status: 'CREATED', job: { status: 'QUEUED' } });
    expect(runningJob.job).toMatchObject({ status: 'RUNNING' });
    expect(completed).toMatchObject({ status: 'FAILED', job: { status: 'FAILED' } });
    expect(settled.job).toMatchObject({
      status: 'FAILED',
      finishedAt: '2026-08-07T12:00:00.060Z',
    });
    expect(await repository.findByJobId(EXECUTION_JOB_FIXTURE_ID)).toEqual(settled);
    expect(Object.isFrozen(settled.job)).toBe(true);
  });

  it('persists queued cancellation without pretending the Engine executed', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await repository.createQueued({
      workflowId: 'workflow-001',
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      jobId: EXECUTION_JOB_FIXTURE_ID,
      requestId: null,
      traceId: null,
      projectName: 'Cancelled before execution',
      queuedAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    const cancelled = await repository.markJobTerminal({
      jobId: EXECUTION_JOB_FIXTURE_ID,
      status: 'CANCELLED',
      finishedAt: '2026-08-07T12:00:00.005Z',
    });

    expect(cancelled.status).toBe('CREATED');
    expect(cancelled.startedAt).toBeNull();
    expect(cancelled.job).toMatchObject({ status: 'CANCELLED' });
    await expect(
      repository.markJobRunning({
        jobId: EXECUTION_JOB_FIXTURE_ID,
        startedAt: '2026-08-07T12:00:00.010Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });

  it('atomically and idempotently fails the active execution and job on infrastructure failure', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await repository.createQueued({
      workflowId: 'workflow-001',
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      jobId: EXECUTION_JOB_FIXTURE_ID,
      requestId: null,
      traceId: null,
      projectName: 'Infrastructure failure',
      queuedAt: '2026-08-07T12:00:00.000Z',
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    await repository.markJobRunning({
      jobId: EXECUTION_JOB_FIXTURE_ID,
      startedAt: '2026-08-07T12:00:00.005Z',
    });
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    const input = {
      jobId: EXECUTION_JOB_FIXTURE_ID,
      code: 'FACTORY_PIPELINE_TECHNICAL_CHECKPOINT_FAILED',
      finishedAt: '2026-08-07T12:00:00.050Z',
    } as const;

    const failed = await repository.failInfrastructure(input);
    const repeated = await repository.failInfrastructure(input);

    expect(failed).toMatchObject({
      status: 'FAILED',
      workflowStatus: null,
      finishedAt: input.finishedAt,
      durationMs: 40,
      job: { status: 'FAILED', finishedAt: input.finishedAt },
      failure: {
        kind: 'INFRASTRUCTURE',
        code: input.code,
        sourceCode: null,
      },
      factoryResult: null,
    });
    expect(failed.lifecycle.map((event) => event.state)).toEqual(['CREATED', 'RUNNING', 'FAILED']);
    expect(repeated).toEqual(failed);
  });

  it('persists the complete lifecycle, observation, hashes and immutable snapshots', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const created = await repository.create(createdInput('workflow-001'));
    const running = await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    const observed = await repository.saveObservation(
      'workflow-001',
      createExecutionObservationFixture(),
    );
    const completed = await repository.complete(
      'workflow-001',
      createExecutionResultFixture(),
      createExecutionObservationFixture(),
    );

    expect(created.status).toBe('CREATED');
    expect(running.status).toBe('RUNNING');
    expect(observed.executionId).toMatch(/^execution-/);
    expect(completed.status).toBe('FAILED');
    expect(completed.readiness).toBe('READY');
    expect(completed.lifecycle.map((event) => event.state)).toEqual([
      'CREATED',
      'RUNNING',
      'FAILED',
    ]);
    expect(completed.hashes.executionHash).toBe('3'.repeat(64));
    expect(completed.observation?.stages).toHaveLength(4);
    expect(Object.isFrozen(completed)).toBe(true);
    expect(Object.isFrozen(completed.observation?.stages)).toBe(true);
    expect(await repository.findByExecutionId(completed.executionId!)).toEqual(completed);
    expect(JSON.stringify(completed)).not.toContain('Allow customers');
    expect(JSON.stringify(completed)).not.toContain('additionalContext');
  });

  it('persiste o resultado metadata-safe da Factory sem conteúdo ou identidade insegura', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    const result = createFactoryExecutionResultFixture({
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      workflowId: 'workflow-001',
    });
    await repository.create(createdInput('workflow-001'));
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: result.startedAt,
    });

    const completed = await repository.completeFactory('workflow-001', result, null);
    expect(completed).toMatchObject({
      executionId: result.executionId,
      status: 'SUCCESS',
      workflowStatus: result.execution.status,
      hashes: result.execution.hashes,
      factoryResult: {
        status: 'SUCCESS',
        generationStatus: 'SUCCESS',
        sandboxStatus: 'SUCCESS',
        hashes: { factoryResultHash: result.hashes.factoryResultHash },
      },
    });
    expect(completed.factoryResult?.stages).toHaveLength(12);
    expect(completed.factoryResult?.lineage.sandboxResultHash).toBe(
      result.hashes.sandboxResultHash,
    );
    expect(Object.isFrozen(completed.factoryResult)).toBe(true);
    const serialized = JSON.stringify(completed.factoryResult);
    expect(serialized).not.toMatch(
      /"(?:imageReference|containerId|prompt|content|path|stdout|stderr)"\s*:/,
    );
    await expect(repository.completeFactory('workflow-001', result, null)).resolves.toEqual(
      completed,
    );
  });

  it('supports deterministic pagination and inclusive filters', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await repository.create(createdInput('workflow-a', '2026-08-07T10:00:00.000Z'));
    await repository.create(createdInput('workflow-b', '2026-08-07T11:00:00.000Z'));
    await repository.create(createdInput('workflow-c', '2026-08-07T12:00:00.000Z'));
    await repository.markRunning({
      workflowId: 'workflow-b',
      startedAt: '2026-08-07T11:00:01.000Z',
    });

    const first = await repository.list({ limit: 2 });
    const second = await repository.list({ limit: 2, cursor: first.nextCursor! });
    const running = await repository.list({ status: 'RUNNING' });
    const range = await repository.list({
      createdAfter: '2026-08-07T11:00:00.000Z',
      createdBefore: '2026-08-07T12:00:00.000Z',
    });

    expect(first.items.map((record) => record.workflowId)).toEqual(['workflow-c', 'workflow-b']);
    expect(second.items.map((record) => record.workflowId)).toEqual(['workflow-a']);
    expect(running.items.map((record) => record.workflowId)).toEqual(['workflow-b']);
    expect(range.items.map((record) => record.workflowId)).toEqual(['workflow-c', 'workflow-b']);
  });

  it('rejects duplicates, invalid transitions and divergent terminal writes', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await repository.create(createdInput('workflow-001'));
    await expect(repository.create(createdInput('workflow-001'))).rejects.toMatchObject({
      code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
    });
    await repository.markRunning({
      workflowId: 'workflow-001',
      startedAt: '2026-08-07T12:00:00.010Z',
    });
    await expect(
      repository.markRunning({
        workflowId: 'workflow-001',
        startedAt: '2026-08-07T12:00:00.020Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
    const result = createExecutionResultFixture();
    await repository.complete('workflow-001', result, createExecutionObservationFixture());
    await expect(
      repository.complete('workflow-001', result, createExecutionObservationFixture()),
    ).resolves.toMatchObject({ executionId: result.executionId });
    const divergent = createExecutionResultFixture({
      hashes: { ...result.hashes, executionHash: '4'.repeat(64) },
    });
    await expect(
      repository.complete('workflow-001', divergent, createExecutionObservationFixture()),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });

  it('rejects invalid filters instead of normalizing them silently', async () => {
    const repository = createInMemoryExecutionRecordRepository();
    await expect(
      repository.list({
        createdAfter: '2026-08-08T00:00:00.000Z',
        createdBefore: '2026-08-07T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT });
  });

  it('keeps the source immutable and projects the latest physical resume attempt owner-scoped', async () => {
    const ownerId = 'owner-technical-resume';
    const repository = createInMemoryExecutionRecordRepository({ ownerId });
    const checkpoint = createFactoryTechnicalCheckpointFixture();
    await repository.create(createdInput(checkpoint.source.workflowId));
    await repository.markRunning({
      workflowId: checkpoint.source.workflowId,
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    await repository.saveTechnicalCheckpoint({
      checkpoint,
      createdAt: '2026-08-13T12:00:01.000Z',
    });

    expect(
      await repository.findTechnicalCheckpointOwned({
        ownerId,
        sourceExecutionId: checkpoint.source.executionId,
      }),
    ).toMatchObject({ cleanup: null });
    await expect(
      repository.createTechnicalResumeAttempt(
        technicalAttempt({
          attemptId: 'technical-resume-pending',
          checkpointHash: checkpoint.checkpointHash,
          ownerId,
          requestId: 'request-resume-pending',
          startedAt: '2026-08-13T12:00:01.500Z',
        }),
      ),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });

    const sourceResult = createFailedTechnicalResumeSourceResultFixture({
      executionId: checkpoint.source.executionId,
      workflowId: checkpoint.source.workflowId,
    });
    await repository.completeFactory(checkpoint.source.workflowId, sourceResult, null);
    const simultaneousClaims = await Promise.allSettled([
      repository.createTechnicalResumeAttempt(
        technicalAttempt({
          attemptId: 'technical-resume-a',
          checkpointHash: checkpoint.checkpointHash,
          ownerId,
          requestId: 'request-resume-a',
          startedAt: '2026-08-13T12:00:02.000Z',
        }),
      ),
      repository.createTechnicalResumeAttempt(
        technicalAttempt({
          attemptId: 'technical-resume-concurrent',
          checkpointHash: checkpoint.checkpointHash,
          ownerId,
          requestId: 'request-resume-concurrent',
          startedAt: '2026-08-13T12:00:02.000Z',
        }),
      ),
    ]);
    expect(simultaneousClaims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
    expect(simultaneousClaims.filter((claim) => claim.status === 'rejected')).toHaveLength(1);
    expect(simultaneousClaims[1]).toMatchObject({
      status: 'rejected',
      reason: { code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT },
    });
    await repository.failTechnicalResumeAttempt(
      technicalFailure({
        attemptId: 'technical-resume-a',
        finishedAt: '2026-08-13T12:00:02.500Z',
        reasonCode: 'CHECKPOINT_PROFILE_DRIFT',
        cleanupConfirmed: true,
      }),
    );
    await repository.createTechnicalResumeAttempt(
      technicalAttempt({
        attemptId: 'technical-resume-b',
        checkpointHash: checkpoint.checkpointHash,
        ownerId,
        requestId: 'request-resume-b',
        startedAt: '2026-08-13T12:00:02.000Z',
      }),
    );

    await expect(
      repository.findLatestTechnicalResumeAttemptOwned({
        ownerId: 'another-owner',
        sourceExecutionId: checkpoint.source.executionId,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.findLatestTechnicalResumeAttemptOwned({
        ownerId,
        sourceExecutionId: checkpoint.source.executionId,
      }),
    ).resolves.toMatchObject({
      attemptId: 'technical-resume-b',
      checkpointHash: checkpoint.checkpointHash,
      status: 'RUNNING',
    });
    await expect(
      repository.findByExecutionId(checkpoint.source.executionId),
    ).resolves.toMatchObject({
      factoryResult: { hashes: { factoryResultHash: sourceResult.hashes.factoryResultHash } },
    });
  });

  it('keeps an attempt RUNNING when a terminal result diverges from its persisted checkpoint', async () => {
    const ownerId = 'owner-technical-resume';
    const repository = createInMemoryExecutionRecordRepository({ ownerId });
    const checkpoint = createFactoryTechnicalCheckpointFixture();
    const attemptId = 'technical-resume-123e4567-e89b-42d3-a456-426614174000';
    await repository.create(createdInput(checkpoint.source.workflowId));
    await repository.markRunning({
      workflowId: checkpoint.source.workflowId,
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    await repository.saveTechnicalCheckpoint({
      checkpoint,
      createdAt: '2026-08-13T12:00:01.000Z',
    });
    await repository.completeFactory(
      checkpoint.source.workflowId,
      createFailedTechnicalResumeSourceResultFixture({
        executionId: checkpoint.source.executionId,
        workflowId: checkpoint.source.workflowId,
      }),
      null,
    );
    await repository.createTechnicalResumeAttempt(
      technicalAttempt({
        attemptId,
        checkpointHash: checkpoint.checkpointHash,
        ownerId,
        requestId: 'request-technical-resume',
        startedAt: '2026-08-13T12:00:01.500Z',
      }),
    );

    const divergentResults = [
      createFactoryTechnicalResumeResultFixture({
        checkpoint,
        sourceExecutionId: `execution-${'9'.repeat(32)}`,
      }),
      createFactoryTechnicalResumeResultFixture({
        checkpoint,
        sourceWorkflowId: 'workflow-divergent-source',
      }),
      createFactoryTechnicalResumeResultFixture({
        checkpoint,
        checkpointHash: 'f'.repeat(64),
      }),
    ];
    for (const result of divergentResults) {
      await expect(
        repository.stageTechnicalResumeAttemptResult({
          attemptId,
          leaseId: TECHNICAL_LEASE_ID,
          leaseVersion: TECHNICAL_LEASE_VERSION,
          recordedAt: '2026-08-13T12:00:04.000Z',
          result,
        }),
      ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
    }
    await expect(
      repository.findLatestTechnicalResumeAttemptOwned({
        ownerId,
        sourceExecutionId: checkpoint.source.executionId,
      }),
    ).resolves.toMatchObject({ attemptId, status: 'RUNNING', result: null });

    const result = createFactoryTechnicalResumeResultFixture({ checkpoint });
    await repository.stageTechnicalResumeAttemptResult({
      attemptId,
      leaseId: TECHNICAL_LEASE_ID,
      leaseVersion: TECHNICAL_LEASE_VERSION,
      recordedAt: '2026-08-13T12:00:04.000Z',
      result,
    });
    const terminalClaims = await Promise.allSettled([
      repository.completeTechnicalResumeAttempt({
        attemptId,
        pendingResultHash: result.resultHash,
      }),
      repository.failTechnicalResumeAttempt(
        technicalFailure({
          attemptId,
          finishedAt: result.finishedAt,
          reasonCode: 'TECHNICAL_RESUME_INTERNAL_ERROR',
          cleanupConfirmed: false,
        }),
      ),
    ]);
    expect(terminalClaims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
    expect(terminalClaims.filter((claim) => claim.status === 'rejected')).toHaveLength(1);
    await expect(
      repository.findLatestTechnicalResumeAttemptOwned({
        ownerId,
        sourceExecutionId: checkpoint.source.executionId,
      }),
    ).resolves.toMatchObject({ attemptId, status: 'SUCCESS', result });
  });

  it('reconciles a durable journal without rerunning and makes SUCCESS definitive', async () => {
    const ownerId = 'owner-journal-reconciliation';
    const { checkpoint, repository } = await prepareTechnicalResumeSource(ownerId);
    const attemptId = 'technical-resume-123e4567-e89b-42d3-a456-426614174000';
    const result = createFactoryTechnicalResumeResultFixture({ checkpoint, attemptId });
    await repository.createTechnicalResumeAttempt(
      technicalAttempt({
        attemptId,
        checkpointHash: checkpoint.checkpointHash,
        ownerId,
        requestId: 'request-journal-reconciliation',
        startedAt: '2026-08-13T12:00:01.500Z',
      }),
    );
    await repository.stageTechnicalResumeAttemptResult({
      attemptId,
      leaseId: TECHNICAL_LEASE_ID,
      leaseVersion: TECHNICAL_LEASE_VERSION,
      recordedAt: '2026-08-13T12:00:03.000Z',
      result,
    });

    await expect(
      repository.reconcileTechnicalResumeAttemptOwned({
        ownerId,
        sourceExecutionId: checkpoint.source.executionId,
        observedAt: '2026-08-13T12:00:04.000Z',
      }),
    ).resolves.toMatchObject({ outcome: 'FINALIZED', attempt: { status: 'SUCCESS', result } });
    await expect(
      repository.completeTechnicalResumeAttempt({
        attemptId,
        pendingResultHash: result.resultHash,
      }),
    ).resolves.toMatchObject({ status: 'SUCCESS', result });
    await expect(
      repository.createTechnicalResumeAttempt(
        technicalAttempt({
          attemptId: 'technical-resume-after-success',
          checkpointHash: checkpoint.checkpointHash,
          ownerId,
          requestId: 'request-after-success',
          startedAt: '2026-08-13T11:00:00.000Z',
        }),
      ),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });

  it('never unlocks an expired lease and rejects non-monotonic heartbeats', async () => {
    const ownerId = 'owner-expired-lease';
    const { checkpoint, repository } = await prepareTechnicalResumeSource(ownerId);
    const attemptId = 'technical-resume-expired-lease';
    await repository.createTechnicalResumeAttempt(
      technicalAttempt({
        attemptId,
        checkpointHash: checkpoint.checkpointHash,
        ownerId,
        requestId: 'request-expired-lease',
        startedAt: '2026-08-13T12:00:01.500Z',
      }),
    );
    await expect(
      repository.renewTechnicalResumeAttemptLease({
        attemptId,
        leaseId: TECHNICAL_LEASE_ID,
        leaseVersion: TECHNICAL_LEASE_VERSION,
        heartbeatAt: '2026-08-13T12:00:01.400Z',
        leaseExpiresAt: '2026-08-13T12:02:00.000Z',
      }),
    ).resolves.toBe(false);
    await expect(
      repository.renewTechnicalResumeAttemptLease({
        attemptId,
        leaseId: TECHNICAL_LEASE_ID,
        leaseVersion: TECHNICAL_LEASE_VERSION,
        heartbeatAt: '2026-08-13T12:00:02.000Z',
        leaseExpiresAt: '2026-08-13T12:00:30.000Z',
      }),
    ).resolves.toBe(false);
    await expect(
      repository.reconcileTechnicalResumeAttemptOwned({
        ownerId,
        sourceExecutionId: checkpoint.source.executionId,
        observedAt: '2026-08-13T12:02:00.000Z',
      }),
    ).resolves.toMatchObject({
      outcome: 'RECOVERY_REQUIRED',
      attempt: {
        attemptId,
        activePhase: 'RECOVERY_REQUIRED',
        recoveryReasonCode: 'TECHNICAL_ATTEMPT_LEASE_EXPIRED',
      },
    });
    await expect(
      repository.createTechnicalResumeAttempt(
        technicalAttempt({
          attemptId: 'technical-resume-after-expiry',
          checkpointHash: checkpoint.checkpointHash,
          ownerId,
          requestId: 'request-after-expiry',
          startedAt: '2026-08-13T12:02:01.000Z',
        }),
      ),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });

  it('rejects technical resume when the checkpoint source did not finish as FAILED', async () => {
    const ownerId = 'owner-success-source';
    const repository = createInMemoryExecutionRecordRepository({ ownerId });
    const checkpoint = createFactoryTechnicalCheckpointFixture();
    await repository.create(createdInput(checkpoint.source.workflowId));
    await repository.markRunning({
      workflowId: checkpoint.source.workflowId,
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    await repository.saveTechnicalCheckpoint({
      checkpoint,
      createdAt: '2026-08-13T12:00:01.000Z',
    });
    await repository.completeFactory(
      checkpoint.source.workflowId,
      createFactoryExecutionResultFixture({
        executionId: checkpoint.source.executionId,
        workflowId: checkpoint.source.workflowId,
      }),
      null,
    );

    await expect(
      repository.createTechnicalResumeAttempt(
        technicalAttempt({
          attemptId: 'technical-resume-success-source',
          checkpointHash: checkpoint.checkpointHash,
          ownerId,
          requestId: 'request-success-source',
          startedAt: '2026-08-13T12:00:02.000Z',
        }),
      ),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });

  it('blocks a new attempt after a terminal result without confirmed cleanup', async () => {
    const ownerId = 'owner-unconfirmed-cleanup';
    const repository = createInMemoryExecutionRecordRepository({ ownerId });
    const checkpoint = createFactoryTechnicalCheckpointFixture();
    const attemptId = 'technical-resume-unconfirmed-cleanup';
    await repository.create(createdInput(checkpoint.source.workflowId));
    await repository.markRunning({
      workflowId: checkpoint.source.workflowId,
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    await repository.saveTechnicalCheckpoint({
      checkpoint,
      createdAt: '2026-08-13T12:00:01.000Z',
    });
    await repository.completeFactory(
      checkpoint.source.workflowId,
      createFailedTechnicalResumeSourceResultFixture({
        executionId: checkpoint.source.executionId,
        workflowId: checkpoint.source.workflowId,
      }),
      null,
    );
    await repository.createTechnicalResumeAttempt(
      technicalAttempt({
        attemptId,
        checkpointHash: checkpoint.checkpointHash,
        ownerId,
        requestId: 'request-unconfirmed-cleanup',
        startedAt: '2026-08-13T12:00:02.000Z',
      }),
    );
    await repository.failTechnicalResumeAttempt(
      technicalFailure({
        attemptId,
        finishedAt: '2026-08-13T12:00:03.000Z',
        reasonCode: 'TECHNICAL_RESUME_INTERNAL_ERROR',
        cleanupConfirmed: false,
      }),
    );

    await expect(
      repository.createTechnicalResumeAttempt(
        technicalAttempt({
          attemptId: 'technical-resume-blocked-by-cleanup',
          checkpointHash: checkpoint.checkpointHash,
          ownerId,
          requestId: 'request-blocked-by-cleanup',
          startedAt: '2026-08-13T12:00:04.000Z',
        }),
      ),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });

  it('keeps checkpoint cleanup pending when Sandbox container absence was not confirmed', async () => {
    const ownerId = 'owner-cleanup-pending';
    const repository = createInMemoryExecutionRecordRepository({ ownerId });
    const checkpoint = createFactoryTechnicalCheckpointFixture();
    await repository.create(createdInput(checkpoint.source.workflowId));
    await repository.markRunning({
      workflowId: checkpoint.source.workflowId,
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    await repository.saveTechnicalCheckpoint({
      checkpoint,
      createdAt: '2026-08-13T12:00:01.000Z',
    });
    const sourceResult = factoryResultWithCleanupPending({
      executionId: checkpoint.source.executionId,
      workflowId: checkpoint.source.workflowId,
    });

    const completed = await repository.completeFactory(
      checkpoint.source.workflowId,
      sourceResult,
      null,
    );

    expect(completed).toMatchObject({
      status: 'FAILED',
      failure: { code: 'SANDBOX_CLEANUP_FAILED' },
      factoryResult: {
        terminalStage: 'SANDBOX',
        workspaceReleaseStatus: 'RELEASED',
        sandboxCleanupFailureCode: 'SANDBOX_CLEANUP_FAILED',
        sandboxCleanupSourceCode: 'REMOVAL_NOT_CONFIRMED',
      },
    });
    await expect(
      repository.findTechnicalCheckpointOwned({
        ownerId,
        sourceExecutionId: checkpoint.source.executionId,
      }),
    ).resolves.toMatchObject({ cleanup: null });
    await expect(
      repository.createTechnicalResumeAttempt(
        technicalAttempt({
          attemptId: 'technical-resume-cleanup-pending',
          checkpointHash: checkpoint.checkpointHash,
          ownerId,
          requestId: 'request-resume-cleanup-pending',
          startedAt: '2026-08-13T12:00:02.000Z',
        }),
      ),
    ).rejects.toMatchObject({ code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT });
  });
});
