import type {
  PreviewAccessTicketRepository,
  PreviewPersistenceRepository,
} from '@brq/execution-repository';
import { createRunningPreviewSessionFixture } from '@brq/preview-runner/testing';
import { describe, expect, it, vi } from 'vitest';

import { createPreviewGatewayService } from './gateway-service';

const cookieSecret = 'preview-cookie-secret-with-at-least-32-bytes';

function repositories() {
  const session = createRunningPreviewSessionFixture();
  const consumeAccessTicket = vi.fn<PreviewAccessTicketRepository['consumeAccessTicket']>(
    async () => ({
      previewId: session.previewId,
      executionId: session.executionId,
      ownerUserId: 'user-owner',
      expiresAt: '2026-08-10T12:10:00.000Z',
    }),
  );
  const redeemRepository = {
    issueAccessTicket: vi.fn(),
    consumeAccessTicket,
    revokeAccessTicket: vi.fn(),
  } as unknown as PreviewAccessTicketRepository;
  const sessionRepository = {
    getByPreviewId: vi.fn(async () => session),
  } as unknown as PreviewPersistenceRepository;
  return { session, consumeAccessTicket, redeemRepository, sessionRepository };
}

function gatewayRequest(previewId: string, accessCookie: string) {
  return {
    previewId,
    method: 'GET' as const,
    pathname: '/assets/app.js',
    search: '?version=1',
    accessCookie,
    headers: new Headers({
      accept: 'text/javascript',
      authorization: 'Bearer must-not-forward',
      cookie: 'factory-session=must-not-forward',
      'x-forwarded-host': 'internal.example',
    }),
    signal: new AbortController().signal,
  };
}

