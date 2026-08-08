import {
  PROMPT_INSPECTOR_ERROR_CODES,
  PromptInspectorError,
  promptInspectionCatalogSchema,
  promptInspectionPreviewRequestSchema,
  promptInspectionPreviewResultSchema,
  promptInspectionValidateRequestSchema,
  promptInspectionValidationResultSchema,
  type PromptInspector,
} from '@brq/prompt-inspector';
import { createLogger, type Logger } from '@brq/shared/logger/logger';

import type { AuthenticatedPrincipal, RequestAuthenticator } from '@/server/auth/contracts';
import { assertSameOriginMutation } from '@/server/auth/csrf';
import { AuthenticationError } from '@/server/auth/errors';

import { createAuthenticatedRouteHandler } from './authenticated-route-handler';
import {
  API_ENDPOINTS,
  API_ERROR_CODES,
  MAX_PLAYGROUND_PREVIEW_PAYLOAD_BYTES,
  MAX_PLAYGROUND_VALIDATION_PAYLOAD_BYTES,
} from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { playgroundSuccessResponse } from './playground-responses';
import { readJsonBody, rejectQueryParameters, rejectRequestBody } from './request';

type PromptInspectorFactory = () => Promise<PromptInspector>;

interface PlaygroundHandlerOptions {
  readonly authenticate: RequestAuthenticator;
  readonly getPromptInspector: PromptInspectorFactory;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
  readonly expectedOrigin?: string;
}

function requireAdministrator(principal: AuthenticatedPrincipal): void {
  if (principal.role !== 'ADMIN') {
    throw new AuthenticationError(
      'Acesso administrativo é obrigatório para este recurso.',
      'AUTHORIZATION_DENIED',
    );
  }
}

function requireActiveRequest(request: Request): void {
  if (request.signal.aborted) {
    throw new HttpApiError('A requisição foi cancelada.', {
      code: API_ERROR_CODES.REQUEST_ABORTED,
      status: 408,
    });
  }
}

function invalidRequest(error: { issues: readonly { path: PropertyKey[] }[] }): HttpApiError {
  const path = error.issues[0]?.path.map(String).join('.') || 'body';
  return new HttpApiError('A requisição do Prompt Playground é inválida.', {
    code: API_ERROR_CODES.INVALID_REQUEST,
    status: 400,
    path,
  });
}

function mapInspectionError(error: unknown): HttpApiError {
  if (error instanceof HttpApiError) return error;
  if (!(error instanceof PromptInspectorError)) {
    return new HttpApiError('O Prompt Playground não está disponível.', {
      code: API_ERROR_CODES.PLAYGROUND_UNAVAILABLE,
      status: 503,
      cause: error,
    });
  }

  switch (error.code) {
    case PROMPT_INSPECTOR_ERROR_CODES.INVALID_INPUT:
    case PROMPT_INSPECTOR_ERROR_CODES.UNKNOWN_AGENT:
      return new HttpApiError('A requisição do Prompt Playground é inválida.', {
        code: API_ERROR_CODES.INVALID_REQUEST,
        status: 400,
        cause: error,
      });
    case PROMPT_INSPECTOR_ERROR_CODES.CANCELLED:
      return new HttpApiError('A requisição foi cancelada.', {
        code: API_ERROR_CODES.REQUEST_ABORTED,
        status: 408,
        cause: error,
      });
    case PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED:
      return new HttpApiError('A inspeção não pôde ser concluída.', {
        code: API_ERROR_CODES.PLAYGROUND_INSPECTION_FAILED,
        status: 422,
        cause: error,
      });
    case PROMPT_INSPECTOR_ERROR_CODES.INVALID_CONFIGURATION:
      return new HttpApiError('O Prompt Playground não está disponível.', {
        code: API_ERROR_CODES.PLAYGROUND_UNAVAILABLE,
        status: 503,
        cause: error,
      });
  }
}

async function resolvePromptInspector(factory: PromptInspectorFactory): Promise<PromptInspector> {
  try {
    return await factory();
  } catch (error) {
    throw mapInspectionError(error);
  }
}

