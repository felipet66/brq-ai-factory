import { describe, expect, it, vi } from 'vitest';

import { AuthClientError, login, logout } from './auth-client';

const REQUEST_ID = 'request-00000000-0000-4000-8000-000000000001';
const USER = Object.freeze({
  id: 'user-001',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'ADMIN' as const,
  createdAt: '2026-08-07T12:00:00.000Z',
  updatedAt: '2026-08-07T12:05:00.000Z',
});

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function success(data: unknown) {
  return {
    success: true,
    data,
    metadata: { requestId: REQUEST_ID, apiVersion: '3.0.0' },
    errors: [],
  };
}

describe('auth HTTP client', () => {
  it('logs in through the same-origin cookie boundary and returns only an immutable public user', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(success({ user: USER })),
    );

    const user = await login(
      { email: '  ada@example.com ', password: 'safe-password' },
      { fetchImplementation },
    );

    expect(user).toEqual(USER);
    expect(Object.isFrozen(user)).toBe(true);
    expect(fetchImplementation).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', password: 'safe-password' }),
    });
    expect(JSON.stringify(user)).not.toMatch(/password|token|session|cookie/i);
  });

  it('rejects invalid credentials locally before issuing a request', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>();

    await expect(
      login({ email: 'not-an-email', password: '' }, { fetchImplementation }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', status: null, requestId: null });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('preserves only the safe API error and request correlation for invalid credentials', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        {
          success: false,
          data: null,
          metadata: { requestId: REQUEST_ID, apiVersion: '3.0.0' },
          errors: [{ code: 'AUTH_INVALID_CREDENTIALS', message: 'Email ou senha inválidos.' }],
        },
        401,
      ),
    );

    await expect(
      login({ email: 'ada@example.com', password: 'wrong' }, { fetchImplementation }),
    ).rejects.toMatchObject({
      code: 'API_ERROR',
      status: 401,
      requestId: REQUEST_ID,
      message: 'Email ou senha inválidos.',
    });
  });

  it.each([
    ['non-JSON response', new Response('private html', { status: 200 }), 200],
    ['malformed success envelope', jsonResponse(success({ token: 'must-not-cross' })), 200],
    ['malformed error envelope', jsonResponse({ error: 'private' }, 401), 401],
  ])('rejects a %s', async (_label, response, status) => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () => response);

    await expect(
      login({ email: 'ada@example.com', password: 'safe-password' }, { fetchImplementation }),
    ).rejects.toMatchObject({
      code: status === 401 ? 'API_ERROR' : 'INVALID_RESPONSE',
      status,
    });
  });

  it('maps network failures and cancellation without leaking their causes', async () => {
    const networkFetch = vi.fn<FetchImplementation>(async () => {
      throw new Error('socket with secret headers');
    });
    const controller = new AbortController();
    controller.abort();

    const networkError = await login(
      { email: 'ada@example.com', password: 'safe-password' },
      { fetchImplementation: networkFetch },
    ).catch((error: unknown) => error);
    const abortedError = await login(
      { email: 'ada@example.com', password: 'safe-password' },
      { signal: controller.signal, fetchImplementation: networkFetch },
    ).catch((error: unknown) => error);

    expect(networkError).toBeInstanceOf(AuthClientError);
    expect(networkError).toMatchObject({ code: 'NETWORK_ERROR' });
    if (!(networkError instanceof AuthClientError))
      throw new TypeError('Expected auth client error.');
    expect(networkError.message).not.toContain('secret headers');
    expect(abortedError).toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(networkFetch).toHaveBeenCalledOnce();
  });

  it('logs out without sending a body or exposing cookie material to JavaScript', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(success({ loggedOut: true })),
    );

    await expect(logout({ fetchImplementation })).resolves.toBeUndefined();

    expect(fetchImplementation).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    const request = fetchImplementation.mock.calls[0]?.[1];
    expect(request).not.toHaveProperty('body');
    expect(JSON.stringify(request)).not.toMatch(/authorization|token|session|cookie/i);
  });

  it('rejects an invalid logout acknowledgement', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(success({ loggedOut: false })),
    );

    await expect(logout({ fetchImplementation })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
    });
  });
});
