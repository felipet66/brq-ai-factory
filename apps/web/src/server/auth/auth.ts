import { prismaAdapter } from '@better-auth/prisma-adapter';
import type { DatabaseClient } from '@brq/prisma';
import { betterAuth } from 'better-auth';

import { getDatabaseClient } from '@/server/runtime';

import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_SESSION_DURATION_SECONDS,
  parseAuthenticationEnvironment,
  type AuthenticationConfig,
} from './config';
import { hashPassword, verifyPassword } from './password';

export function createAuthentication(client: DatabaseClient, config: AuthenticationConfig) {
  return betterAuth({
    appName: 'BRQ AI Factory',
    baseURL: config.appOrigin,
    basePath: '/api/auth',
    secret: config.secret,
    database: prismaAdapter(client, {
      provider: 'sqlite',
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: true,
      minPasswordLength: AUTH_PASSWORD_MIN_LENGTH,
      maxPasswordLength: AUTH_PASSWORD_MAX_LENGTH,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: ['ADMIN', 'USER'],
          required: true,
          defaultValue: 'USER',
          input: false,
          returned: true,
        },
      },
    },
    session: {
      expiresIn: AUTH_SESSION_DURATION_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({
            data: { ...session, ipAddress: null, userAgent: null },
          }),
        },
      },
    },
    trustedOrigins: [config.appOrigin],
    rateLimit: { enabled: false },
    advanced: {
      useSecureCookies: config.production,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      crossSubDomainCookies: { enabled: false },
      cookiePrefix: 'brq-ai-factory',
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.production,
        sameSite: 'lax',
        path: '/',
      },
    },
    disabledPaths: [
      '/sign-up/email',
      '/request-password-reset',
      '/reset-password',
      '/change-password',
      '/change-email',
    ],
    telemetry: { enabled: false },
    logger: { disabled: true },
  });
}

export type Authentication = ReturnType<typeof createAuthentication>;

const authGlobal = globalThis as typeof globalThis & {
  __brqAiFactoryAuthentication?: Authentication;
};

export function getAuthentication(): Authentication {
  authGlobal.__brqAiFactoryAuthentication ??= createAuthentication(
    getDatabaseClient(),
    parseAuthenticationEnvironment(process.env),
  );
  return authGlobal.__brqAiFactoryAuthentication;
}
