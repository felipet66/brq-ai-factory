import { HTTP_API_VERSION, type ApiErrorCode } from './constants';
import type { ApiError } from './contracts';
import { errorResponseSchema } from './schemas';

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

export function jsonResponse(
  body: unknown,
  options: {
    readonly status: number;
    readonly requestId: string;
    readonly allow?: readonly string[];
    readonly setCookies?: readonly string[];
  },
): Response {
  const headers = responseHeaders(options.requestId, options.allow);
  for (const cookie of options.setCookies ?? []) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), {
    status: options.status,
    headers,
  });
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
