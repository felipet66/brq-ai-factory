import { describe, expect, it, vi } from 'vitest';

import {
  getExecutionTechnicalResumeState,
  getLatestExecutionTechnicalResumeAttempt,
  resumeExecutionTechnicalPipeline,
} from './execution-technical-resume-client';

const SOURCE_ID = `execution-${'a'.repeat(32)}`;
const ATTEMPT_ID = 'technical-resume-4fbd475c-ced4-47ed-aad5-82a772ea75cd';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('execution technical resume client', () => {
  it('runs only the technical resume endpoint and preserves zero-OpenAI evidence', async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        success: true,
        data: {
          attemptId: ATTEMPT_ID,
          sourceExecutionId: SOURCE_ID,
          checkpointHash: '1'.repeat(64),
          status: 'SUCCESS',
          resultHash: '2'.repeat(64),
          usesOpenAI: false,
        },
        metadata: { requestId: 'request-test', apiVersion: '4.1.0', executionId: SOURCE_ID },
        errors: [],
      }),
    );

    await expect(
      resumeExecutionTechnicalPipeline(SOURCE_ID, { fetchImplementation }),
    ).resolves.toMatchObject({ attemptId: ATTEMPT_ID, status: 'SUCCESS', usesOpenAI: false });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/${SOURCE_ID}/technical-resume`,
      expect.objectContaining({ method: 'POST', cache: 'no-store' }),
    );
  });

  it('accepts a journaled completion-pending response with zero-OpenAI evidence', async () => {
    const fetchImplementation = vi.fn(async () =>
      response(
        {
          success: true,
          data: {
            attemptId: ATTEMPT_ID,
            sourceExecutionId: SOURCE_ID,
            checkpointHash: '1'.repeat(64),
            status: 'COMPLETION_PENDING',
            resultHash: '2'.repeat(64),
            usesOpenAI: false,
          },
          metadata: { requestId: 'request-test', apiVersion: '4.1.0' },
          errors: [],
        },
        202,
      ),
    );

    await expect(
      resumeExecutionTechnicalPipeline(SOURCE_ID, { fetchImplementation }),
    ).resolves.toMatchObject({
      attemptId: ATTEMPT_ID,
      status: 'COMPLETION_PENDING',
      usesOpenAI: false,
    });
  });

  it('surfaces the exact safe drift code', async () => {
    const fetchImplementation = vi.fn(async () =>
      response(
        {
          success: false,
          data: null,
          metadata: { requestId: 'request-test', apiVersion: '4.1.0' },
          errors: [
            {
              code: 'EXECUTION_TECHNICAL_PROFILE_DRIFT',
              message: 'The saved profile no longer matches.',
            },
          ],
        },
        409,
      ),
    );

    await expect(
      resumeExecutionTechnicalPipeline(SOURCE_ID, { fetchImplementation }),
    ).rejects.toMatchObject({ code: 'EXECUTION_TECHNICAL_PROFILE_DRIFT' });
  });

  it('reads the latest persisted attempt without initiating another run', async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        success: true,
        data: {
          sourceExecutionId: SOURCE_ID,
          checkpointStatus: 'AVAILABLE',
          attempt: {
            attemptId: ATTEMPT_ID,
            checkpointHash: '1'.repeat(64),
            status: 'FAILED',
            activePhase: null,
            startedAt: '2026-08-13T10:00:00.000Z',
            finishedAt: '2026-08-13T10:00:10.000Z',
            resultHash: null,
            reasonCode: 'CHECKPOINT_SANDBOX_DRIFT',
            cleanupConfirmed: true,
            usesOpenAI: false,
          },
        },
        metadata: { requestId: 'request-test', apiVersion: '4.1.0', executionId: SOURCE_ID },
        errors: [],
      }),
    );

    await expect(
      getLatestExecutionTechnicalResumeAttempt(SOURCE_ID, { fetchImplementation }),
    ).resolves.toMatchObject({
      attemptId: ATTEMPT_ID,
      status: 'FAILED',
      reasonCode: 'CHECKPOINT_SANDBOX_DRIFT',
      cleanupConfirmed: true,
      usesOpenAI: false,
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/${SOURCE_ID}/technical-resume`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('reads only the safe active phase and recovery reason', async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        success: true,
        data: {
          sourceExecutionId: SOURCE_ID,
          checkpointStatus: 'AVAILABLE',
          attempt: {
            attemptId: ATTEMPT_ID,
            checkpointHash: '1'.repeat(64),
            status: 'RUNNING',
            activePhase: 'RECOVERY_REQUIRED',
            startedAt: '2026-08-13T10:00:00.000Z',
            finishedAt: null,
            resultHash: null,
            reasonCode: 'TECHNICAL_LEASE_EXPIRED',
            cleanupConfirmed: false,
            usesOpenAI: false,
          },
        },
        metadata: { requestId: 'request-test', apiVersion: '4.1.0' },
        errors: [],
      }),
    );

    await expect(
      getExecutionTechnicalResumeState(SOURCE_ID, { fetchImplementation }),
    ).resolves.toMatchObject({
      attempt: {
        activePhase: 'RECOVERY_REQUIRED',
        reasonCode: 'TECHNICAL_LEASE_EXPIRED',
      },
    });
  });

  it('returns checkpoint eligibility independently from the latest attempt', async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        success: true,
        data: {
          sourceExecutionId: SOURCE_ID,
          checkpointStatus: 'CLEANUP_FAILED',
          attempt: null,
        },
        metadata: { requestId: 'request-test', apiVersion: '4.1.0', executionId: SOURCE_ID },
        errors: [],
      }),
    );

    await expect(
      getExecutionTechnicalResumeState(SOURCE_ID, { fetchImplementation }),
    ).resolves.toEqual({
      sourceExecutionId: SOURCE_ID,
      checkpointStatus: 'CLEANUP_FAILED',
      attempt: null,
    });
  });
});
