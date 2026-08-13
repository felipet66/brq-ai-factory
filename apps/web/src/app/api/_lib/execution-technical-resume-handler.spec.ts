// @vitest-environment node

import {
  EXECUTION_WORKER_ERROR_CODES,
  ExecutionWorkerError,
  type TechnicalResumeDispatcher,
} from '@brq/execution-worker';
import type { FactoryExecutionRecordRepository } from '@brq/execution-repository';
import { describe, expect, it, vi } from 'vitest';

import {
  AUTHENTICATED_PRINCIPAL,
  EXECUTION_ID,
  FIXED_REQUEST_ID,
  authenticateRequestFixture,
  capturedLogger,
} from '@/test/api-fixtures';

import { createExecutionTechnicalResumeHandler } from './execution-technical-resume-handler';

const RESULT = Object.freeze({
  attemptId: 'technical-resume-4fbd475c-ced4-47ed-aad5-82a772ea75cd',
  sourceExecutionId: EXECUTION_ID,
  checkpointHash: '1'.repeat(64),
  status: 'SUCCESS' as const,
  resultHash: '2'.repeat(64),
  usesOpenAI: false as const,
});

const PENDING_RESULT = Object.freeze({
  ...RESULT,
  status: 'COMPLETION_PENDING' as const,
});

function request(init: RequestInit = {}): Request {
  return new Request(`http://localhost/api/executions/${EXECUTION_ID}/technical-resume`, {
    method: 'POST',
    headers: { origin: 'http://localhost', ...init.headers },
    ...init,
  });
}

function route(dispatch: TechnicalResumeDispatcher['dispatch'], now: () => number = () => 10) {
  const dispatcher = { dispatch: vi.fn(dispatch) };
  const reconcileTechnicalResumeAttemptOwned = vi.fn<
    FactoryExecutionRecordRepository['reconcileTechnicalResumeAttemptOwned']
  >(async () => ({ outcome: 'NONE', attempt: null }));
  const findTechnicalCheckpointOwned = vi.fn<
    FactoryExecutionRecordRepository['findTechnicalCheckpointOwned']
  >(async () => ({ cleanup: { releaseStatus: 'RELEASED' } }) as never);
  const findByExecutionId = vi.fn<FactoryExecutionRecordRepository['findByExecutionId']>(
    async () => null,
  );
  const repository = {
    findByExecutionId,
    reconcileTechnicalResumeAttemptOwned,
    findTechnicalCheckpointOwned,
  } as unknown as FactoryExecutionRecordRepository;
  return {
    dispatcher,
    findByExecutionId,
    reconcileTechnicalResumeAttemptOwned,
    findTechnicalCheckpointOwned,
    handler: createExecutionTechnicalResumeHandler({
      authenticate: authenticateRequestFixture,
      expectedOrigin: 'http://localhost',
      getDispatcher: async () => dispatcher,
      getRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
      now,
    }),
  };
}

