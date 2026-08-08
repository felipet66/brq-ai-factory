import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';

import type { DatabaseClient } from '@brq/prisma';
import { z } from 'zod';

import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from './config';
import { hashPassword } from './password';

const localSeedEnvironmentSchema = z
  .object({
    BRQ_SEED_ADMIN_EMAIL: z.string().email().max(254).optional(),
    BRQ_SEED_ADMIN_NAME: z.string().trim().min(1).max(200).optional(),
    BRQ_SEED_ADMIN_PASSWORD: z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(AUTH_PASSWORD_MAX_LENGTH),
    BRQ_SEED_USER_EMAIL: z.string().email().max(254).optional(),
    BRQ_SEED_USER_NAME: z.string().trim().min(1).max(200).optional(),
    BRQ_SEED_USER_PASSWORD: z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(AUTH_PASSWORD_MAX_LENGTH),
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  })
  .passthrough();

export interface LocalSeedUser {
  readonly id: string;
  readonly accountId: string;
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly role: 'ADMIN' | 'USER';
}

export interface LocalSeedConfiguration {
  readonly users: readonly [LocalSeedUser, LocalSeedUser];
}

export function loadLocalSeedProcessEnvironment(
  processEnvironment: Readonly<Record<string, string | undefined>>,
  environmentFilePath: string,
): Readonly<Record<string, string | undefined>> {
  const fileEnvironment = existsSync(environmentFilePath)
    ? parseEnv(readFileSync(environmentFilePath, 'utf8'))
    : {};
  const definedProcessEnvironment = Object.fromEntries(
    Object.entries(processEnvironment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return Object.freeze({ ...fileEnvironment, ...definedProcessEnvironment });
}

export function resolveLocalSeedDatabaseUrl(
  databaseUrl: string | undefined,
  projectRoot: string,
): string | undefined {
  if (databaseUrl === undefined || !databaseUrl.startsWith('file:')) return databaseUrl;
  const databasePath = databaseUrl.slice('file:'.length);
  if (databasePath === '' || isAbsolute(databasePath)) return databaseUrl;
  return `file:${resolve(projectRoot, databasePath)}`;
}

export function parseLocalSeedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): LocalSeedConfiguration {
  const parsed = localSeedEnvironmentSchema.parse(environment);
  if (parsed.NODE_ENV === 'production') {
    throw new TypeError('O seed local de autenticação é proibido em produção.');
  }
  const adminEmail = (parsed.BRQ_SEED_ADMIN_EMAIL ?? 'admin@example.local').toLowerCase();
  const userEmail = (parsed.BRQ_SEED_USER_EMAIL ?? 'user@example.local').toLowerCase();
  if (adminEmail === userEmail) {
    throw new TypeError('Os usuários locais de seed devem possuir emails distintos.');
  }

  return Object.freeze({
    users: Object.freeze([
      Object.freeze({
        id: 'user-local-admin',
        accountId: 'account-local-admin-credential',
        email: adminEmail,
        name: parsed.BRQ_SEED_ADMIN_NAME ?? 'Local Administrator',
        password: parsed.BRQ_SEED_ADMIN_PASSWORD,
        role: 'ADMIN' as const,
      }),
      Object.freeze({
        id: 'user-local-user',
        accountId: 'account-local-user-credential',
        email: userEmail,
        name: parsed.BRQ_SEED_USER_NAME ?? 'Local User',
        password: parsed.BRQ_SEED_USER_PASSWORD,
        role: 'USER' as const,
      }),
    ] as const),
  });
}

export async function seedLocalAuthenticationUsers(
  client: DatabaseClient,
  configuration: LocalSeedConfiguration,
): Promise<readonly string[]> {
  const seededUserIds: string[] = [];
  for (const user of configuration.users) {
    const passwordHash = await hashPassword(user.password);
    await client.$transaction(async (transaction) => {
      await transaction.user.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: true,
          role: user.role,
        },
        update: {
          email: user.email,
          name: user.name,
          emailVerified: true,
          role: user.role,
        },
      });
      await transaction.account.upsert({
        where: { id: user.accountId },
        create: {
          id: user.accountId,
          accountId: user.id,
          providerId: 'credential',
          userId: user.id,
          password: passwordHash,
        },
        update: {
          accountId: user.id,
          providerId: 'credential',
          userId: user.id,
          password: passwordHash,
        },
      });
      await transaction.account.deleteMany({
        where: {
          userId: user.id,
          providerId: 'credential',
          id: { not: user.accountId },
        },
      });
      await transaction.session.deleteMany({ where: { userId: user.id } });
    });
    seededUserIds.push(user.id);
  }
  return Object.freeze(seededUserIds);
}