describe('PreviewGatewayService', () => {
  it('redeems a one-time ticket and proxies only bounded, credential-free HTTP', async () => {
    const repository = repositories();
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        accept: 'text/javascript',
        'x-brq-preview-runtime-token': 'R'.repeat(43),
        'user-agent': 'brq-preview-gateway/1.0',
      });
      expect(init?.redirect).toBe('manual');
      return new Response('console.log("safe")', {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
      });
    });
    const service = createPreviewGatewayService({
      redeemRepository: repository.redeemRepository,
      sessionRepository: repository.sessionRepository,
      locator: {
        resolveGatewayTarget: vi.fn(async () => ({
          host: '127.0.0.1' as const,
          port: 49_152,
          expiresAt: repository.session.expiresAt,
          accessToken: 'R'.repeat(43),
        })),
      },
      cookieSecret,
      now: () => Date.parse('2026-08-10T12:02:00.000Z'),
      fetchImplementation: fetchImplementation as typeof fetch,
    });

    const redeemed = await service.redeem(repository.session.previewId, 'A'.repeat(43));
    expect(redeemed?.cookieValue).not.toContain('user-owner');
    expect(repository.consumeAccessTicket).toHaveBeenCalledWith({
      ticketHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      consumedAt: '2026-08-10T12:02:00.000Z',
    });

    const response = await service.proxy(
      gatewayRequest(repository.session.previewId, redeemed!.cookieValue),
    );
    expect(await response.text()).toBe('console.log("safe")');
    expect(fetchImplementation).toHaveBeenCalledWith(
      'http://127.0.0.1:49152/assets/app.js?version=1',
      expect.any(Object),
    );
  });

  it('rejects a cookie for another Preview and a session that is no longer RUNNING', async () => {
    const repository = repositories();
    const service = createPreviewGatewayService({
      redeemRepository: repository.redeemRepository,
      sessionRepository: repository.sessionRepository,
      locator: { resolveGatewayTarget: vi.fn() },
      cookieSecret,
      now: () => Date.parse('2026-08-10T12:02:00.000Z'),
    });
    const redeemed = await service.redeem(repository.session.previewId, 'B'.repeat(43));
    await expect(
      service.proxy(gatewayRequest(`preview-${'f'.repeat(32)}`, redeemed!.cookieValue)),
    ).rejects.toMatchObject({ status: 401 });

    vi.mocked(repository.sessionRepository.getByPreviewId).mockResolvedValueOnce({
      ...repository.session,
      status: 'STOPPED',
    });
    await expect(
      service.proxy(gatewayRequest(repository.session.previewId, redeemed!.cookieValue)),
    ).rejects.toMatchObject({ status: 410 });
  });

  it('fails closed for malformed, missing or cross-Preview one-time tickets', async () => {
    const repository = repositories();
    const service = createPreviewGatewayService({
      redeemRepository: repository.redeemRepository,
      sessionRepository: repository.sessionRepository,
      locator: { resolveGatewayTarget: vi.fn() },
      cookieSecret,
      now: () => Date.parse('2026-08-10T12:02:00.000Z'),
    });

    await expect(
      service.redeem(repository.session.previewId, 'invalid ticket'),
    ).resolves.toBeNull();
    expect(repository.consumeAccessTicket).not.toHaveBeenCalled();
    repository.consumeAccessTicket.mockResolvedValueOnce(null);
    await expect(service.redeem(repository.session.previewId, 'D'.repeat(43))).resolves.toBeNull();
    repository.consumeAccessTicket.mockResolvedValueOnce({
      previewId: `preview-${'f'.repeat(32)}`,
      executionId: repository.session.executionId,
      ownerUserId: 'user-owner',
      expiresAt: '2026-08-10T12:10:00.000Z',
    });
    await expect(service.redeem(repository.session.previewId, 'E'.repeat(43))).resolves.toBeNull();
  });

  it('rejects tampered cookies before resolving any runtime target', async () => {
    const repository = repositories();
    const resolveGatewayTarget = vi.fn();
    const service = createPreviewGatewayService({
      redeemRepository: repository.redeemRepository,
      sessionRepository: repository.sessionRepository,
      locator: { resolveGatewayTarget },
      cookieSecret,
      now: () => Date.parse('2026-08-10T12:02:00.000Z'),
    });
    const redeemed = await service.redeem(repository.session.previewId, 'F'.repeat(43));
    vi.mocked(repository.sessionRepository.getByPreviewId).mockClear();

    await expect(
      service.proxy(
        gatewayRequest(repository.session.previewId, `${redeemed!.cookieValue}tampered`),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(repository.sessionRepository.getByPreviewId).not.toHaveBeenCalled();
    expect(resolveGatewayTarget).not.toHaveBeenCalled();
  });

  it('rejects null, non-loopback, malformed, expired or unsafe-port runtime targets', async () => {
    const repository = repositories();
    const resolveGatewayTarget = vi.fn();
    const fetchImplementation = vi.fn();
    const service = createPreviewGatewayService({
      redeemRepository: repository.redeemRepository,
      sessionRepository: repository.sessionRepository,
      locator: { resolveGatewayTarget },
      cookieSecret,
      now: () => Date.parse('2026-08-10T12:02:00.000Z'),
      fetchImplementation: fetchImplementation as typeof fetch,
    });
    const redeemed = await service.redeem(repository.session.previewId, 'G'.repeat(43));
    const valid = {
      host: '127.0.0.1' as const,
      port: 49_152,
      expiresAt: repository.session.expiresAt,
      accessToken: 'R'.repeat(43),
    };
    const invalidTargets = [
      null,
      { ...valid, host: '0.0.0.0' },
      { ...valid, port: 0 },
      { ...valid, port: 65_536 },
      { ...valid, accessToken: 'short' },
      { ...valid, expiresAt: 'not-a-date' },
      { ...valid, expiresAt: '2026-08-10T12:02:00.000Z' },
    ];

    for (const target of invalidTargets) {
      resolveGatewayTarget.mockResolvedValueOnce(target);
      await expect(
        service.proxy(gatewayRequest(repository.session.previewId, redeemed!.cookieValue)),
      ).rejects.toMatchObject({ status: 502 });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('fails closed for redirects and responses above the session limit', async () => {
    const repository = repositories();
    const responses = [
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
      new Response('large', {
        status: 200,
        headers: { 'content-length': String(repository.session.limits.responseBytes + 1) },
      }),
      new Response('invalid declaration', {
        status: 200,
        headers: { 'content-length': 'not-a-number' },
      }),
    ];
    const service = createPreviewGatewayService({
      redeemRepository: repository.redeemRepository,
      sessionRepository: repository.sessionRepository,
      locator: {
        resolveGatewayTarget: vi.fn(async () => ({
          host: '127.0.0.1' as const,
          port: 49_152,
          expiresAt: repository.session.expiresAt,
          accessToken: 'R'.repeat(43),
        })),
      },
      cookieSecret,
      now: () => Date.parse('2026-08-10T12:02:00.000Z'),
      fetchImplementation: vi.fn(async () => responses.shift()!) as unknown as typeof fetch,
    });
    const redeemed = await service.redeem(repository.session.previewId, 'C'.repeat(43));
    await expect(
      service.proxy(gatewayRequest(repository.session.previewId, redeemed!.cookieValue)),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      service.proxy(gatewayRequest(repository.session.previewId, redeemed!.cookieValue)),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      service.proxy(gatewayRequest(repository.session.previewId, redeemed!.cookieValue)),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('cancels an undeclared oversized body and retains the timeout through body streaming', async () => {
    const repository = repositories();
    let streamCancelled = false;
    const oversizedService = createPreviewGatewayService({
      redeemRepository: repository.redeemRepository,
      sessionRepository: repository.sessionRepository,
      locator: {
        resolveGatewayTarget: vi.fn(async () => ({
          host: '127.0.0.1' as const,
          port: 49_152,
          expiresAt: repository.session.expiresAt,
          accessToken: 'R'.repeat(43),
        })),
      },
      cookieSecret,
      now: () => Date.parse('2026-08-10T12:02:00.000Z'),
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(repository.session.limits.responseBytes + 1));
              },
              cancel() {
                streamCancelled = true;
              },
            }),
            { status: 200, headers: { 'content-type': 'application/octet-stream' } },
          ),
      ) as unknown as typeof fetch,
    });
    const oversizedGrant = await oversizedService.redeem(
      repository.session.previewId,
      'H'.repeat(43),
    );
    await expect(
      oversizedService.proxy(
        gatewayRequest(repository.session.previewId, oversizedGrant!.cookieValue),
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(streamCancelled).toBe(true);

    vi.useFakeTimers();
    try {
      let bodyAborted = false;
      const timeoutService = createPreviewGatewayService({
        redeemRepository: repository.redeemRepository,
        sessionRepository: repository.sessionRepository,
        locator: {
          resolveGatewayTarget: vi.fn(async () => ({
            host: '127.0.0.1' as const,
            port: 49_152,
            expiresAt: repository.session.expiresAt,
            accessToken: 'R'.repeat(43),
          })),
        },
        cookieSecret,
        now: () => Date.parse('2026-08-10T12:02:00.000Z'),
        fetchImplementation: vi.fn(async (_url, init) => {
          const signal = init?.signal;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                signal?.addEventListener(
                  'abort',
                  () => {
                    bodyAborted = true;
                    controller.error(new Error('ABORTED_PREVIEW_BODY'));
                  },
                  { once: true },
                );
              },
            }),
          );
        }) as unknown as typeof fetch,
      });
      repository.consumeAccessTicket.mockResolvedValueOnce({
        previewId: repository.session.previewId,
        executionId: repository.session.executionId,
        ownerUserId: 'user-owner',
        expiresAt: '2026-08-10T12:10:00.000Z',
      });
      const timeoutGrant = await timeoutService.redeem(
        repository.session.previewId,
        'I'.repeat(43),
      );
      const assertion = expect(
        timeoutService.proxy(
          gatewayRequest(repository.session.previewId, timeoutGrant!.cookieValue),
        ),
      ).rejects.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(repository.session.limits.responseTimeoutMs);
      await assertion;
      expect(bodyAborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates caller abort to the private fetch and releases the response timeout', async () => {
    const repository = repositories();
    let privateSignalWasAborted = false;
    const service = createPreviewGatewayService({
      redeemRepository: repository.redeemRepository,
      sessionRepository: repository.sessionRepository,
      locator: {
        resolveGatewayTarget: vi.fn(async () => ({
          host: '127.0.0.1' as const,
          port: 49_152,
          expiresAt: repository.session.expiresAt,
          accessToken: 'R'.repeat(43),
        })),
      },
      cookieSecret,
      now: () => Date.parse('2026-08-10T12:02:00.000Z'),
      fetchImplementation: vi.fn(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const privateSignal = init?.signal;
            privateSignalWasAborted = privateSignal?.aborted === true;
            if (privateSignalWasAborted) reject(new Error('CALLER_ABORTED'));
            else
              privateSignal?.addEventListener('abort', () => reject(new Error('CALLER_ABORTED')), {
                once: true,
              });
          }),
      ) as unknown as typeof fetch,
    });
    const redeemed = await service.redeem(repository.session.previewId, 'J'.repeat(43));
    const controller = new AbortController();
    const request = {
      ...gatewayRequest(repository.session.previewId, redeemed!.cookieValue),
      signal: controller.signal,
    };

    const assertion = expect(service.proxy(request)).rejects.toMatchObject({ status: 502 });
    controller.abort('CALLER_CANCELLED');
    await assertion;
    expect(privateSignalWasAborted).toBe(true);
  });
});
