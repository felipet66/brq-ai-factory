import { EXECUTION_CONTRACT_VERSION, EXECUTION_ENGINE_VERSION } from '@brq/execution-engine';
import type { JobRecord } from '@brq/job-queue';
import type { ExecutionObservabilitySnapshot } from '@brq/observability';
import type { z } from 'zod';

import type { AuthenticatedUser } from '@/api/auth-contracts';
import {
  executionPreviewControlSchema,
  previewSessionViewSchema,
  type ExecutionPreviewControl,
  type PreviewSessionView,
} from '@/api/preview-contracts';

import { HTTP_API_VERSION } from './constants';
import { jsonResponse } from './response-foundation';
import {
  executionAcceptedResponseSchema,
  executionRerunAcceptedResponseSchema,
  executionTechnicalResumeLatestResponseSchema,
  executionTechnicalResumeResponseSchema,
  executionHistoryDetailResponseSchema,
  executionHistoryDetailSchema,
  executionHistoryPageResponseSchema,
  executionHistoryPageSchema,
  executionTimelineResponseSchema,
  healthResponseSchema,
  jobLookupResponseSchema,
  loginResponseSchema,
  logoutResponseSchema,
} from './schemas';

export { errorResponse, responseHeaders } from './response-foundation';

export function healthResponse(requestId: string): Response {
  const body = healthResponseSchema.parse({
    success: true,
    data: {
      status: 'ok',
      version: HTTP_API_VERSION,
      engineVersion: EXECUTION_ENGINE_VERSION,
      contractVersion: EXECUTION_CONTRACT_VERSION,
    },
    metadata: { requestId, apiVersion: HTTP_API_VERSION },
    errors: [],
  });
  return jsonResponse(body, { status: 200, requestId });
}

export function executionAcceptedResponse(job: JobRecord, requestId: string): Response {
  const body = executionAcceptedResponseSchema.parse({
    success: true,
    data: {
      executionId: job.executionId,
      jobId: job.jobId,
      status: 'QUEUED',
    },
    metadata: {
      requestId,
      apiVersion: HTTP_API_VERSION,
      executionId: job.executionId,
    },
    errors: [],
  });
  return jsonResponse(body, { status: 202, requestId });
}

export function executionRerunAcceptedResponse(
  accepted: {
    readonly sourceExecutionId: string;
    readonly executionId: string;
    readonly jobId: string;
    readonly status: 'QUEUED';
    readonly usesOpenAI: false;
  },
  requestId: string,
): Response {
  const body = executionRerunAcceptedResponseSchema.parse({
    success: true,
    data: {
      ...accepted,
      replayMode: 'REQUIRE_CACHE_HIT',
    },
    metadata: {
      requestId,
      apiVersion: HTTP_API_VERSION,
      executionId: accepted.executionId,
    },
    errors: [],
  });
  return jsonResponse(body, { status: 202, requestId });
}

export function executionTechnicalResumeResponse(
  result: {
    readonly attemptId: string;
    readonly sourceExecutionId: string;
    readonly checkpointHash: string;
    readonly status: 'COMPLETION_PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
    readonly resultHash: string;
    readonly usesOpenAI: false;
  },
  requestId: string,
): Response {
  const body = executionTechnicalResumeResponseSchema.parse({
    success: true,
    data: result,
    metadata: {
      requestId,
      apiVersion: HTTP_API_VERSION,
      executionId: result.sourceExecutionId,
    },
    errors: [],
  });
  return jsonResponse(body, {
    status: result.status === 'COMPLETION_PENDING' ? 202 : 200,
    requestId,
  });
}

