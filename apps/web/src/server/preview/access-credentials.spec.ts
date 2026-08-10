import { describe, expect, it } from 'vitest';

import {
  hashPreviewAccessTicket,
  signPreviewAccessCookie,
  verifyPreviewAccessCookie,
} from './access-credentials';

const secret = 'preview-cookie-secret-with-at-least-32-bytes';
const claims = Object.freeze({
  version: 1 as const,
  previewId: `preview-${'a'.repeat(32)}`,
  executionId: `execution-${'b'.repeat(32)}`,
  ownerUserId: 'user-owner',
  expiresAt: '2026-08-10T12:15:00.000Z',
});

describe('Preview access credentials', () => {
  it('hashes tickets deterministically with a domain-separated digest', () => {
    const ticket = 'A'.repeat(43);
    expect(hashPreviewAccessTicket(ticket)).toBe(hashPreviewAccessTicket(ticket));
    expect(hashPreviewAccessTicket(ticket)).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => hashPreviewAccessTicket('unsafe ticket')).toThrow(TypeError);
  });

  it('signs and verifies an unexpired cookie', () => {
    const cookie = signPreviewAccessCookie(claims, secret);
    expect(verifyPreviewAccessCookie(cookie, secret, '2026-08-10T12:00:00.000Z')).toEqual(claims);
  });

  it('rejects tampering, another secret, malformed values, and expiration', () => {
    const cookie = signPreviewAccessCookie(claims, secret);
    expect(verifyPreviewAccessCookie(`${cookie}x`, secret, '2026-08-10T12:00:00.000Z')).toBeNull();
    expect(
      verifyPreviewAccessCookie(
        cookie,
        'another-preview-cookie-secret-with-32-bytes',
        '2026-08-10T12:00:00.000Z',
      ),
    ).toBeNull();
    expect(verifyPreviewAccessCookie('invalid', secret, '2026-08-10T12:00:00.000Z')).toBeNull();
    expect(verifyPreviewAccessCookie(cookie, secret, claims.expiresAt)).toBeNull();
  });
});
