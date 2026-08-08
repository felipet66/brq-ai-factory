// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_SESSION_DURATION_SECONDS,
  parseAuthenticationEnvironment,
} from './config';

describe('authentication configuration', () => {
  it('parses the exact application origin and keeps the documented limits', () => {
    expect(
      parseAuthenticationEnvironment({
        BETTER_AUTH_SECRET: 's'.repeat(32),
        BRQ_APP_ORIGIN: 'https://factory.example.test',
        NODE_ENV: 'production',
      }),
    ).toEqual({
      appOrigin: 'https://factory.example.test',
      secret: 's'.repeat(32),
      production: true,
    });
    expect(AUTH_SESSION_DURATION_SECONDS).toBe(8 * 60 * 60);
    expect(AUTH_PASSWORD_MIN_LENGTH).toBe(12);
    expect(AUTH_PASSWORD_MAX_LENGTH).toBe(128);
  });

  it.each([
    ['short secret', { BETTER_AUTH_SECRET: 'short', BRQ_APP_ORIGIN: 'http://localhost:3000' }],
    [
      'origin with path',
      { BETTER_AUTH_SECRET: 's'.repeat(32), BRQ_APP_ORIGIN: 'http://localhost:3000/path' },
    ],
    [
      'non-http origin',
      { BETTER_AUTH_SECRET: 's'.repeat(32), BRQ_APP_ORIGIN: 'file:///tmp/factory' },
    ],
  ])('rejects %s', (_caseName, environment) => {
    expect(() => parseAuthenticationEnvironment(environment)).toThrow();
  });
});