async function inspect<Result>(operation: () => Promise<Result> | Result): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw mapInspectionError(error);
  }
}

export function createPlaygroundAgentsHandler(options: PlaygroundHandlerOptions) {
  const logger = options.logger ?? createLogger();
  return createAuthenticatedRouteHandler<unknown>({
    endpoint: API_ENDPOINTS.PLAYGROUND_AGENTS,
    allowedMethods: ['GET'],
    ...options,
    logger,
    async operation(request, _context, requestId, principal) {
      requireAdministrator(principal);
      rejectQueryParameters(request);
      rejectRequestBody(request);
      requireActiveRequest(request);

      const inspector = await resolvePromptInspector(options.getPromptInspector);
      const catalog = await inspect(() => promptInspectionCatalogSchema.parse(inspector.catalog()));
      requireActiveRequest(request);
      logger.info('playground.agents.completed', {
        requestId,
        userId: principal.userId,
        agentCount: catalog.agents.length,
        status: 'SUCCESS',
      });
      return { response: playgroundSuccessResponse(catalog, requestId) };
    },
  });
}

export function createPlaygroundPreviewHandler(options: PlaygroundHandlerOptions) {
  const logger = options.logger ?? createLogger();
  return createAuthenticatedRouteHandler<unknown>({
    endpoint: API_ENDPOINTS.PLAYGROUND_PREVIEW,
    allowedMethods: ['POST'],
    ...options,
    logger,
    async operation(request, _context, requestId, principal) {
      requireAdministrator(principal);
      assertSameOriginMutation(request, options.expectedOrigin);
      rejectQueryParameters(request);
      requireActiveRequest(request);

      const rawBody = await readJsonBody(request, MAX_PLAYGROUND_PREVIEW_PAYLOAD_BYTES);
      const parsedRequest = promptInspectionPreviewRequestSchema.safeParse(rawBody);
      if (!parsedRequest.success) throw invalidRequest(parsedRequest.error);

      const inspector = await resolvePromptInspector(options.getPromptInspector);
      const rawResult = await inspect(() =>
        inspector.preview(parsedRequest.data, { signal: request.signal }),
      );
      const result = await inspect(() => promptInspectionPreviewResultSchema.parse(rawResult));
      requireActiveRequest(request);
      logger.info('playground.preview.completed', {
        requestId,
        userId: principal.userId,
        agent: result.agent,
        status: result.status,
        ...(result.status === 'BUILT'
          ? {
              promptHash: result.hashes.promptHash,
              usedBytes: result.budget.usedBytes,
              maxBytes: result.budget.maxBytes,
            }
          : { error: { code: result.error.code } }),
      });
      return { response: playgroundSuccessResponse(result, requestId) };
    },
  });
}

export function createPlaygroundValidateHandler(options: PlaygroundHandlerOptions) {
  const logger = options.logger ?? createLogger();
  return createAuthenticatedRouteHandler<unknown>({
    endpoint: API_ENDPOINTS.PLAYGROUND_VALIDATE,
    allowedMethods: ['POST'],
    ...options,
    logger,
    async operation(request, _context, requestId, principal) {
      requireAdministrator(principal);
      assertSameOriginMutation(request, options.expectedOrigin);
      rejectQueryParameters(request);
      requireActiveRequest(request);

      const rawBody = await readJsonBody(request, MAX_PLAYGROUND_VALIDATION_PAYLOAD_BYTES);
      const parsedRequest = promptInspectionValidateRequestSchema.safeParse(rawBody);
      if (!parsedRequest.success) throw invalidRequest(parsedRequest.error);

      const inspector = await resolvePromptInspector(options.getPromptInspector);
      const rawResult = await inspect(() =>
        inspector.validate(parsedRequest.data, { signal: request.signal }),
      );
      const result = await inspect(() => promptInspectionValidationResultSchema.parse(rawResult));
      requireActiveRequest(request);
      logger.info('playground.validation.completed', {
        requestId,
        userId: principal.userId,
        agent: result.agent,
        status: result.status,
        candidateHash: result.candidateHash,
      });
      return { response: playgroundSuccessResponse(result, requestId) };
    },
  });
}
