// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { FIXED_REQUEST_ID, capturedLogger } from '@/test/api-fixtures';

import { createHealthHandler } from './health-handler';

describe('health HTTP adapter', () => {
  it('returns versions without resolving the Execution Engine', async () => {
    const { logger, records } = capturedLogger();
    const handler = createHealthHandler({
      logger,
      now: () => 10,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    const response = await handler(new Request('http://localhost/api/health'), undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        status: 'ok',
        version: '4.1.0',
        engineVersion: '1.0.0',
        contractVersion: '1.1.0',
      },
      metadata: { requestId: FIXED_REQUEST_ID, apiVersion: '4.1.0' },
      errors: [],
    });
    expect(response.headers.get('x-request-id')).toBe(FIXED_REQUEST_ID);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(records.map((record) => record.event)).toEqual([
      'http.request.started',
      'http.request.completed',
    ]);
  });

  it('rejects query parameters and unsupported methods uniformly', async () => {
    const handler = createHealthHandler({
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });
    const queryResponse = await handler(
      new Request('http://localhost/api/health?deep=true'),
      undefined,
    );
    const methodResponse = await handler(
      new Request('http://localhost/api/health', { method: 'POST' }),
      undefined,
    );

    expect(queryResponse.status).toBe(400);
    expect((await queryResponse.json()).errors[0].code).toBe('INVALID_REQUEST');
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('allow')).toBe('GET');
    expect((await methodResponse.json()).errors[0].code).toBe('METHOD_NOT_ALLOWED');
  });
});