describe('execution technical resume HTTP adapter', () => {
  it('returns a separate audited attempt with explicit zero-OpenAI evidence', async () => {
    const fixture = route(async () => RESULT);
    const response = await fixture.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fixture.dispatcher.dispatch).toHaveBeenCalledWith({
      ownerId: AUTHENTICATED_PRINCIPAL.userId,
      sourceExecutionId: EXECUTION_ID,
      requestId: FIXED_REQUEST_ID,
      signal: expect.any(AbortSignal),
    });
    expect(body).toMatchObject({
      success: true,
      data: { ...RESULT, usesOpenAI: false },
      metadata: { executionId: EXECUTION_ID },
    });
  });

  it('accepts a durably journaled completion as pending without starting another attempt', async () => {
    const fixture = route(async () => PENDING_RESULT as never);
    const response = await fixture.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { ...PENDING_RESULT, usesOpenAI: false },
    });
    expect(fixture.dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });

  it('maps profile drift to a deterministic public reason code', async () => {
    const fixture = route(async () => {
      throw new ExecutionWorkerError('drift', {
        code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RESUME_FAILED,
        reasonCode: 'CHECKPOINT_PROFILE_DRIFT',
      });
    });
    const response = await fixture.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      errors: [{ code: 'EXECUTION_TECHNICAL_PROFILE_DRIFT' }],
    });
  });

  it('maps an ineligible or concurrent attempt claim to a safe public conflict', async () => {
    const fixture = route(async () => {
      throw new ExecutionWorkerError('conflict', {
        code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_ATTEMPT_CONFLICT,
        reasonCode: 'TECHNICAL_ATTEMPT_NOT_ELIGIBLE',
      });
    });
    const response = await fixture.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      errors: [{ code: 'EXECUTION_TECHNICAL_ATTEMPT_CONFLICT' }],
    });
  });

  it('maps workspace drift and runtime preflight failure without hiding the real cause', async () => {
    const workspaceDrift = route(async () => {
      throw new ExecutionWorkerError('drift', {
        code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RESUME_FAILED,
        reasonCode: 'CHECKPOINT_WORKSPACE_DRIFT',
      });
    });
    const driftResponse = await workspaceDrift.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });
    expect(driftResponse.status).toBe(409);
    await expect(driftResponse.json()).resolves.toMatchObject({
      errors: [{ code: 'EXECUTION_TECHNICAL_WORKSPACE_DRIFT' }],
    });

    const unavailable = route(async () => {
      throw new ExecutionWorkerError('preflight', {
        code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RESUME_FAILED,
        reasonCode: 'RUNTIME_PREFLIGHT_FAILED',
      });
    });
    const unavailableResponse = await unavailable.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });
    expect(unavailableResponse.status).toBe(503);
    await expect(unavailableResponse.json()).resolves.toMatchObject({
      errors: [{ code: 'EXECUTION_TECHNICAL_RUNTIME_UNAVAILABLE' }],
    });

    const cleanupUnknown = route(async () => {
      throw new ExecutionWorkerError('preflight cleanup unknown', {
        code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_RESUME_FAILED,
        reasonCode: 'RUNTIME_PREFLIGHT_CLEANUP_UNCONFIRMED',
      });
    });
    const cleanupUnknownResponse = await cleanupUnknown.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });
    expect(cleanupUnknownResponse.status).toBe(503);
    await expect(cleanupUnknownResponse.json()).resolves.toMatchObject({
      errors: [{ code: 'EXECUTION_TECHNICAL_RUNTIME_UNAVAILABLE' }],
    });
  });

  it('exposes physically completed but unconfirmed persistence as a distinct safe error', async () => {
    const fixture = route(async () => {
      throw new ExecutionWorkerError('pending', {
        code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_COMPLETION_PENDING,
        reasonCode: 'TECHNICAL_COMPLETION_PERSISTENCE_PENDING',
      });
    });
    const response = await fixture.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      errors: [{ code: 'EXECUTION_TECHNICAL_COMPLETION_PENDING' }],
    });
  });

  it('blocks an attempt that requires safe recovery with a distinct public conflict', async () => {
    const fixture = route(async () => {
      throw new ExecutionWorkerError('recovery', {
        code: 'EXECUTION_TECHNICAL_RECOVERY_REQUIRED' as never,
        reasonCode: 'TECHNICAL_LEASE_EXPIRED',
      });
    });
    const response = await fixture.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      errors: [{ code: 'EXECUTION_TECHNICAL_RECOVERY_REQUIRED' }],
    });
  });

  it('reads the latest owner-scoped attempt without exposing its request or owner', async () => {
    const fixture = route(async () => RESULT);
    fixture.reconcileTechnicalResumeAttemptOwned.mockResolvedValueOnce({
      outcome: 'TERMINAL',
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        ownerId: AUTHENTICATED_PRINCIPAL.userId,
        requestId: 'request-internal-attempt',
        status: 'SUCCESS',
        activePhase: null,
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: '2026-08-13T10:00:10.000Z',
        heartbeatAt: '2026-08-13T10:00:05.000Z',
        leaseExpiresAt: '2026-08-13T10:01:05.000Z',
        completionRecordedAt: '2026-08-13T10:00:09.000Z',
        result: {
          attemptId: RESULT.attemptId,
          checkpointHash: RESULT.checkpointHash,
          resultHash: RESULT.resultHash,
        } as never,
        cleanupConfirmed: true,
        failureReasonCode: null,
        recoveryReasonCode: null,
      },
    });
    const response = await fixture.handler(request({ method: 'GET' }), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fixture.reconcileTechnicalResumeAttemptOwned).toHaveBeenCalledWith({
      ownerId: AUTHENTICATED_PRINCIPAL.userId,
      sourceExecutionId: EXECUTION_ID,
      observedAt: '1970-01-01T00:00:00.010Z',
    });
    expect(body.data.attempt).toMatchObject({
      attemptId: RESULT.attemptId,
      status: 'SUCCESS',
      activePhase: null,
      resultHash: RESULT.resultHash,
      cleanupConfirmed: true,
      usesOpenAI: false,
    });
    expect(body.data.checkpointStatus).toBe('AVAILABLE');
    expect(JSON.stringify(body)).not.toContain(AUTHENTICATED_PRINCIPAL.userId);
    expect(JSON.stringify(body)).not.toContain('request-internal-attempt');
    expect(body.data.attempt).not.toHaveProperty('heartbeatAt');
    expect(body.data.attempt).not.toHaveProperty('leaseExpiresAt');
    expect(body.data.attempt).not.toHaveProperty('completionRecordedAt');
  });

  it('projects only the safe recovery phase and reason from an active attempt', async () => {
    const fixture = route(async () => RESULT);
    fixture.reconcileTechnicalResumeAttemptOwned.mockResolvedValueOnce({
      outcome: 'RECOVERY_REQUIRED',
      attempt: {
        attemptId: RESULT.attemptId,
        checkpointHash: RESULT.checkpointHash,
        ownerId: AUTHENTICATED_PRINCIPAL.userId,
        requestId: 'request-private-recovery',
        status: 'RUNNING',
        activePhase: 'RECOVERY_REQUIRED',
        startedAt: '2026-08-13T10:00:00.000Z',
        finishedAt: null,
        heartbeatAt: '2026-08-13T10:00:05.000Z',
        leaseExpiresAt: '2026-08-13T10:01:05.000Z',
        completionRecordedAt: null,
        result: null,
        cleanupConfirmed: false,
        failureReasonCode: null,
        recoveryReasonCode: 'TECHNICAL_LEASE_EXPIRED',
      },
    });

    const response = await fixture.handler(request({ method: 'GET' }), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.attempt).toMatchObject({
      status: 'RUNNING',
      activePhase: 'RECOVERY_REQUIRED',
      reasonCode: 'TECHNICAL_LEASE_EXPIRED',
      usesOpenAI: false,
    });
    expect(body.data.attempt).not.toHaveProperty('heartbeatAt');
    expect(body.data.attempt).not.toHaveProperty('leaseExpiresAt');
    expect(body.data.attempt).not.toHaveProperty('completionRecordedAt');
    expect(JSON.stringify(body)).not.toContain('request-private-recovery');
  });

  it('reports a missing checkpoint and never infers eligibility from stage success', async () => {
    const fixture = route(async () => RESULT);
    fixture.findTechnicalCheckpointOwned.mockResolvedValueOnce(null);

    const response = await fixture.handler(request({ method: 'GET' }), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { sourceExecutionId: EXECUTION_ID, checkpointStatus: 'NOT_FOUND', attempt: null },
    });
  });

  it('rejects an invalid reconciliation clock before consulting attempt state', async () => {
    const fixture = route(
      async () => RESULT,
      () => Number.POSITIVE_INFINITY,
    );

    const response = await fixture.handler(request({ method: 'GET' }), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      errors: [{ code: 'INTERNAL_ERROR' }],
    });
    expect(fixture.reconcileTechnicalResumeAttemptOwned).not.toHaveBeenCalled();
  });

  it('distinguishes persisted cleanup failure from cleanup still pending', async () => {
    const failed = route(async () => RESULT);
    failed.findTechnicalCheckpointOwned.mockResolvedValueOnce({ cleanup: null } as never);
    failed.findByExecutionId.mockResolvedValueOnce({
      factoryResult: {
        workspaceReleaseStatus: 'FAILED',
        sandboxCleanupFailureCode: null,
      },
    } as never);
    const failedResponse = await failed.handler(request({ method: 'GET' }), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });

    expect(failedResponse.status).toBe(200);
    await expect(failedResponse.json()).resolves.toMatchObject({
      data: { checkpointStatus: 'CLEANUP_FAILED' },
    });

    const pending = route(async () => RESULT);
    pending.findTechnicalCheckpointOwned.mockResolvedValueOnce({ cleanup: null } as never);
    pending.findByExecutionId.mockResolvedValueOnce(null);
    const pendingResponse = await pending.handler(request({ method: 'GET' }), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });

    expect(pendingResponse.status).toBe(200);
    await expect(pendingResponse.json()).resolves.toMatchObject({
      data: { checkpointStatus: 'CLEANUP_PENDING' },
    });
  });

  it('maps cleanup rejection to failed or pending from persisted safe metadata', async () => {
    const workerFailure = () =>
      new ExecutionWorkerError('cleanup', {
        code: EXECUTION_WORKER_ERROR_CODES.TECHNICAL_CLEANUP_PENDING,
      });
    const failed = route(async () => {
      throw workerFailure();
    });
    failed.findTechnicalCheckpointOwned.mockResolvedValueOnce({ cleanup: null } as never);
    failed.findByExecutionId.mockResolvedValueOnce({
      factoryResult: {
        workspaceReleaseStatus: 'FAILED',
        sandboxCleanupFailureCode: null,
      },
    } as never);
    const failedResponse = await failed.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });
    expect(failedResponse.status).toBe(409);
    await expect(failedResponse.json()).resolves.toMatchObject({
      errors: [{ code: 'EXECUTION_TECHNICAL_CLEANUP_FAILED' }],
    });

    const pending = route(async () => {
      throw workerFailure();
    });
    pending.findTechnicalCheckpointOwned.mockResolvedValueOnce({ cleanup: null } as never);
    pending.findByExecutionId.mockResolvedValueOnce(null);
    const pendingResponse = await pending.handler(request(), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });
    expect(pendingResponse.status).toBe(409);
    await expect(pendingResponse.json()).resolves.toMatchObject({
      errors: [{ code: 'EXECUTION_TECHNICAL_CLEANUP_PENDING' }],
    });
  });

  it('rejects cross-origin mutation before creating a physical attempt', async () => {
    const fixture = route(async () => RESULT);
    const response = await fixture.handler(
      request({ headers: { origin: 'https://untrusted.example' } }),
      { params: Promise.resolve({ id: EXECUTION_ID }) },
    );

    expect(response.status).toBe(403);
    expect(fixture.dispatcher.dispatch).not.toHaveBeenCalled();
  });
});
