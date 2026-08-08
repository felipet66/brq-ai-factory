import { z } from 'zod';

import {
  authenticatedUserSchema,
  loginCredentialsSchema,
  type AuthenticatedUser,
  type LoginCredentials,
} from './auth-contracts';

const LOGIN_ENDPOINT = '/api/auth/login';
const LOGOUT_ENDPOINT = '/api/auth/logout';

const semanticVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );

const responseMetadataSchema = z
  .object({
    requestId: z.string().regex(/^request-[0-9a-f-]{36}$/),
    apiVersion: semanticVersionSchema,
  })
  .strict();

const loginResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ user: authenticatedUserSchema }).strict(),
    metadata: responseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

const logoutResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ loggedOut: z.literal(true) }).strict(),
    metadata: responseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

const errorResponseSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    metadata: responseMetadataSchema,
    errors: z
      .array(
        z
          .object({
            code: z.string().min(1).max(128),
            message: z.string().min(1).max(300),
            path: z.string().min(1).max(256).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AuthClientOptions {
  readonly signal?: AbortSignal;
  readonly fetchImplementation?: FetchImplementation;
}

export type AuthClientErrorCode =
  'INVALID_INPUT' | 'REQUEST_ABORTED' | 'NETWORK_ERROR' | 'API_ERROR' | 'INVALID_RESPONSE';

interface AuthClientErrorOptions {
  readonly code: AuthClientErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly cause?: unknown;
}

export class AuthClientError extends Error {
  readonly code: AuthClientErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(message: string, options: AuthClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'AuthClientError';
    this.code = options.code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function request(
  endpoint: string,
  init: RequestInit,
  options: AuthClientOptions,
): Promise<Response> {
  if (isSignalAborted(options.signal)) {
    throw new AuthClientError('A solicitação de autenticação foi cancelada.', {
      code: 'REQUEST_ABORTED',
    });
  }

  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  try {
    return await fetchImplementation(endpoint, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (isSignalAborted(options.signal) || isAbortError(error)) {
      throw new AuthClientError('A solicitação de autenticação foi cancelada.', {
        code: 'REQUEST_ABORTED',
        cause: error,
      });
    }
    throw new AuthClientError('Não foi possível conectar ao serviço de autenticação.', {
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new AuthClientError('A resposta do serviço de autenticação é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }

  try {
    return await response.json();
  } catch (error) {
    throw new AuthClientError('A resposta do serviço de autenticação é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      cause: error,
    });
  }
}

async function parseResponse<Output>(
  response: Response,
  schema: z.ZodType<Output>,
): Promise<Output> {
  const payload = await parseJson(response);
  if (!response.ok) {
    const parsedError = errorResponseSchema.safeParse(payload);
    if (!parsedError.success) {
      throw new AuthClientError('A autenticação não pôde ser concluída.', {
        code: 'API_ERROR',
        status: response.status,
      });
    }
    throw new AuthClientError(parsedError.data.errors[0]!.message, {
      code: 'API_ERROR',
      status: response.status,
      requestId: parsedError.data.metadata.requestId,
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AuthClientError('A resposta do serviço de autenticação é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function projectAuthenticatedUser(
  user: z.output<typeof authenticatedUserSchema>,
): AuthenticatedUser {
  return Object.freeze({ ...user });
}

export async function login(
  credentials: LoginCredentials,
  options: AuthClientOptions = {},
): Promise<AuthenticatedUser> {
  const parsedCredentials = loginCredentialsSchema.safeParse(credentials);
  if (!parsedCredentials.success) {
    throw new AuthClientError('Informe email e senha válidos.', {
      code: 'INVALID_INPUT',
      cause: parsedCredentials.error,
    });
  }

  const response = await request(
    LOGIN_ENDPOINT,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(parsedCredentials.data),
    },
    options,
  );
  const envelope = await parseResponse(response, loginResponseSchema);
  return projectAuthenticatedUser(envelope.data.user);
}

export async function logout(options: AuthClientOptions = {}): Promise<void> {
  const response = await request(
    LOGOUT_ENDPOINT,
    {
      method: 'POST',
      headers: { accept: 'application/json' },
    },
    options,
  );
  await parseResponse(response, logoutResponseSchema);
}