export function executionTechnicalResumeLatestResponse(
  sourceExecutionId: string,
  checkpointStatus: 'AVAILABLE' | 'NOT_FOUND' | 'CLEANUP_PENDING' | 'CLEANUP_FAILED',
  attempt: {
    readonly attemptId: string;
    readonly checkpointHash: string;
    readonly status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
    readonly activePhase: 'EXECUTING' | 'COMPLETION_PENDING' | 'RECOVERY_REQUIRED' | null;
    readonly startedAt: string;
    readonly finishedAt: string | null;
    readonly result: { readonly resultHash: string } | null;
    readonly cleanupConfirmed: boolean;
    readonly failureReasonCode: string | null;
    readonly recoveryReasonCode: string | null;
  } | null,
  requestId: string,
): Response {
  const body = executionTechnicalResumeLatestResponseSchema.parse({
    success: true,
    data: {
      sourceExecutionId,
      checkpointStatus,
      attempt:
        attempt === null
          ? null
          : {
              attemptId: attempt.attemptId,
              checkpointHash: attempt.checkpointHash,
              status: attempt.status,
              activePhase: attempt.activePhase,
              startedAt: attempt.startedAt,
              finishedAt: attempt.finishedAt,
              resultHash: attempt.result?.resultHash ?? null,
              reasonCode: attempt.failureReasonCode ?? attempt.recoveryReasonCode,
              cleanupConfirmed: attempt.cleanupConfirmed,
              usesOpenAI: false,
            },
    },
    metadata: { requestId, apiVersion: HTTP_API_VERSION, executionId: sourceExecutionId },
    errors: [],
  });
  return jsonResponse(body, { status: 200, requestId });
}

export function loginSuccessResponse(
  user: AuthenticatedUser,
  requestId: string,
  setCookies: readonly string[],
): Response {
  const body = loginResponseSchema.parse({
    success: true,
    data: { user },
    metadata: { requestId, apiVersion: HTTP_API_VERSION },
    errors: [],
  });
  return jsonResponse(body, { status: 200, requestId, setCookies });
}

export function logoutSuccessResponse(requestId: string, setCookies: readonly string[]): Response {
  const body = logoutResponseSchema.parse({
    success: true,
    data: { loggedOut: true },
    metadata: { requestId, apiVersion: HTTP_API_VERSION },
    errors: [],
  });
  return jsonResponse(body, { status: 200, requestId, setCookies });
}

export function jobLookupResponse(
  job: {
    readonly jobId: string;
    readonly executionId: string;
    readonly status: string;
    readonly queuedAt: string;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
  },
  requestId: string,
): Response {
  const body = jobLookupResponseSchema.parse({
    success: true,
    data: job,
    metadata: {
      requestId,
      apiVersion: HTTP_API_VERSION,
      executionId: job.executionId,
    },
    errors: [],
  });
  return jsonResponse(body, { status: 200, requestId });
}

export function executionHistoryPageResponse(
  page: z.input<typeof executionHistoryPageSchema>,
  requestId: string,
): Response {
  const body = executionHistoryPageResponseSchema.parse({
    success: true,
    data: page,
    metadata: { requestId, apiVersion: HTTP_API_VERSION },
    errors: [],
  });
  return jsonResponse(body, { status: 200, requestId });
}

export function executionHistoryDetailResponse(
  detail: z.input<typeof executionHistoryDetailSchema>,
  requestId: string,
): Response {
  const body = executionHistoryDetailResponseSchema.parse({
    success: true,
    data: detail,
    metadata: {
      requestId,
      apiVersion: HTTP_API_VERSION,
      executionId: detail.executionId,
    },
    errors: [],
  });
  return jsonResponse(body, { status: 200, requestId });
}

export function executionTimelineResponse(
  snapshot: ExecutionObservabilitySnapshot,
  requestId: string,
): Response {
  const body = executionTimelineResponseSchema.parse({
    success: true,
    data: snapshot,
    metadata: {
      requestId,
      apiVersion: HTTP_API_VERSION,
      executionId: snapshot.executionId,
    },
    errors: [],
  });
  return jsonResponse(body, { status: 200, requestId });
}

export function previewControlResponse(
  control: ExecutionPreviewControl,
  requestId: string,
  executionId: string,
): Response {
  const data = executionPreviewControlSchema.parse(control);
  return jsonResponse(
    {
      success: true,
      data,
      metadata: { requestId, apiVersion: HTTP_API_VERSION, executionId },
      errors: [],
    },
    { status: 200, requestId },
  );
}

export function previewSessionResponse(
  session: PreviewSessionView,
  requestId: string,
  status: 200 | 201,
): Response {
  const data = previewSessionViewSchema.parse(session);
  return jsonResponse(
    {
      success: true,
      data,
      metadata: {
        requestId,
        apiVersion: HTTP_API_VERSION,
        executionId: data.executionId,
      },
      errors: [],
    },
    { status, requestId },
  );
}
