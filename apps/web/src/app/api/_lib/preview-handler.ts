import type { Logger } from '@brq/shared/logger/logger';

import { previewIdSchema, previewStartInputSchema } from '@/api/preview-contracts';
import type { RequestAuthenticator } from '@/server/auth/contracts';
import { assertSameOriginMutation } from '@/server/auth/csrf';
import type { PreviewApplicationService } from '@/server/preview/contracts';
import { PreviewApplicationError } from '@/server/preview/contracts';

import { API_ENDPOINTS, API_ERROR_CODES, MAX_PREVIEW_PAYLOAD_BYTES } from './constants';
import type { RequestIdFactory } from './contracts';
import { createAuthenticatedRouteHandler } from './authenticated-route-handler';
import { HttpApiError } from './errors';
import { readJsonBody, rejectQueryParameters, rejectRequestBody } from './request';
import { previewControlResponse, previewSessionResponse } from './responses';
import { executionIdPathSchema } from './schemas';

export interface PreviewPathContext {
  readonly params: Promise<{ readonly id: string }>;
}

interface PreviewHandlerOptions {
  readonly authenticate: RequestAuthenticator;
  readonly getService: () => Promise<PreviewApplicationService>;
  readonly assertOrigin?: (request: Request) => void;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

function validateExecutionId(value: string): string {
  if (!executionIdPathSchema.safeParse(value).success) {
    throw new HttpApiError('O identificador da execução é inválido.', {
      code: API_ERROR_CODES.INVALID_REQUEST,
      status: 400,
      path: 'id',
    });
  }
  return value;
}

function validatePreviewId(value: string): string {
  if (!previewIdSchema.safeParse(value).success) {
    throw new HttpApiError('O identificador do Preview é inválido.', {
      code: API_ERROR_CODES.INVALID_REQUEST,
      status: 400,
      path: 'id',
    });
  }
  return value;
}

export function mapPreviewError(error: unknown, executionId?: string): never {
  if (error instanceof HttpApiError) throw error;
  if (!(error instanceof PreviewApplicationError)) {
    throw new HttpApiError('O serviço de Preview não está disponível.', {
      code: API_ERROR_CODES.PREVIEW_RUNTIME_UNAVAILABLE,
      status: 503,
      ...(executionId === undefined ? {} : { executionId }),
      cause: error,
    });
  }
  const status = {
    PREVIEW_NOT_ALLOWED: 404,
    PREVIEW_FACTORY_NOT_SUCCESS: 409,
    PREVIEW_ARTIFACT_UNAVAILABLE: 409,
    PREVIEW_PROFILE_UNSUPPORTED: 422,
    PREVIEW_POLICY_MISMATCH: 409,
    PREVIEW_CONFIGURATION_INVALID: 503,
    PREVIEW_CAPACITY_EXCEEDED: 503,
    PREVIEW_RUNTIME_UNAVAILABLE: 503,
    PREVIEW_IMAGE_VERIFICATION_FAILED: 503,
    PREVIEW_START_FAILED: 502,
    PREVIEW_START_TIMEOUT: 504,
    PREVIEW_HEALTHCHECK_FAILED: 502,
    PREVIEW_RUNTIME_LOST: 410,
    PREVIEW_STOP_FAILED: 502,
    PREVIEW_CLEANUP_FAILED: 500,
    PREVIEW_CONFLICT: 409,
  }[error.code];
  throw new HttpApiError(error.message, {
    code: error.code,
    status,
    ...(executionId === undefined ? {} : { executionId }),
    cause: error,
  });
}

export function createExecutionPreviewHandler(options: PreviewHandlerOptions) {
  return createAuthenticatedRouteHandler<PreviewPathContext>({
    endpoint: API_ENDPOINTS.EXECUTION_PREVIEW,
    allowedMethods: ['GET', 'POST'],
    ...options,
    async operation(request, context, requestId, principal) {
      rejectQueryParameters(request);
      const executionId = validateExecutionId((await context.params).id);
      try {
        const service = await options.getService();
        if (request.method === 'GET') {
          rejectRequestBody(request);
          return {
            response: previewControlResponse(
              await service.getExecutionControl(executionId, principal),
              requestId,
              executionId,
            ),
            executionId,
          };
        }
        (options.assertOrigin ?? assertSameOriginMutation)(request);
        const payload = await readJsonBody(request, MAX_PREVIEW_PAYLOAD_BYTES);
        const parsed = previewStartInputSchema.safeParse(payload);
        if (!parsed.success) {
          throw new HttpApiError('A solicitação de Preview é inválida.', {
            code: API_ERROR_CODES.INVALID_REQUEST,
            status: 400,
            path: parsed.error.issues[0]?.path.map(String).join('.') || 'body',
            executionId,
          });
        }
        const session = await service.start(executionId, principal, parsed.data, {
          requestId,
          signal: request.signal,
        });
        return {
          response: previewSessionResponse(session, requestId, 201),
          executionId,
        };
      } catch (error) {
        return mapPreviewError(error, executionId);
      }
    },
  });
}

export function createPreviewSessionHandler(options: PreviewHandlerOptions) {
  return createAuthenticatedRouteHandler<PreviewPathContext>({
    endpoint: API_ENDPOINTS.PREVIEW_BY_ID,
    allowedMethods: ['GET', 'DELETE'],
    ...options,
    async operation(request, context, requestId, principal) {
      rejectQueryParameters(request);
      rejectRequestBody(request);
      const previewId = validatePreviewId((await context.params).id);
      try {
        const service = await options.getService();
        if (request.method === 'DELETE')
          (options.assertOrigin ?? assertSameOriginMutation)(request);
        const session =
          request.method === 'GET'
            ? await service.get(previewId, principal)
            : await service.stop(previewId, principal, { requestId });
        if (session === null) {
          throw new HttpApiError('O Preview não foi encontrado.', {
            code: API_ERROR_CODES.PREVIEW_NOT_FOUND,
            status: 404,
          });
        }
        return { response: previewSessionResponse(session, requestId, 200) };
      } catch (error) {
        return mapPreviewError(error);
      }
    },
  });
}
