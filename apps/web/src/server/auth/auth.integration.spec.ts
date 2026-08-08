// @vitest-environment node

import { execFile } from 'node:child_process';
import { delimiter, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { createLogger } from '@brq/shared/logger/logger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabaseTestContext,
  type DatabaseTestContext,
} from '../../../../../prisma/tests/database-test-context';

import { createLogoutHandler } from '../../app/api/_lib/auth-handler';

import { createAuthentication, type Authentication } from './auth';
import { resolveAuthenticatedPrincipal } from './session';
import {
  parseLocalSeedEnvironment,
  seedLocalAuthenticationUsers,
  type LocalSeedConfiguration,
} from './seed';

const APP_ORIGIN = 'https://factory.example.test';
const ADMIN_PASSWORD = 'admin-local-password';
const USER_PASSWORD = 'user-local-password';
const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = resolve(process.cwd(), '../..');

function npmCliPath(): string {
  return (
    process.env.npm_execpath ??
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
  );
}

function requestHeaders(cookie?: string): Headers {
  return new Headers({
    origin: APP_ORIGIN,
    ...(cookie === undefined ? {} : { cookie }),
  });
}

function cookieHeader(headers: Headers): string {
  const values = headers.getSetCookie();
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

describe('Better Auth Prisma integration', () => {
  let context: DatabaseTestContext;
  let authentication: Authentication;
  let seed: LocalSeedConfiguration;

  beforeAll(async () => {
    context = await createDatabaseTestContext();
    seed = parseLocalSeedEnvironment({
      BRQ_SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
      BRQ_SEED_USER_PASSWORD: USER_PASSWORD,
    });
    await seedLocalAuthenticationUsers(context.client, seed);
    authentication = createAuthentication(context.client, {
      appOrigin: APP_ORIGIN,
      production: true,
      secret: 'integration-only-secret-that-is-at-least-32-characters',
    });
  }, 60_000);

  afterAll(async () => {
    await context?.cleanup();
  });

  it('seeds idempotent credential users without persisting plaintext passwords', async () => {
    await seedLocalAuthenticationUsers(context.client, seed);
    const users = await context.client.user.findMany({
      where: { id: { in: seed.users.map((user) => user.id) } },
      orderBy: { id: 'asc' },
      include: { accounts: true },
    });

    expect(users).toHaveLength(2);
    expect(users.map((user) => user.role).sort()).toEqual(['ADMIN', 'USER']);
    expect(users.every((user) => user.emailVerified)).toBe(true);
    for (const user of users) {
      expect(user.accounts).toHaveLength(1);
      expect(user.accounts[0]).toMatchObject({ providerId: 'credential', accountId: user.id });
      expect(user.accounts[0]?.password).toMatch(/^\$argon2id\$/);
      expect([ADMIN_PASSWORD, USER_PASSWORD]).not.toContain(user.accounts[0]?.password);
    }
  });

  it('executes the documented npm seed command against a temporary database', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [npmCliPath(), 'run', 'auth:seed'],
      {
        cwd: WORKSPACE_ROOT,
        env: {
          ...process.env,
          PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
          DATABASE_URL: context.databaseUrl,
          NODE_ENV: 'test',
          BRQ_SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
          BRQ_SEED_USER_PASSWORD: USER_PASSWORD,
        },
        timeout: 60_000,
      },
    );

    expect(stdout).toContain('Seed local de autenticação concluído para 2 usuários.');
    expect(`${stdout}${stderr}`).not.toContain(ADMIN_PASSWORD);
    expect(`${stdout}${stderr}`).not.toContain(USER_PASSWORD);
    expect(`${stdout}${stderr}`).not.toContain(context.databaseUrl);
    await expect(
      context.client.user.count({ where: { id: { in: seed.users.map((user) => user.id) } } }),
    ).resolves.toBe(2);
  }, 60_000);

  it('creates a secure database session for valid credentials and projects safe identity fields', async () => {
    const signedIn = await authentication.api.signInEmail({
      body: { email: seed.users[1].email, password: USER_PASSWORD },
      headers: requestHeaders(),
      returnHeaders: true,
    });
    const setCookies = signedIn.headers.getSetCookie();
    const sessionCookie = setCookies.find((value) =>
      value.startsWith('__Secure-brq-ai-factory.session_token='),
    );
    const cookie = cookieHeader(signedIn.headers);

    expect(setCookies.some((value) => /HttpOnly/i.test(value))).toBe(true);
    expect(setCookies.some((value) => /SameSite=Lax/i.test(value))).toBe(true);
    expect(setCookies.some((value) => /Secure/i.test(value))).toBe(true);
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).not.toMatch(/Domain=/i);
    expect(JSON.stringify(signedIn.response.user)).not.toContain(USER_PASSWORD);

    const lines: string[] = [];
    const principal = await resolveAuthenticatedPrincipal(requestHeaders(cookie), {
      authentication,
      logger: createLogger({ sink: (line) => lines.push(line) }),
      requestId: 'request-auth-integration',
    });
    expect(principal).toMatchObject({ userId: seed.users[1].id, role: 'USER' });
    expect(principal?.user).toEqual({
      id: seed.users[1].id,
      name: seed.users[1].name,
      email: seed.users[1].email,
      role: 'USER',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(lines.join('\n')).not.toContain(USER_PASSWORD);
    expect(lines.join('\n')).not.toContain(cookie);
    expect(lines.join('\n')).not.toContain(seed.users[1].email);

    const storedSession = await context.client.session.findFirstOrThrow({
      where: { userId: seed.users[1].id },
    });
    expect(storedSession).toMatchObject({ ipAddress: null, userAgent: null });
    expect(storedSession.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(
      Math.abs(
        storedSession.expiresAt.getTime() - storedSession.createdAt.getTime() - 8 * 60 * 60 * 1000,
      ),
    ).toBeLessThanOrEqual(1_000);
  });

  it('rejects invalid credentials without creating another session', async () => {
    const countBefore = await context.client.session.count();
    await expect(
      authentication.api.signInEmail({
        body: { email: seed.users[1].email, password: 'invalid-password' },
        headers: requestHeaders(),
      }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
    await expect(context.client.session.count()).resolves.toBe(countBefore);
  });

  it('keeps short-password failures indistinguishable for known and unknown emails', async () => {
    for (const email of [seed.users[1].email, 'unknown@example.local']) {
      await expect(
        authentication.api.signInEmail({
          body: { email, password: 'short' },
          headers: requestHeaders(),
        }),
      ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
    }
  });

  it('uses a fresh session token on every login and revokes it on logout', async () => {
    const first = await authentication.api.signInEmail({
      body: { email: seed.users[0].email, password: ADMIN_PASSWORD },
      headers: requestHeaders(),
      returnHeaders: true,
    });
    const firstCookie = cookieHeader(first.headers);
    const second = await authentication.api.signInEmail({
      body: { email: seed.users[0].email, password: ADMIN_PASSWORD },
      headers: requestHeaders(firstCookie),
      returnHeaders: true,
    });
    const secondCookie = cookieHeader(second.headers);
    expect(firstCookie).not.toBe(secondCookie);

    const logout = createLogoutHandler({
      getAuthentication: () => authentication,
      expectedOrigin: APP_ORIGIN,
      logger: createLogger({ sink: () => undefined }),
      requestIdFactory: () => 'request-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const signedOut = await logout(
      new Request(`${APP_ORIGIN}/api/auth/logout`, {
        method: 'POST',
        headers: requestHeaders(secondCookie),
      }),
      undefined,
    );
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    await expect(
      authentication.api.getSession({
        headers: requestHeaders(secondCookie),
        query: { disableCookieCache: true },
      }),
    ).resolves.toBeNull();
  });

  it('rejects an expired database session', async () => {
    const signedIn = await authentication.api.signInEmail({
      body: { email: seed.users[1].email, password: USER_PASSWORD },
      headers: requestHeaders(),
      returnHeaders: true,
    });
    const cookie = cookieHeader(signedIn.headers);
    const newestSession = await context.client.session.findFirstOrThrow({
      where: { userId: seed.users[1].id },
      orderBy: { createdAt: 'desc' },
    });
    await context.client.session.update({
      where: { id: newestSession.id },
      data: { expiresAt: new Date(0) },
    });

    await expect(
      authentication.api.getSession({
        headers: requestHeaders(cookie),
        query: { disableCookieCache: true },
      }),
    ).resolves.toBeNull();
  });
});
