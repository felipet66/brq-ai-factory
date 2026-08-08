// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ARGON2ID_OPTIONS, hashPassword, verifyPassword } from './password';

describe('authentication password hashing', () => {
  it('stores only an Argon2id digest using the selected OWASP parameters', async () => {
    const password = 'local-test-password';
    const digest = await hashPassword(password);

    expect(digest).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(digest).not.toContain(password);
    expect(ARGON2ID_OPTIONS).toMatchObject({
      algorithm: 2,
      version: 1,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    await expect(verifyPassword({ hash: digest, password })).resolves.toBe(true);
    await expect(verifyPassword({ hash: digest, password: 'incorrect-password' })).resolves.toBe(
      false,
    );
  });

  it('fails closed for malformed hashes and oversized candidates', async () => {
    await expect(verifyPassword({ hash: 'not-a-digest', password: 'anything' })).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword({ hash: '$argon2id$malformed', password: 'x'.repeat(129) }),
    ).resolves.toBe(false);
    await expect(
      verifyPassword({ hash: '$argon2id$malformed', password: 'valid-candidate' }),
    ).resolves.toBe(false);
  });

  it('accepts short login candidates for constant-work unknown-account hashing', async () => {
    const digest = await hashPassword('short');

    expect(digest).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword({ hash: digest, password: 'short' })).resolves.toBe(true);
  });
});
