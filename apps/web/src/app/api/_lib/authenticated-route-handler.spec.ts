// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { AuthenticationError } from '@/server/auth/errors';
import { AUTHENTICATED_PRINCIPAL, FIXED_REQUEST_ID, capturedLogger } from '@/test/api-fixtures';

import { createAuthenticatedRouteHandler } from './authenticated-route-handler';

describe('authenticated route boundary', () => {
  it('passes the immutable authenticated principal to the protected operation', async () => {
    const operation = vi.fn(async () => ({ response: new Response(null, { status: 204 }) }));
    const authenticate = vi.fn(async () => AUTHENTICATED_PRINCIPAL);
    const handler = createAuthenticatedRouteHandler<unknown>({
      endpoint: '/api/protected',
      allowedMethods: ['GET'],
      authenticate,
      operation,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });
    const request = new Request('https://factory.example.test/api/protected');

    const response = await handler(request, undefined);

    expect(response.status).toBe(204);
    expect(authenticate).toHaveBeenCalledWith(request, FIXED_REQUEST_ID);
    expect(operation).toHaveBeenCalledWith(
      request,
      undefined,
      FIXED_REQUEST_ID,
      AUTHENTICATED_PRINCIPAL,
    );
    expect(Object.isFrozen(AUTHENTICATED_PRINCIPAL)).toBe(true);
  });

  it.each([
    ['AUTHENTICATION_REQUIRED', 401],
    ['AUTHORIZATION_DENIED', 403],
    ['AUTHENTICATION_UNAVAILABLE', 503],
  ] as const)('fails closed for %s', async (kind, status) => {
    const operation = vi.fn();
    const handler = createAuthenticatedRouteHandler<unknown>({
      endpoint: '/api/protected',
      allowedMethods: ['GET'],
      authenticate: async () => {
        throw new AuthenticationError('Acesso negado.', kind);
      },
      operation,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const response = await handler(
      new Request('https://factory.example.test/api/protected'),
      undefined,
    );

    expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(kind);
    expect(operation).not.toHaveBeenCalled();
  });

  it('returns method rejection before authentication', async () => {
    const authenticate = vi.fn(async () => AUTHENTICATED_PRINCIPAL);
    const handler = createAuthenticatedRouteHandler<unknown>({
      endpoint: '/api/protected',
      allowedMethods: ['GET'],
      authenticate,
      operation: vi.fn(),
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const response = await handler(
      new Request('https://factory.example.test/api/protected', { method: 'DELETE' }),
      undefined,
    );

    expect(response.status).toBe(405);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
