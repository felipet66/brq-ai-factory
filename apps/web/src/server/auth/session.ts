import { createLogger, type Logger } from '@brq/shared/logger/logger';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  authenticatedUserRoleSchema,
  authenticatedUserSchema,
  type AuthenticatedUser,
} from '@/api/auth-contracts';

import type { Authentication } from './auth';
import { getAuthentication } from './auth';
import type { AuthenticatedPrincipal, RequestAuthenticator } from './contracts';
import { AuthenticationError } from './errors';

const serverUserSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    role: authenticatedUserRoleSchema,
    createdAt: z.union([z.date(), z.string().datetime({ offset: true })]),
    updatedAt: z.union([z.date(), z.string().datetime({ offset: true })]),
  })
  .passthrough();

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function projectAuthenticatedUser(rawUser: unknown): AuthenticatedUser {
  const user = serverUserSchema.parse(rawUser);
  return Object.freeze(
    authenticatedUserSchema.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: toIsoString(user.createdAt),
      updatedAt: toIsoString(user.updatedAt),
    }),
  );
}

export async function resolveAuthenticatedPrincipal(
  requestHeaders: Headers,
  options: {
    readonly authentication?: Authentication;
    readonly getAuthentication?: () => Authentication;
    readonly logger?: Logger;
    readonly requestId?: string;
  } = {},
): Promise<AuthenticatedPrincipal | null> {
  let session: Awaited<ReturnType<Authentication['api']['getSession']>>;
  try {
    const authentication =
      options.authentication ?? (options.getAuthentication ?? getAuthentication)();
    session = await authentication.api.getSession({
      headers: requestHeaders,
      query: { disableCookieCache: true },
    });
  } catch (error) {
    throw new AuthenticationError(
      'O serviço de autenticação não está disponível.',
      'AUTHENTICATION_UNAVAILABLE',
      error,
    );
  }
  if (session === null) return null;

  let user: AuthenticatedUser;
  try {
    user = projectAuthenticatedUser(session.user);
  } catch (error) {
    throw new AuthenticationError(
      'A sessão autenticada não possui uma identidade autorizável.',
      'AUTHORIZATION_DENIED',
      error,
    );
  }

  const principal = Object.freeze({ userId: user.id, role: user.role, user });
  (options.logger ?? createLogger()).info('auth.session.accepted', {
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    userId: principal.userId,
    role: principal.role,
    outcome: 'AUTHENTICATED',
  });
  return principal;
}

export const authenticateRequest: RequestAuthenticator = async (request, requestId) => {
  const principal = await resolveAuthenticatedPrincipal(request.headers, { requestId });
  if (principal === null) {
    throw new AuthenticationError(
      'Autenticação é obrigatória para acessar este recurso.',
      'AUTHENTICATION_REQUIRED',
    );
  }
  return principal;
};

export async function getOptionalAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const principal = await resolveAuthenticatedPrincipal(await headers());
  return principal?.user ?? null;
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getOptionalAuthenticatedUser();
  if (user === null) redirect('/login');
  return user;
}
