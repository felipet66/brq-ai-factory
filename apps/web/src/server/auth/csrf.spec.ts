// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertSameOriginMutation, assertSameOriginNavigationMutation } from './csrf';

const navigationHeaders = {
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
} as const;

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
    const missing = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: navigationHeaders,
    });
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

  it('accepts an exact Origin or complete same-origin document navigation metadata', () => {
    const exactOrigin = new Request('http://localhost:3000/previews/preview-1/launch', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    });
    const navigationWithoutOrigin = new Request('http://localhost:3000/previews/preview-1/launch', {
      method: 'POST',
      headers: navigationHeaders,
    });

    expect(() =>
      assertSameOriginNavigationMutation(exactOrigin, 'http://localhost:3000'),
    ).not.toThrow();
    expect(() =>
      assertSameOriginNavigationMutation(navigationWithoutOrigin, 'http://localhost:3000'),
    ).not.toThrow();
  });

  it.each([
    [
      'missing Fetch Site',
      'http://localhost:3000/previews/preview-1/launch',
      { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    ],
    [
      'cross-site Fetch Site',
      'http://localhost:3000/previews/preview-1/launch',
      { ...navigationHeaders, 'sec-fetch-site': 'cross-site' },
    ],
    [
      'non-navigation Fetch Mode',
      'http://localhost:3000/previews/preview-1/launch',
      { ...navigationHeaders, 'sec-fetch-mode': 'cors' },
    ],
    [
      'non-document Fetch Destination',
      'http://localhost:3000/previews/preview-1/launch',
      { ...navigationHeaders, 'sec-fetch-dest': 'iframe' },
    ],
    [
      'request URL origin mismatch',
      'http://127.0.0.1:3000/previews/preview-1/launch',
      navigationHeaders,
    ],
  ] as const)('rejects an Origin-less request with %s', (_case, url, headers) => {
    const request = new Request(url, { method: 'POST', headers });

    expect(() => assertSameOriginNavigationMutation(request, 'http://localhost:3000')).toThrowError(
      expect.objectContaining({ kind: 'CSRF_REJECTED' }),
    );
  });

  it.each([
    ['opaque Origin', 'null', 'same-origin'],
    ['origin mismatch', 'https://attacker.example.test', 'same-origin'],
    ['cross-site metadata', 'http://localhost:3000', 'cross-site'],
  ] as const)('rejects %s even when an Origin header is present', (_case, origin, fetchSite) => {
    const request = new Request('http://localhost:3000/previews/preview-1/launch', {
      method: 'POST',
      headers: { origin, 'sec-fetch-site': fetchSite },
    });

    expect(() => assertSameOriginNavigationMutation(request, 'http://localhost:3000')).toThrowError(
      expect.objectContaining({ kind: 'CSRF_REJECTED' }),
    );
  });
});
