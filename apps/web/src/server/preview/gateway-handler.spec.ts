import { describe, expect, it, vi } from 'vitest';

import { PreviewGatewayError, type PreviewGatewayService } from './gateway-contracts';
import { createPreviewGatewayHandler } from './gateway-handler';

const previewId = `preview-${'1'.repeat(32)}`;
const template = 'http://{previewId}.preview.localhost:3000';
const previewHost = `${previewId}.preview.localhost:3000`;

function service(overrides: Partial<PreviewGatewayService> = {}): PreviewGatewayService {
  return {
    redeem: vi.fn(async () => ({
      cookieValue: 'signed-preview-cookie',
      expiresAt: '2026-08-10T00:10:00.000Z',
    })),
    proxy: vi.fn(
      async () =>
        new Response('<h1>Generated application</h1>', {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'set-cookie': 'attacker=1',
            server: 'internal-target',
            'access-control-allow-origin': '*',
          },
        }),
    ),
    ...overrides,
  };
}

function handler(previewService: PreviewGatewayService) {
  return createPreviewGatewayHandler({
    getOriginTemplate: () => template,
    getService: async () => previewService,
  });
}

function previewRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('host', previewHost);
  return new Request(`http://localhost:3000${path}`, { ...init, headers });
}

describe('Preview gateway', () => {
  it('rejects direct access through the authenticated Factory host', async () => {
    const response = await handler(service())(
      new Request('http://localhost:3000/api/_preview-gateway/forged', {
        headers: { host: 'localhost:3000' },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('atomically redeems a one-time ticket into a host-only local cookie', async () => {
    const previewService = service();
    const response = await handler(previewService)(
      previewRequest('/_brq/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `ticket=${'t'.repeat(43)}`,
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`http://${previewHost}`);
    expect(response.headers.get('set-cookie')).toContain('brq-preview-local=signed-preview-cookie');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).not.toContain('Domain=');
    expect(previewService.redeem).toHaveBeenCalledWith(previewId, 't'.repeat(43));
  });

  it('rejects malformed hosts and malformed or denied redemption grants', async () => {
    const previewService = service();
    const invalidHost = new Request('http://localhost:3000/', {
      headers: { host: `${previewHost},attacker.invalid` },
    });
    expect((await handler(previewService)(invalidHost)).status).toBe(400);

    const invalidRequests = [
      previewRequest('/_brq/redeem', { method: 'GET' }),
      previewRequest('/_brq/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      previewRequest('/_brq/redeem', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': '1025',
        },
        body: `ticket=${'t'.repeat(43)}`,
      }),
      previewRequest('/_brq/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `ticket=${'t'.repeat(43)}&ticket=${'u'.repeat(43)}`,
      }),
      previewRequest('/_brq/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'ticket=too-short',
      }),
    ];
    for (const request of invalidRequests) {
      expect((await handler(previewService)(request)).status).toBe(
        request.method === 'GET' ? 405 : 400,
      );
    }
    expect(previewService.redeem).not.toHaveBeenCalled();

    const deniedService = service({ redeem: vi.fn(async () => null) });
    const denied = await handler(deniedService)(
      previewRequest('/_brq/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `ticket=${'v'.repeat(43)}`,
      }),
    );
    expect(denied.status).toBe(401);
  });

  it('uses a Secure __Host cookie on HTTPS and strips bodies from HEAD responses', async () => {
    const secureTemplate = 'https://{previewId}.preview.example.test';
    const secureHost = `${previewId}.preview.example.test`;
    const previewService = service();
    const secureHandler = createPreviewGatewayHandler({
      getOriginTemplate: () => secureTemplate,
      getService: async () => previewService,
    });
    const redeemed = await secureHandler(
      new Request(`https://${secureHost}/_brq/redeem`, {
        method: 'POST',
        headers: {
          host: secureHost,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: `ticket=${'w'.repeat(43)}`,
      }),
    );
    expect(redeemed.headers.get('set-cookie')).toContain('__Host-brq-preview=');
    expect(redeemed.headers.get('set-cookie')).toContain('Secure');

    const head = await secureHandler(
      new Request(`https://${secureHost}/index.html`, {
        method: 'HEAD',
        headers: {
          host: secureHost,
          cookie: '__Host-brq-preview=signed-preview-cookie',
        },
      }),
    );
    expect(head.status).toBe(200);
    await expect(head.text()).resolves.toBe('');
    expect(previewService.proxy).toHaveBeenCalledWith(expect.objectContaining({ method: 'HEAD' }));
  });

  it('requires the isolated access cookie and never trusts an obscure URL', async () => {
    const response = await handler(service())(previewRequest('/'));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('localhost');
  });

  it('proxies only GET/HEAD and replaces untrusted response security headers', async () => {
    const previewService = service();
    const response = await handler(previewService)(
      previewRequest('/assets/app.js?version=1', {
        headers: {
          cookie: 'brq-preview-local=signed-preview-cookie',
          authorization: 'Bearer factory-secret',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Generated application');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('server')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("worker-src 'none'");
    expect(previewService.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        previewId,
        method: 'GET',
        pathname: '/assets/app.js',
        search: '?version=1',
        accessCookie: 'signed-preview-cookie',
      }),
    );

    const rejected = await handler(previewService)(
      previewRequest('/', {
        method: 'POST',
        headers: { cookie: 'brq-preview-local=signed-preview-cookie' },
      }),
    );
    expect(rejected.status).toBe(405);
  });

  it('sanitizes runtime failure without revealing the upstream target', async () => {
    const response = await handler(
      service({ proxy: vi.fn(async () => Promise.reject(new Error('127.0.0.1:49152'))) }),
    )(
      previewRequest('/', {
        headers: { cookie: 'brq-preview-local=signed-preview-cookie' },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('49152');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('preserves classified gateway failures and contains composition or redemption failures', async () => {
    const classified = await handler(
      service({
        proxy: vi.fn(async () => {
          throw new PreviewGatewayError('Preview runtime unavailable.', 502);
        }),
      }),
    )(
      previewRequest('/', {
        headers: { cookie: 'brq-preview-local=signed-preview-cookie' },
      }),
    );
    expect(classified.status).toBe(502);

    const compositionFailure = createPreviewGatewayHandler({
      getOriginTemplate: () => template,
      getService: async () => Promise.reject(new Error('private Docker host')),
    });
    const unavailable = await compositionFailure(previewRequest('/'));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain('Docker');
    expect(unavailable.headers.get('content-security-policy')).toContain("default-src 'none'");

    const redemptionFailure = await handler(
      service({ redeem: vi.fn(async () => Promise.reject(new Error('private ticket row'))) }),
    )(
      previewRequest('/_brq/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `ticket=${'t'.repeat(43)}`,
      }),
    );
    expect(redemptionFailure.status).toBe(503);
    expect(await redemptionFailure.text()).not.toContain('ticket row');
  });
});
