import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '@/server/auth/contracts';
import {
  PreviewApplicationError,
  type PreviewApplicationErrorCode,
  type PreviewApplicationService,
} from '@/server/preview/contracts';

import { HttpApiError } from './errors';
import {
  createExecutionPreviewHandler,
  createPreviewSessionHandler,
  mapPreviewError,
} from './preview-handler';

const executionId = `execution-${'1'.repeat(32)}`;
const previewId = `preview-${'2'.repeat(32)}`;
const hash = 'a'.repeat(64);
const principal: AuthenticatedPrincipal = Object.freeze({
  userId: 'user-1',
  role: 'USER',
  user: Object.freeze({
    id: 'user-1',
    name: 'User',
    email: 'user@example.local',
    role: 'USER',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  }),
});

function session(status: 'RUNNING' | 'STOPPED' = 'RUNNING') {
  return {
    previewId,
    executionId,
    status,
    health: status === 'RUNNING' ? ('HEALTHY' as const) : ('NOT_APPLICABLE' as const),
    createdAt: '2026-08-10T00:00:00.000Z',
    startedAt: '2026-08-10T00:00:01.000Z',
    expiresAt: '2026-08-10T00:10:00.000Z',
    stoppedAt: status === 'STOPPED' ? '2026-08-10T00:02:00.000Z' : null,
    policy: { id: 'NODE_WEB_PREVIEW_24_V1', version: '1.0.0' },
    hashes: {
      factoryResultHash: hash,
      artifactHash: 'b'.repeat(64),
      previewRequestHash: 'c'.repeat(64),
      previewSessionHash: 'd'.repeat(64),
    },
    controlPath: `/executions/${executionId}/preview`,
    failure: null,
  };
}

function service(overrides: Partial<PreviewApplicationService> = {}): PreviewApplicationService {
  return {
    getExecutionControl: vi.fn(async () => ({
      eligibility: { status: 'ELIGIBLE' as const },
      session: null,
    })),
    start: vi.fn(async () => session()),
    get: vi.fn(async () => session()),
    stop: vi.fn(async () => session('STOPPED')),
    createLaunch: vi.fn(async () => null),
    ...overrides,
  };
}

const authenticate = vi.fn(async () => principal);
const requestIdFactory = () => 'request-123e4567-e89b-42d3-a456-426614174000';
const context = { params: Promise.resolve({ id: executionId }) };

