// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertSameOriginMutation } from './csrf';

describe('authentication origin protection', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts only the exact configured origin', () => {
    const trusted = new Request('https://factory.example.test/api/auth/login', {
      method: 'POST',
      headers: { origin: 'https://factory.example.test' },
    });
    const untrusted = new Request('https://factory.example.test/api/auth/login', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example.test',
        'sec-fetch-site': 'cross-site',
      },
    });

    expect(() => assertSameOriginMutation(trusted, 'https://factory.example.test')).not.toThrow();
    expect(() => assertSameOriginMutation(untrusted, 'https://factory.example.test')).toThrowError(
      expect.objectContaining({ kind: 'CSRF_REJECTED' }),
    );
  });

  it('maps missing host authentication configuration to unavailable', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    vi.stubEnv('BRQ_APP_ORIGIN', '');
    const request = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    });

    expect(() => assertSameOriginMutation(request)).toThrowError(
      expect.objectContaining({ kind: 'AUTHENTICATION_UNAVAILABLE' }),
    );
  });

  it('accepts a valid environment origin and rejects missing or malformed Origin headers', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 's'.repeat(32));
    vi.stubEnv('BRQ_APP_ORIGIN', 'http://localhost:3000');
    const trusted = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    });
    const missing = new Request('http://localhost:3000/api/auth/logout', { method: 'POST' });
    const malformed = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'not a valid origin' },
    });

    expect(() => assertSameOriginMutation(trusted)).not.toThrow();
    expect(() => assertSameOriginMutation(missing)).toThrowError(
      expect.objectContaining({ kind: 'CSRF_REJECTED' }),
    );
    expect(() => assertSameOriginMutation(malformed)).toThrowError(
      expect.objectContaining({ kind: 'CSRF_REJECTED' }),
    );
  });
});
