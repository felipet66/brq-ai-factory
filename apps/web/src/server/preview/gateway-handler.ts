import { PreviewGatewayError, type PreviewGatewayService } from './gateway-contracts';
import { applyPreviewSecurityHeaders, PREVIEW_ACCESS_COOKIE } from './gateway-headers';
import { previewIdFromRequestUrl } from './configuration';

const LOCAL_PREVIEW_COOKIE = 'brq-preview-local';
const MAX_REDEEM_BYTES = 1024;

function externalRequestUrl(request: Request): URL | null {
  const host = request.headers.get('host');
  if (host === null || host.includes(',') || /[\s/@\\]/u.test(host)) return null;
  try {
    const url = new URL(request.url);
    url.host = host;
    return url;
  } catch {
    return null;
  }
}

function plainError(status: number, message: string): Response {
  const headers = applyPreviewSecurityHeaders(
    new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
  );
  return new Response(message, { status, headers });
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}

async function readRedeemTicket(request: Request): Promise<string | null> {
  const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REDEEM_BYTES)) {
    return null;
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_REDEEM_BYTES) return null;
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const form = new URLSearchParams(body);
  if ([...form.keys()].some((key) => key !== 'ticket') || form.getAll('ticket').length !== 1) {
    return null;
  }
  const ticket = form.get('ticket');
  return ticket !== null && /^[A-Za-z0-9_-]{32,256}$/u.test(ticket) ? ticket : null;
}

function cookieName(origin: URL): string {
  return origin.protocol === 'https:' ? PREVIEW_ACCESS_COOKIE : LOCAL_PREVIEW_COOKIE;
}

function accessCookie(name: string, value: string, expiresAt: string, secure: boolean): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${new Date(expiresAt).toUTCString()}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function safeUpstreamResponse(response: Response, method: string): Response {
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'etag', 'last-modified', 'location']) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  applyPreviewSecurityHeaders(headers);
  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createPreviewGatewayHandler(options: {
  readonly getOriginTemplate: () => string;
  readonly getService: () => Promise<PreviewGatewayService>;
}) {
  return async (request: Request): Promise<Response> => {
    const externalUrl = externalRequestUrl(request);
    if (externalUrl === null) return plainError(400, 'Invalid Preview host.');
    let originTemplate: string;
    try {
      originTemplate = options.getOriginTemplate();
    } catch {
      return plainError(503, 'Preview configuration unavailable.');
    }
    const previewId = previewIdFromRequestUrl(originTemplate, externalUrl.href);
    if (previewId === null) return plainError(404, 'Preview not found.');
    let service: PreviewGatewayService;
    try {
      service = await options.getService();
    } catch {
      return plainError(503, 'Preview gateway unavailable.');
    }

    if (externalUrl.pathname === '/_brq/redeem') {
      if (request.method !== 'POST') return plainError(405, 'Method not allowed.');
      let ticket: string | null;
      try {
        ticket = await readRedeemTicket(request);
      } catch {
        return plainError(400, 'Invalid access grant.');
      }
      if (ticket === null) return plainError(400, 'Invalid access grant.');
      let redeemed;
      try {
        redeemed = await service.redeem(previewId, ticket);
      } catch {
        return plainError(503, 'Preview gateway unavailable.');
      }
      if (redeemed === null) return plainError(401, 'Preview access denied.');
      const name = cookieName(externalUrl);
      const headers = applyPreviewSecurityHeaders(new Headers({ location: externalUrl.origin }));
      headers.append(
        'set-cookie',
        accessCookie(
          name,
          redeemed.cookieValue,
          redeemed.expiresAt,
          externalUrl.protocol === 'https:',
        ),
      );
      return new Response(null, { status: 303, headers });
    }

    if (!['GET', 'HEAD'].includes(request.method) || request.headers.has('upgrade')) {
      return plainError(405, 'Method not allowed.');
    }
    const access = readCookie(request, cookieName(externalUrl));
    if (access === null) return plainError(401, 'Preview access required.');
    try {
      const response = await service.proxy({
        previewId,
        method: request.method as 'GET' | 'HEAD',
        pathname: externalUrl.pathname,
        search: externalUrl.search,
        accessCookie: access,
        headers: request.headers,
        signal: request.signal,
      });
      return safeUpstreamResponse(response, request.method);
    } catch (error) {
      if (error instanceof PreviewGatewayError) {
        return plainError(error.status, error.message);
      }
      return plainError(503, 'Preview gateway unavailable.');
    }
  };
}
