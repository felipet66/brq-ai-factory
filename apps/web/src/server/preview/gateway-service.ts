import type {
  PreviewAccessTicketRepository,
  PreviewPersistenceRepository,
} from '@brq/execution-repository';
import {
  PREVIEW_RUNTIME_GATEWAY_ACCESS_HEADER,
  type PreviewRuntimeGatewayLocator,
} from '@brq/preview-runner';

import {
  hashPreviewAccessTicket,
  signPreviewAccessCookie,
  verifyPreviewAccessCookie,
} from './access-credentials';
import {
  PreviewGatewayError,
  type PreviewGatewayRequest,
  type PreviewGatewayService,
} from './gateway-contracts';

const SAFE_PATH = /^\/(?!\/)[^\u0000-\u001F\u007F\\]{0,2047}$/u;
const SAFE_SEARCH = /^\?[^\u0000-\u001F\u007F#\\]{0,2047}$/u;

interface CreatePreviewGatewayServiceOptions {
  readonly redeemRepository: PreviewAccessTicketRepository;
  readonly sessionRepository: PreviewPersistenceRepository;
  readonly locator: PreviewRuntimeGatewayLocator;
  readonly cookieSecret: string;
  readonly now?: () => number;
  readonly fetchImplementation?: typeof fetch;
}

function observedAt(now: () => number): string {
  const value = now();
  if (!Number.isFinite(value) || value < 0) {
    throw new PreviewGatewayError('Preview gateway unavailable.', 502);
  }
  return new Date(Math.round(value)).toISOString();
}

function safeRequestPath(request: PreviewGatewayRequest): string {
  if (
    !SAFE_PATH.test(request.pathname) ||
    request.pathname === '/_brq/redeem' ||
    (request.search !== '' && !SAFE_SEARCH.test(request.search))
  ) {
    throw new PreviewGatewayError('Preview resource not found.', 404);
  }
  return `${request.pathname}${request.search}`;
}

async function boundedResponse(
  response: Response,
  maximumBytes: number,
  method: 'GET' | 'HEAD',
): Promise<Response> {
  if (response.status >= 300 && response.status < 400) {
    throw new PreviewGatewayError('Preview redirects are not supported.', 502);
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw new PreviewGatewayError('Preview response exceeded its limit.', 502);
  }
  if (method === 'HEAD' || response.body === null) return new Response(null, response);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new PreviewGatewayError('Preview response exceeded its limit.', 502);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function timeoutSignal(
  source: AbortSignal,
  milliseconds: number,
): {
  readonly signal: AbortSignal;
  readonly release: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('PREVIEW_RESPONSE_TIMEOUT'), milliseconds);
  timeout.unref?.();
  const abort = () => controller.abort(source.reason);
  source.addEventListener('abort', abort, { once: true });
  if (source.aborted) abort();
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timeout);
      source.removeEventListener('abort', abort);
    },
  };
}

export function createPreviewGatewayService(
  options: CreatePreviewGatewayServiceOptions,
): PreviewGatewayService {
  if (options.cookieSecret.length < 32) {
    throw new TypeError('O segredo dedicado do Preview gateway é inválido.');
  }
  const now = options.now ?? Date.now;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  const service: PreviewGatewayService = {
    async redeem(previewId, ticket) {
      let ticketHash: string;
      try {
        ticketHash = hashPreviewAccessTicket(ticket);
      } catch {
        return null;
      }
      const current = observedAt(now);
      const redemption = await options.redeemRepository.consumeAccessTicket({
        ticketHash,
        consumedAt: current,
      });
      if (redemption === null || redemption.previewId !== previewId) return null;
      const session = await options.sessionRepository.getByPreviewId(previewId);
      if (
        session === null ||
        session.status !== 'RUNNING' ||
        session.executionId !== redemption.executionId ||
        Date.parse(session.expiresAt) <= Date.parse(current) ||
        Date.parse(redemption.expiresAt) > Date.parse(session.expiresAt)
      ) {
        return null;
      }
      return Object.freeze({
        cookieValue: signPreviewAccessCookie(
          {
            version: 1,
            previewId,
            executionId: redemption.executionId,
            ownerUserId: redemption.ownerUserId,
            expiresAt: redemption.expiresAt,
          },
          options.cookieSecret,
        ),
        expiresAt: redemption.expiresAt,
      });
    },

    async proxy(request) {
      const current = observedAt(now);
      const claims = verifyPreviewAccessCookie(request.accessCookie, options.cookieSecret, current);
      if (claims === null || claims.previewId !== request.previewId) {
        throw new PreviewGatewayError('Preview access required.', 401);
      }
      const session = await options.sessionRepository.getByPreviewId(request.previewId);
      if (
        session === null ||
        session.executionId !== claims.executionId ||
        session.status !== 'RUNNING'
      ) {
        throw new PreviewGatewayError('Preview access is no longer active.', 410);
      }
      if (
        Date.parse(session.expiresAt) <= Date.parse(current) ||
        Date.parse(claims.expiresAt) > Date.parse(session.expiresAt)
      ) {
        throw new PreviewGatewayError('Preview access expired.', 410);
      }
      const target = await options.locator.resolveGatewayTarget({
        previewId: request.previewId,
        executionId: session.executionId,
      });
      if (
        target === null ||
        target.host !== '127.0.0.1' ||
        !Number.isInteger(target.port) ||
        target.port < 1 ||
        target.port > 65_535 ||
        !/^[A-Za-z0-9_-]{43,128}$/u.test(target.accessToken) ||
        !Number.isFinite(Date.parse(target.expiresAt)) ||
        Date.parse(target.expiresAt) <= Date.parse(current)
      ) {
        throw new PreviewGatewayError('Preview runtime unavailable.', 502);
      }
      const requestPath = safeRequestPath(request);
      const timeout = timeoutSignal(request.signal, session.limits.responseTimeoutMs);
      try {
        const accept = request.headers.get('accept');
        const response = await fetchImplementation(
          `http://${target.host}:${target.port}${requestPath}`,
          {
            method: request.method,
            headers: {
              ...(accept === null || accept.length > 512 ? {} : { accept }),
              [PREVIEW_RUNTIME_GATEWAY_ACCESS_HEADER]: target.accessToken,
              'user-agent': 'brq-preview-gateway/1.0',
            },
            redirect: 'manual',
            signal: timeout.signal,
          },
        );
        return await boundedResponse(response, session.limits.responseBytes, request.method);
      } catch (error) {
        if (error instanceof PreviewGatewayError) throw error;
        if (timeout.signal.aborted && !request.signal.aborted) {
          throw new PreviewGatewayError('Preview response timed out.', 504, error);
        }
        throw new PreviewGatewayError('Preview runtime unavailable.', 502, error);
      } finally {
        timeout.release();
      }
    },
  };
  return Object.freeze(service);
}
