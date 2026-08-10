import { randomBytes } from 'node:crypto';

import type { Logger } from '@brq/shared/logger/logger';

import { previewIdSchema } from '@/api/preview-contracts';
import type { RequestAuthenticator } from '@/server/auth/contracts';
import { assertSameOriginMutation } from '@/server/auth/csrf';
import type { PreviewApplicationService } from '@/server/preview/contracts';

import { API_ERROR_CODES } from './constants';
import type { RequestIdFactory } from './contracts';
import { createAuthenticatedRouteHandler } from './authenticated-route-handler';
import { HttpApiError } from './errors';
import { rejectQueryParameters, requireEmptyRequestBody } from './request';
import { mapPreviewError } from './preview-handler';

interface LaunchContext {
  readonly params: Promise<{ readonly id: string }>;
}

interface PreviewLaunchHandlerOptions {
  readonly authenticate: RequestAuthenticator;
  readonly getService: () => Promise<PreviewApplicationService>;
  readonly assertOrigin?: (request: Request) => void;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
  readonly nonceFactory?: () => string;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function launchResponse(
  redeemUrl: string,
  ticket: string,
  requestId: string,
  nonce: string,
): Response {
  const target = new URL(redeemUrl);
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username !== '' ||
    target.password !== ''
  ) {
    throw new HttpApiError('A origem do Preview é inválida.', {
      code: API_ERROR_CODES.PREVIEW_CONFIGURATION_INVALID,
      status: 503,
    });
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(ticket)) {
    throw new HttpApiError('O acesso temporário ao Preview é inválido.', {
      code: API_ERROR_CODES.PREVIEW_CONFIGURATION_INVALID,
      status: 503,
    });
  }
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>Opening isolated build…</title></head><body>
<main><h1>Opening isolated build…</h1><p>The one-time access grant is being verified.</p>
<form id="launch" method="post" action="${htmlEscape(target.href)}">
<input type="hidden" name="ticket" value="${htmlEscape(ticket)}">
<noscript><button type="submit">Open build</button></noscript></form></main>
<script nonce="${htmlEscape(nonce)}">document.getElementById('launch').submit()</script>
</body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${target.origin}; base-uri 'none'; frame-ancestors 'none'`,
      'content-type': 'text/html; charset=utf-8',
      'cross-origin-opener-policy': 'same-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'x-request-id': requestId,
    },
  });
}

export function createPreviewLaunchHandler(options: PreviewLaunchHandlerOptions) {
  const nonceFactory = options.nonceFactory ?? (() => randomBytes(18).toString('base64url'));
  return createAuthenticatedRouteHandler<LaunchContext>({
    endpoint: '/previews/[id]/launch',
    allowedMethods: ['POST'],
    ...options,
    async operation(request, context, requestId, principal) {
      (options.assertOrigin ?? assertSameOriginMutation)(request);
      rejectQueryParameters(request);
      await requireEmptyRequestBody(request);
      const previewId = (await context.params).id;
      if (!previewIdSchema.safeParse(previewId).success) {
        throw new HttpApiError('O identificador do Preview é inválido.', {
          code: API_ERROR_CODES.INVALID_REQUEST,
          status: 400,
          path: 'id',
        });
      }
      try {
        const grant = await (
          await options.getService()
        ).createLaunch(previewId, principal, {
          requestId,
        });
        if (grant === null) {
          throw new HttpApiError('O Preview não foi encontrado.', {
            code: API_ERROR_CODES.PREVIEW_NOT_FOUND,
            status: 404,
          });
        }
        return {
          response: launchResponse(grant.redeemUrl, grant.ticket, requestId, nonceFactory()),
        };
      } catch (error) {
        if (error instanceof HttpApiError) throw error;
        return mapPreviewError(error);
      }
    },
  });
}
