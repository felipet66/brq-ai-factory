import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '@/server/auth/contracts';
import {
  PreviewApplicationError,
  type PreviewApplicationService,
} from '@/server/preview/contracts';

import { createPreviewLaunchHandler } from './preview-launch-handler';

const previewId = `preview-${'1'.repeat(32)}`;
const principal = {
  userId: 'user-1',
  role: 'USER',
  user: {
    id: 'user-1',
    name: 'User',
    email: 'user@example.local',
    role: 'USER',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  },
} satisfies AuthenticatedPrincipal;

function service(overrides: Partial<PreviewApplicationService> = {}): PreviewApplicationService {
  return {
    getExecutionControl: vi.fn(),
    start: vi.fn(),
    get: vi.fn(),
    stop: vi.fn(),
    createLaunch: vi.fn(async () => ({
      previewId,
      redeemUrl: `https://${previewId}.preview.example.net/_brq/redeem`,
      ticket: 't'.repeat(43),
      expiresAt: '2026-08-10T00:00:30.000Z',
    })),
    ...overrides,
  };
}

describe('Preview launch handler', () => {
  it('returns only a trusted one-time POST bridge to the isolated origin', async () => {
    const previewService = service();
    const handler = createPreviewLaunchHandler({
      authenticate: vi.fn(async () => principal),
      getService: async () => previewService,
      assertOrigin: vi.fn(),
      requestIdFactory: () => 'request-123e4567-e89b-42d3-a456-426614174000',
      nonceFactory: () => 'fixed-launch-nonce',
    });
    const response = await handler(
      new Request(`http://localhost:3000/previews/${previewId}/launch`, { method: 'POST' }),
      { params: Promise.resolve({ id: previewId }) },
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`https://${previewId}.preview.example.net/_brq/redeem`);
    expect(html).toContain('method="post"');
    expect(html).toContain('t'.repeat(43));
    expect(html).not.toContain('containerId');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain(
      "script-src 'nonce-fixed-launch-nonce'",
    );
  });

  it('accepts the empty stream produced by the Next.js Node adapter and rejects actual bytes', async () => {
    const previewService = service();
    const handler = createPreviewLaunchHandler({
      authenticate: vi.fn(async () => principal),
      getService: async () => previewService,
      assertOrigin: vi.fn(),
      requestIdFactory: () => 'request-123e4567-e89b-42d3-a456-426614174000',
      nonceFactory: () => 'fixed-launch-nonce',
    });
    const emptyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const accepted = await handler(
      new Request(`http://localhost:3000/previews/${previewId}/launch`, {
        method: 'POST',
        headers: {
          'content-length': '0',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: emptyStream,
        duplex: 'half',
      } as RequestInit),
      { params: Promise.resolve({ id: previewId }) },
    );
    expect(accepted.status).toBe(200);

    const rejected = await handler(
      new Request(`http://localhost:3000/previews/${previewId}/launch`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'unexpected=body',
      }),
      { params: Promise.resolve({ id: previewId }) },
    );
    expect(rejected.status).toBe(400);
  });

  it('maps lifecycle conflicts and service unavailability without leaking internals', async () => {
    const conflicting = createPreviewLaunchHandler({
      authenticate: vi.fn(async () => principal),
      getService: async () =>
        service({
          createLaunch: vi.fn(async () => {
            throw new PreviewApplicationError(
              'O Preview ainda não está RUNNING.',
              'PREVIEW_CONFLICT',
            );
          }),
        }),
      assertOrigin: vi.fn(),
      requestIdFactory: () => 'request-123e4567-e89b-42d3-a456-426614174000',
    });
    const conflictResponse = await conflicting(
      new Request(`http://localhost:3000/previews/${previewId}/launch`, { method: 'POST' }),
      { params: Promise.resolve({ id: previewId }) },
    );
    expect(conflictResponse.status).toBe(409);

    const unavailable = createPreviewLaunchHandler({
      authenticate: vi.fn(async () => principal),
      getService: async () => Promise.reject(new Error('private database connection string')),
      assertOrigin: vi.fn(),
      requestIdFactory: () => 'request-123e4567-e89b-42d3-a456-426614174000',
    });
    const unavailableResponse = await unavailable(
      new Request(`http://localhost:3000/previews/${previewId}/launch`, { method: 'POST' }),
      { params: Promise.resolve({ id: previewId }) },
    );
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.text()).not.toContain('connection string');
  });
});
