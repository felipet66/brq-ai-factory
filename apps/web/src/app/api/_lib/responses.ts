import { EXECUTION_CONTRACT_VERSION, EXECUTION_ENGINE_VERSION } from '@brq/execution-engine';
import type { JobRecord } from '@brq/job-queue';
import type { ExecutionObservabilitySnapshot } from '@brq/observability';
import type { z } from 'zod';

import { HTTP_API_VERSION, type ApiErrorCode } from './constants';
import type { ApiError } from './contracts';
import {
  errorResponseSchema,
  executionAcceptedResponseSchema,
  executionHistoryDetailResponseSchema,
  executionHistoryDetailSchema,
  executionHistoryPageResponseSchema,
  executionHistoryPageSchema,
  executionTimelineResponseSchema,
  healthResponseSchema,
  jobLookupResponseSchema,
} from './schemas';

export function responseHeaders(requestId: string, allow?: readonly string[]): Headers {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'content-type': 'application/json; charset=utf-8',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'x-request-id': requestId,
  });
  if (allow !== undefined) headers.set('allow', allow.join(', '));
  return headers;
}

function jsonResponse(
  body: unknown,
  options: {
    readonly status: number;
    readonly requestId: string;
    readonly allow?: readonly string[];
  },
): Response {
  return new Response(JSON.stringify(body), {
    status: options.status,
    headers: responseHeaders(options.requestId, options.allow),
  });
}

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

export function errorResponse(options: {
  readonly requestId: string;
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly executionId?: string;
  readonly allow?: readonly string[];
}): Response {
  const error: ApiError = {
    code: options.code,
    message: options.message,
    ...(options.path === undefined ? {} : { path: options.path }),
  };
  const body = errorResponseSchema.parse({
    success: false,
    data: null,
    metadata: {
      requestId: options.requestId,
      apiVersion: HTTP_API_VERSION,
      ...(options.executionId === undefined ? {} : { executionId: options.executionId }),
    },
    errors: [error],
  });
  return jsonResponse(body, {
    status: options.status,
    requestId: options.requestId,
    ...(options.allow === undefined ? {} : { allow: options.allow }),
  });
}
