import { createLogger, type Logger } from '@brq/shared/logger/logger';
import { isAPIError } from 'better-auth/api';

import type { Authentication } from '@/server/auth/auth';
import { getAuthentication } from '@/server/auth/auth';
import { assertSameOriginMutation } from '@/server/auth/csrf';
import { AuthenticationError } from '@/server/auth/errors';
import { projectAuthenticatedUser } from '@/server/auth/session';

import { API_ENDPOINTS, API_ERROR_CODES, MAX_AUTHENTICATION_PAYLOAD_BYTES } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { readJsonBody, rejectQueryParameters, rejectRequestBody } from './request';
import { loginSuccessResponse, logoutSuccessResponse } from './responses';
import { createRouteHandler } from './route-handler';
import { loginHttpRequestSchema } from './schemas';

interface AuthenticationHandlerOptions {
  readonly getAuthentication?: () => Authentication;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
  readonly expectedOrigin?: string;
}

function resolveAuthentication(factory: () => Authentication): Authentication {
  try {
    return factory();
  } catch (error) {
    throw new AuthenticationError(
      'O serviço de autenticação não está disponível.',
      'AUTHENTICATION_UNAVAILABLE',
      error,
    );
  }
}

function getSetCookieValues(headers: Headers): readonly string[] {
  const enhancedHeaders = headers as Headers & {
    readonly getSetCookie?: () => string[];
  };
  const values = enhancedHeaders.getSetCookie?.();
  if (values !== undefined) return Object.freeze([...values]);
  const value = headers.get('set-cookie');
  return value === null ? Object.freeze([]) : Object.freeze([value]);
}

function invalidCredentials(error: unknown): HttpApiError {
  return new HttpApiError('Email ou senha inválidos.', {
    code: API_ERROR_CODES.AUTHENTICATION_INVALID_CREDENTIALS,
    status: 401,
    cause: error,
  });
}

function unavailableAuthentication(error: unknown): AuthenticationError {
  return new AuthenticationError(
    'O serviço de autenticação não está disponível.',
    'AUTHENTICATION_UNAVAILABLE',
    error,
  );
}

export function createLoginHandler(options: AuthenticationHandlerOptions = {}) {
  const logger = options.logger ?? createLogger();
  return createRouteHandler<unknown>({
    endpoint: API_ENDPOINTS.AUTH_LOGIN,
    allowedMethods: ['POST'],
    logger,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.requestIdFactory === undefined
      ? {}
      : { requestIdFactory: options.requestIdFactory }),
    async operation(request, _context, requestId) {
      assertSameOriginMutation(request, options.expectedOrigin);
      rejectQueryParameters(request);
      const rawBody = await readJsonBody(request, MAX_AUTHENTICATION_PAYLOAD_BYTES);
      const parsed = loginHttpRequestSchema.safeParse(rawBody);
      if (!parsed.success) {
        const path = parsed.error.issues[0]?.path.map(String).join('.') || 'body';
        throw new HttpApiError('As credenciais informadas são inválidas.', {
          code: API_ERROR_CODES.INVALID_REQUEST,
          status: 400,
          path,
        });
      }

      const authentication = resolveAuthentication(options.getAuthentication ?? getAuthentication);
      let outcome: Awaited<ReturnType<Authentication['api']['signInEmail']>>;
      let responseHeaders: Headers;
      try {
        const result = await authentication.api.signInEmail({
          body: { ...parsed.data, rememberMe: true },
          headers: request.headers,
          returnHeaders: true,
        });
        outcome = result.response;
        responseHeaders = result.headers;
      } catch (error) {
        if (isAPIError(error) && error.statusCode >= 400 && error.statusCode < 500) {
          throw invalidCredentials(error);
        }
        throw unavailableAuthentication(error);
      }

      let user;
      try {
        user = projectAuthenticatedUser(outcome.user);
      } catch (error) {
        throw unavailableAuthentication(error);
      }
      logger.info('auth.login.succeeded', {
        requestId,
        userId: user.id,
        role: user.role,
        outcome: 'AUTHENTICATED',
      });
      return {
        response: loginSuccessResponse(user, requestId, getSetCookieValues(responseHeaders)),
      };
    },
  });
}

export function createLogoutHandler(options: AuthenticationHandlerOptions = {}) {
  const logger = options.logger ?? createLogger();
  return createRouteHandler<unknown>({
    endpoint: API_ENDPOINTS.AUTH_LOGOUT,
    allowedMethods: ['POST'],
    logger,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.requestIdFactory === undefined
      ? {}
      : { requestIdFactory: options.requestIdFactory }),
    async operation(request, _context, requestId) {
      assertSameOriginMutation(request, options.expectedOrigin);
      rejectQueryParameters(request);
      rejectRequestBody(request);

      const authentication = resolveAuthentication(options.getAuthentication ?? getAuthentication);
      let responseHeaders: Headers;
      try {
        const session = await authentication.api.getSession({
          headers: request.headers,
          query: { disableCookieCache: true },
        });
        if (session !== null) {
          const revocation = await authentication.api.revokeSession({
            body: { token: session.session.token },
            headers: request.headers,
          });
          if (!revocation.status) {
            throw new TypeError('Authentication session revocation was rejected.');
          }
        }
        const result = await authentication.api.signOut({
          headers: request.headers,
          returnHeaders: true,
        });
        if (!result.response.success) throw new TypeError('Authentication sign-out was rejected.');
        responseHeaders = result.headers;
      } catch (error) {
        throw unavailableAuthentication(error);
      }

      logger.info('auth.logout.succeeded', {
        requestId,
        outcome: 'SIGNED_OUT',
      });
      return {
        response: logoutSuccessResponse(requestId, getSetCookieValues(responseHeaders)),
      };
    },
  });
}