describe('Preview HTTP handlers', () => {
  it.each([
    ['PREVIEW_NOT_ALLOWED', 404],
    ['PREVIEW_FACTORY_NOT_SUCCESS', 409],
    ['PREVIEW_ARTIFACT_UNAVAILABLE', 409],
    ['PREVIEW_PROFILE_UNSUPPORTED', 422],
    ['PREVIEW_POLICY_MISMATCH', 409],
    ['PREVIEW_CONFIGURATION_INVALID', 503],
    ['PREVIEW_CAPACITY_EXCEEDED', 503],
    ['PREVIEW_RUNTIME_UNAVAILABLE', 503],
    ['PREVIEW_IMAGE_VERIFICATION_FAILED', 503],
    ['PREVIEW_START_FAILED', 502],
    ['PREVIEW_START_TIMEOUT', 504],
    ['PREVIEW_HEALTHCHECK_FAILED', 502],
    ['PREVIEW_RUNTIME_LOST', 410],
    ['PREVIEW_STOP_FAILED', 502],
    ['PREVIEW_CLEANUP_FAILED', 500],
    ['PREVIEW_CONFLICT', 409],
  ] satisfies readonly (readonly [PreviewApplicationErrorCode, number])[])(
    'maps %s to HTTP %i',
    (code, status) => {
      expect(() =>
        mapPreviewError(new PreviewApplicationError('Safe Preview failure.', code), executionId),
      ).toThrowError(
        expect.objectContaining({
          code,
          status,
          executionId,
          message: 'Safe Preview failure.',
        }),
      );
    },
  );

  it('preserves already mapped HTTP errors', () => {
    const mapped = new HttpApiError('Invalid path.', {
      code: 'INVALID_REQUEST',
      status: 400,
      path: 'id',
    });
    expect(() => mapPreviewError(mapped)).toThrow(mapped);
  });

  it('returns eligibility without starting a runtime', async () => {
    const previewService = service();
    const handler = createExecutionPreviewHandler({
      authenticate,
      getService: async () => previewService,
      requestIdFactory,
    });
    const response = await handler(
      new Request(`http://localhost/api/executions/${executionId}/preview`),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { eligibility: { status: 'ELIGIBLE' }, session: null },
    });
    expect(previewService.start).not.toHaveBeenCalled();
  });

  it('requires same-origin mutation and accepts only a TTL reduction', async () => {
    const previewService = service();
    const assertOrigin = vi.fn();
    const handler = createExecutionPreviewHandler({
      authenticate,
      getService: async () => previewService,
      assertOrigin,
      requestIdFactory,
    });
    const response = await handler(
      new Request(`http://localhost/api/executions/${executionId}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ ttlSeconds: 600 }),
      }),
      context,
    );
    expect(response.status).toBe(201);
    expect(assertOrigin).toHaveBeenCalledOnce();
    expect(previewService.start).toHaveBeenCalledWith(
      executionId,
      principal,
      { ttlSeconds: 600 },
      expect.objectContaining({ requestId: requestIdFactory() }),
    );
    expect(JSON.stringify(await response.json())).not.toContain('containerId');
  });

  it('rejects unknown policy, image, command and port fields', async () => {
    const previewService = service();
    const handler = createExecutionPreviewHandler({
      authenticate,
      getService: async () => previewService,
      assertOrigin: vi.fn(),
      requestIdFactory,
    });
    const response = await handler(
      new Request(`http://localhost/api/executions/${executionId}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: 'attacker', command: 'npm start', port: 3000 }),
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(previewService.start).not.toHaveBeenCalled();
  });

  it('maps fail-closed domain errors without technical detail', async () => {
    const previewService = service({
      start: vi.fn(async () => {
        throw new PreviewApplicationError(
          'O profile do projeto não permite Preview.',
          'PREVIEW_PROFILE_UNSUPPORTED',
        );
      }),
    });
    const handler = createExecutionPreviewHandler({
      authenticate,
      getService: async () => previewService,
      assertOrigin: vi.fn(),
      requestIdFactory,
    });
    const response = await handler(
      new Request(`http://localhost/api/executions/${executionId}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      context,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      success: false,
      errors: [{ code: 'PREVIEW_PROFILE_UNSUPPORTED' }],
    });
  });

  it('gets and idempotently stops a safe PreviewSession', async () => {
    const previewService = service();
    const handler = createPreviewSessionHandler({
      authenticate,
      getService: async () => previewService,
      assertOrigin: vi.fn(),
      requestIdFactory,
    });
    const previewContext = { params: Promise.resolve({ id: previewId }) };
    const read = await handler(
      new Request(`http://localhost/api/previews/${previewId}`),
      previewContext,
    );
    expect(read.status).toBe(200);

    const stopped = await handler(
      new Request(`http://localhost/api/previews/${previewId}`, { method: 'DELETE' }),
      previewContext,
    );
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ data: { status: 'STOPPED' } });
  });

  it('returns 404 when scoped service cannot see the Preview', async () => {
    const handler = createPreviewSessionHandler({
      authenticate,
      getService: async () => service({ get: vi.fn(async () => null) }),
      requestIdFactory,
    });
    const response = await handler(new Request(`http://localhost/api/previews/${previewId}`), {
      params: Promise.resolve({ id: previewId }),
    });
    expect(response.status).toBe(404);
  });

  it('maps a lost runtime during scoped lookup to HTTP 410', async () => {
    const handler = createPreviewSessionHandler({
      authenticate,
      getService: async () =>
        service({
          get: vi.fn(async () => {
            throw new PreviewApplicationError(
              'A sessão de Preview não está mais disponível.',
              'PREVIEW_RUNTIME_LOST',
            );
          }),
        }),
      requestIdFactory,
    });
    const response = await handler(new Request(`http://localhost/api/previews/${previewId}`), {
      params: Promise.resolve({ id: previewId }),
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      success: false,
      errors: [{ code: 'PREVIEW_RUNTIME_LOST' }],
    });
  });

  it('rejects invalid execution and Preview identifiers before service access', async () => {
    const previewService = service();
    const executionHandler = createExecutionPreviewHandler({
      authenticate,
      getService: async () => previewService,
      requestIdFactory,
    });
    const invalidExecution = await executionHandler(
      new Request('http://localhost/api/executions/invalid/preview'),
      { params: Promise.resolve({ id: 'invalid' }) },
    );
    expect(invalidExecution.status).toBe(400);
    expect(await invalidExecution.json()).toMatchObject({
      success: false,
      errors: [{ code: 'INVALID_REQUEST', path: 'id' }],
    });

    const previewHandler = createPreviewSessionHandler({
      authenticate,
      getService: async () => previewService,
      requestIdFactory,
    });
    const invalidPreview = await previewHandler(
      new Request('http://localhost/api/previews/invalid'),
      { params: Promise.resolve({ id: 'invalid' }) },
    );
    expect(invalidPreview.status).toBe(400);
    expect(await invalidPreview.json()).toMatchObject({
      success: false,
      errors: [{ code: 'INVALID_REQUEST', path: 'id' }],
    });
    expect(previewService.getExecutionControl).not.toHaveBeenCalled();
    expect(previewService.get).not.toHaveBeenCalled();
  });

  it('maps Preview service composition failure to a sanitized 503', async () => {
    const handler = createExecutionPreviewHandler({
      authenticate,
      getService: async () => Promise.reject(new Error('docker host at tcp://private:2375')),
      requestIdFactory,
    });
    const response = await handler(
      new Request(`http://localhost/api/executions/${executionId}/preview`),
      context,
    );
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: false,
      errors: [{ code: 'PREVIEW_RUNTIME_UNAVAILABLE' }],
    });
    expect(JSON.stringify(payload)).not.toContain('private:2375');
  });
});
