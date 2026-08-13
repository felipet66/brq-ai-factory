// @vitest-environment node

import { APIError } from 'better-auth/api';
import { describe, expect, it, vi } from 'vitest';

import type { Authentication } from '@/server/auth/auth';
import { AUTHENTICATED_PRINCIPAL, FIXED_REQUEST_ID, capturedLogger } from '@/test/api-fixtures';

import { createLoginHandler, createLogoutHandler } from './auth-handler';

const ORIGIN = 'https://factory.example.test';
const PASSWORD = 'correct-horse-battery-staple';
const SESSION_COOKIE =
  '__Secure-brq-ai-factory.session_token=opaque-session-token; Path=/; HttpOnly; Secure; SameSite=Lax';

function request(
  path: '/api/auth/login' | '/api/auth/logout',
  options: { readonly body?: unknown; readonly origin?: string; readonly cookie?: string } = {},
): Request {
  const body = options.body;
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      origin: options.origin ?? ORIGIN,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function authenticationApi(input: {
  readonly getSession?: ReturnType<typeof vi.fn>;
  readonly revokeSession?: ReturnType<typeof vi.fn>;
  readonly signInEmail?: ReturnType<typeof vi.fn>;
  readonly signOut?: ReturnType<typeof vi.fn>;
}): Authentication {
  return {
    api: {
      getSession: input.getSession ?? vi.fn(async () => null),
      revokeSession: input.revokeSession ?? vi.fn(),
      signInEmail: input.signInEmail ?? vi.fn(),
      signOut: input.signOut ?? vi.fn(),
    },
  } as unknown as Authentication;
}

function successfulSignIn() {
  return {
    headers: new Headers({ 'set-cookie': SESSION_COOKIE }),
    response: {
      redirect: false,
      token: 'private-response-token',
      user: {
        id: AUTHENTICATED_PRINCIPAL.userId,
        name: AUTHENTICATED_PRINCIPAL.user.name,
        email: AUTHENTICATED_PRINCIPAL.user.email,
        emailVerified: true,
        role: AUTHENTICATED_PRINCIPAL.role,
        createdAt: new Date(AUTHENTICATED_PRINCIPAL.user.createdAt),
        updatedAt: new Date(AUTHENTICATED_PRINCIPAL.user.updatedAt),
      },
    },
  };
}

describe('authentication HTTP adapter', () => {
  it('creates a secure session while returning only the safe user projection', async () => {
    const signInEmail = vi.fn(async () => successfulSignIn());
    const authentication = authenticationApi({ signInEmail });
    const { logger, records } = capturedLogger();
    const handler = createLoginHandler({
      getAuthentication: () => authentication,
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });

    const response = await handler(
      request('/api/auth/login', {
        body: { email: AUTHENTICATED_PRINCIPAL.user.email, password: PASSWORD },
      }),
      undefined,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(body).toEqual({
      success: true,
      data: { user: AUTHENTICATED_PRINCIPAL.user },
      metadata: { requestId: FIXED_REQUEST_ID, apiVersion: '4.1.0' },
      errors: [],
    });
    expect(signInEmail).toHaveBeenCalledWith({
      body: {
        email: AUTHENTICATED_PRINCIPAL.user.email,
        password: PASSWORD,
        rememberMe: true,
      },
      headers: expect.any(Headers),
      returnHeaders: true,
    });
    const serialized = JSON.stringify(body) + JSON.stringify(records);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('private-response-token');
    expect(serialized).not.toContain('opaque-session-token');
    expect(JSON.stringify(records)).not.toContain(AUTHENTICATED_PRINCIPAL.user.email);
  });

  it.each([
    ['a single cookie', SESSION_COOKIE, SESSION_COOKIE],
    ['no cookie', null, null],
  ])(
    'supports Headers implementations with %s and no getSetCookie()',
    async (_label, cookie, expected) => {
      const outcome = successfulSignIn();
      const signInEmail = vi.fn(async () => ({
        ...outcome,
        headers: {
          get: vi.fn((name: string) => (name.toLowerCase() === 'set-cookie' ? cookie : null)),
        } as unknown as Headers,
      }));
      const handler = createLoginHandler({
        getAuthentication: () => authenticationApi({ signInEmail }),
        expectedOrigin: ORIGIN,
        requestIdFactory: () => FIXED_REQUEST_ID,
        logger: capturedLogger().logger,
      });

      const response = await handler(
        request('/api/auth/login', {
          body: { email: AUTHENTICATED_PRINCIPAL.user.email, password: PASSWORD },
        }),
        undefined,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBe(expected);
    },
  );

  it('maps every credential rejection to the same non-enumerating 401 response', async () => {
    const signInEmail = vi.fn(async () => {
      throw new APIError('UNAUTHORIZED', {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'private provider detail',
      });
    });
    const handler = createLoginHandler({
      getAuthentication: () => authenticationApi({ signInEmail }),
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const response = await handler(
      request('/api/auth/login', {
        body: { email: 'unknown@example.test', password: PASSWORD },
      }),
      undefined,
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(401);
    expect(serialized).toContain('AUTHENTICATION_INVALID_CREDENTIALS');
    expect(serialized).toContain('Email ou senha inválidos.');
    expect(serialized).not.toContain('private provider detail');
  });

  it('rejects missing or cross-origin mutations before reading credentials', async () => {
    const signInEmail = vi.fn(async () => successfulSignIn());
    const handler = createLoginHandler({
      getAuthentication: () => authenticationApi({ signInEmail }),
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });
    const crossOrigin = request('/api/auth/login', {
      body: { email: AUTHENTICATED_PRINCIPAL.user.email, password: PASSWORD },
      origin: 'https://attacker.example.test',
    });
    const missingOrigin = new Request(`${ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: AUTHENTICATED_PRINCIPAL.user.email, password: PASSWORD }),
    });

    for (const rejected of [crossOrigin, missingOrigin]) {
      const response = await handler(rejected, undefined);
      expect(response.status).toBe(403);
      expect((await response.json()).errors[0].code).toBe('CSRF_REJECTED');
    }
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('rejects malformed, oversized and query-bearing login requests before Better Auth', async () => {
    const signInEmail = vi.fn(async () => successfulSignIn());
    const handler = createLoginHandler({
      getAuthentication: () => authenticationApi({ signInEmail }),
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });
    const malformed = request('/api/auth/login', { body: { email: 'invalid', password: '' } });
    const oversized = new Request(`${ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(8 * 1024 + 1),
        origin: ORIGIN,
      },
      body: '{}',
    });
    const query = new Request(`${ORIGIN}/api/auth/login?next=/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({
        email: AUTHENTICATED_PRINCIPAL.user.email,
        password: PASSWORD,
      }),
    });

    const outcomes = await Promise.all([
      handler(malformed, undefined),
      handler(oversized, undefined),
      handler(query, undefined),
    ]);
    expect(outcomes.map((response) => response.status)).toEqual([400, 413, 400]);
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('revokes the authenticated session without exposing cookie or user data', async () => {
    const getSession = vi.fn(async () => ({
      session: { token: 'private-session-token' },
      user: AUTHENTICATED_PRINCIPAL.user,
    }));
    const revokeSession = vi.fn(async () => ({ status: true }));
    const signOut = vi.fn(async () => ({
      headers: new Headers({
        'set-cookie': '__Secure-brq-ai-factory.session_token=; Path=/; Max-Age=0; HttpOnly; Secure',
      }),
      response: { success: true },
    }));
    const authentication = authenticationApi({ getSession, revokeSession, signOut });
    const { logger, records } = capturedLogger();
    const handler = createLogoutHandler({
      getAuthentication: () => authentication,
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });

    const response = await handler(
      request('/api/auth/logout', { cookie: 'private-session-cookie' }),
      undefined,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { loggedOut: true },
      metadata: { requestId: FIXED_REQUEST_ID, apiVersion: '4.1.0' },
      errors: [],
    });
    expect(revokeSession).toHaveBeenCalledWith({
      body: { token: 'private-session-token' },
      headers: expect.any(Headers),
    });
    expect(signOut).toHaveBeenCalledWith({ headers: expect.any(Headers), returnHeaders: true });
    expect(JSON.stringify(records)).not.toContain('private-session-cookie');
    expect(JSON.stringify(records)).not.toContain(AUTHENTICATED_PRINCIPAL.user.email);
    expect(JSON.stringify(records)).not.toContain('private-session-token');
  });

  it('fails closed when server-side session revocation cannot be confirmed', async () => {
    const signOut = vi.fn();
    const handler = createLogoutHandler({
      getAuthentication: () =>
        authenticationApi({
          getSession: vi.fn(async () => ({
            session: { token: 'private-session-token' },
            user: AUTHENTICATED_PRINCIPAL.user,
          })),
          revokeSession: vi.fn(async () => {
            throw new Error('private database failure');
          }),
          signOut,
        }),
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const response = await handler(
      request('/api/auth/logout', { cookie: 'private-session-cookie' }),
      undefined,
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).toContain('AUTHENTICATION_UNAVAILABLE');
    expect(serialized).not.toContain('private database failure');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('fails closed when revocation or cookie invalidation is rejected', async () => {
    const rejectedRevocationSignOut = vi.fn();
    const rejectedRevocation = createLogoutHandler({
      getAuthentication: () =>
        authenticationApi({
          getSession: vi.fn(async () => ({
            session: { token: 'private-session-token' },
            user: AUTHENTICATED_PRINCIPAL.user,
          })),
          revokeSession: vi.fn(async () => ({ status: false })),
          signOut: rejectedRevocationSignOut,
        }),
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });
    const rejectedSignOut = createLogoutHandler({
      getAuthentication: () =>
        authenticationApi({
          getSession: vi.fn(async () => null),
          signOut: vi.fn(async () => ({
            headers: new Headers(),
            response: { success: false },
          })),
        }),
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    for (const handler of [rejectedRevocation, rejectedSignOut]) {
      const response = await handler(request('/api/auth/logout'), undefined);
      expect(response.status).toBe(503);
      expect((await response.json()).errors[0].code).toBe('AUTHENTICATION_UNAVAILABLE');
    }
    expect(rejectedRevocationSignOut).not.toHaveBeenCalled();
  });

  it('maps authentication infrastructure failures to a sanitized 503', async () => {
    const { logger, records } = capturedLogger();
    const handler = createLoginHandler({
      getAuthentication: () => {
        throw new Error('DATABASE_URL=file:private-auth.db');
      },
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });

    const response = await handler(
      request('/api/auth/login', {
        body: { email: AUTHENTICATED_PRINCIPAL.user.email, password: PASSWORD },
      }),
      undefined,
    );
    const serialized = JSON.stringify(await response.json()) + JSON.stringify(records);

    expect(response.status).toBe(503);
    expect(serialized).toContain('AUTHENTICATION_UNAVAILABLE');
    expect(serialized).not.toContain('private-auth.db');
  });

  it('maps provider and unsafe user projection failures to sanitized 503 responses', async () => {
    const providerFailure = createLoginHandler({
      getAuthentication: () =>
        authenticationApi({
          signInEmail: vi.fn(async () => {
            throw new Error('private provider failure');
          }),
        }),
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });
    const projectionFailure = createLoginHandler({
      getAuthentication: () =>
        authenticationApi({
          signInEmail: vi.fn(async () => ({
            ...successfulSignIn(),
            response: {
              ...successfulSignIn().response,
              user: { ...successfulSignIn().response.user, role: 'ROOT' },
            },
          })),
        }),
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });
    const loginRequest = () =>
      request('/api/auth/login', {
        body: { email: AUTHENTICATED_PRINCIPAL.user.email, password: PASSWORD },
      });

    for (const handler of [providerFailure, projectionFailure]) {
      const response = await handler(loginRequest(), undefined);
      expect(response.status).toBe(503);
      expect((await response.json()).errors[0].code).toBe('AUTHENTICATION_UNAVAILABLE');
    }
  });

  it('keeps logout same-origin and idempotent without requiring a live session', async () => {
    const signOut = vi.fn(async () => ({
      headers: new Headers({
        'set-cookie': 'brq-ai-factory.session_token=; Path=/; Max-Age=0; HttpOnly',
      }),
      response: { success: true },
    }));
    const handler = createLogoutHandler({
      getAuthentication: () => authenticationApi({ signOut }),
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const response = await handler(request('/api/auth/logout'), undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { loggedOut: true } });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(signOut).toHaveBeenCalledOnce();
  });
});
