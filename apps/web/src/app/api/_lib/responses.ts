import { EXECUTION_CONTRACT_VERSION, EXECUTION_ENGINE_VERSION } from '@brq/execution-engine';
import type { JobRecord } from '@brq/job-queue';
import type { ExecutionObservabilitySnapshot } from '@brq/observability';
import type { z } from 'zod';

import type { AuthenticatedUser } from '@/api/auth-contracts';

import { HTTP_API_VERSION } from './constants';
import { jsonResponse } from './response-foundation';
import {
  executionAcceptedResponseSchema,
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
