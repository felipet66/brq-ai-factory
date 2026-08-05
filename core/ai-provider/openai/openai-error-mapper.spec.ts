import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import { describe, expect, it } from 'vitest';

import { AI_PROVIDER_ERROR_CODES } from '../errors';
import { mapOpenAIError } from './openai-error-mapper';

function httpError(status: number, code = 'provider_error'): APIError {
  return APIError.generate(
    status,
    {
      error: {
        message: 'sensitive provider detail',
        type: 'provider_error',
        param: null,
        code,
      },
    },
    undefined,
    new Headers({ 'x-request-id': 'provider_request_1' }),
  );
}

describe('mapOpenAIError', () => {
  it('should mark only connection failures without an HTTP response as retryable', () => {
    const mapped = mapOpenAIError(new APIConnectionError({ cause: new Error('socket closed') }), {
      callerAborted: false,
      timedOut: false,
    });

    expect(mapped).toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.CONNECTION_FAILED,
      retryable: true,
      statusCode: undefined,
    });
  });

  it.each([
    [400, 'provider_error', AI_PROVIDER_ERROR_CODES.INVALID_REQUEST],
    [401, 'invalid_api_key', AI_PROVIDER_ERROR_CODES.AUTHENTICATION_FAILED],
    [403, 'forbidden', AI_PROVIDER_ERROR_CODES.PERMISSION_DENIED],
    [429, 'rate_limit_exceeded', AI_PROVIDER_ERROR_CODES.RATE_LIMITED],
    [429, 'insufficient_quota', AI_PROVIDER_ERROR_CODES.QUOTA_EXCEEDED],
    [500, 'server_error', AI_PROVIDER_ERROR_CODES.UNAVAILABLE],
  ] as const)('should classify HTTP %s without retry', (status, providerCode, expectedCode) => {
    const mapped = mapOpenAIError(httpError(status, providerCode), {
      callerAborted: false,
      timedOut: false,
    });

    expect(mapped).toMatchObject({
      code: expectedCode,
      retryable: false,
      statusCode: status,
      providerRequestId: 'provider_request_1',
    });
    expect(mapped.message).not.toContain('sensitive provider detail');
  });

  it('should distinguish timeout and caller cancellation', () => {
    expect(
      mapOpenAIError(new APIConnectionTimeoutError(), {
        callerAborted: false,
        timedOut: true,
      }),
    ).toMatchObject({ code: AI_PROVIDER_ERROR_CODES.TIMEOUT, retryable: false });

    expect(
      mapOpenAIError(new APIUserAbortError(), {
        callerAborted: true,
        timedOut: false,
      }),
    ).toMatchObject({ code: AI_PROVIDER_ERROR_CODES.CANCELLED, retryable: false });
  });

  it('should classify unknown failures as permanent', () => {
    expect(
      mapOpenAIError(new Error('unknown'), { callerAborted: false, timedOut: false }),
    ).toMatchObject({ code: AI_PROVIDER_ERROR_CODES.FAILURE, retryable: false });
  });
});
