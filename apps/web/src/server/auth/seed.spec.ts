// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadLocalSeedProcessEnvironment,
  parseLocalSeedEnvironment,
  resolveLocalSeedDatabaseUrl,
} from './seed';

const PASSWORDS = {
  BRQ_SEED_ADMIN_PASSWORD: 'admin-local-password',
  BRQ_SEED_USER_PASSWORD: 'user-local-password',
} as const;

describe('local authentication seed policy', () => {
  it('fails closed in production', () => {
    expect(() => parseLocalSeedEnvironment({ ...PASSWORDS, NODE_ENV: 'production' })).toThrow(
      'proibido em produção',
    );
  });

  it('requires distinct users and environment-provided passwords', () => {
    expect(() => parseLocalSeedEnvironment({})).toThrow();
    expect(() =>
      parseLocalSeedEnvironment({
        ...PASSWORDS,
        BRQ_SEED_ADMIN_EMAIL: 'same@example.local',
        BRQ_SEED_USER_EMAIL: 'same@example.local',
      }),
    ).toThrow('emails distintos');
  });

  it('loads the repository environment file while preserving explicit process overrides', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brq-auth-seed-env-'));
    const environmentFile = join(directory, '.env');
    try {
      await writeFile(
        environmentFile,
        [
          'DATABASE_URL="file:./dev.db"',
          'BRQ_SEED_ADMIN_PASSWORD="password-from-file"',
          'BRQ_SEED_USER_PASSWORD="password-from-file"',
        ].join('\n'),
      );
      const environment = loadLocalSeedProcessEnvironment(
        { BRQ_SEED_USER_PASSWORD: 'password-from-process' },
        environmentFile,
      );

      expect(environment).toMatchObject({
        DATABASE_URL: 'file:./dev.db',
        BRQ_SEED_ADMIN_PASSWORD: 'password-from-file',
        BRQ_SEED_USER_PASSWORD: 'password-from-process',
      });
      expect(resolveLocalSeedDatabaseUrl(environment.DATABASE_URL, directory)).toBe(
        `file:${join(directory, 'dev.db')}`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
