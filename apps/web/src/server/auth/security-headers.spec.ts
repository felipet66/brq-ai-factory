// @vitest-environment node

import { describe, expect, it } from 'vitest';

import nextConfig from '../../../next.config';

describe('frontend security headers', () => {
  it('denies framing and applies minimum hardening to login and protected pages', async () => {
    const rules = await nextConfig.headers?.();
    const headers = rules?.[0]?.headers ?? [];

    expect(rules?.[0]?.source).toBe('/:path*');
    expect(headers).toEqual(
      expect.arrayContaining([
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'" },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ]),
    );
  });
});
