import { describe, expect, it, vi } from 'vitest';

import {
  getExecutionPreview,
  getPreviewSession,
  startExecutionPreview,
  stopPreviewSession,
} from './preview-client';

const executionId = `execution-${'1'.repeat(32)}`;
const previewId = `preview-${'2'.repeat(32)}`;
const hash = 'a'.repeat(64);

function metadata() {
  return {
    requestId: 'request-123e4567-e89b-42d3-a456-426614174000',
    apiVersion: '3.2.0',
    executionId,
  };
}

function session(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    previewId,
    executionId,
    status: 'RUNNING',
    health: 'HEALTHY',
    createdAt: '2026-08-10T00:00:00.000Z',
    startedAt: '2026-08-10T00:00:01.000Z',
    expiresAt: '2026-08-10T00:10:00.000Z',
    stoppedAt: null,
    policy: { id: 'NODE_WEB_PREVIEW_24_V1', version: '1.0.0' },
    hashes: {
      factoryResultHash: hash,
      artifactHash: 'b'.repeat(64),
      previewRequestHash: 'c'.repeat(64),
      previewSessionHash: 'd'.repeat(64),
    },
    controlPath: `/executions/${executionId}/preview`,
    failure: null,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

describe('Preview HTTP client', () => {
  it('loads eligibility without starting a Preview', async () => {
    const fetchImplementation = vi.fn(async () =>
      json({
        success: true,
        data: { eligibility: { status: 'ELIGIBLE' }, session: null },
        metadata: metadata(),
        errors: [],
      }),
    );

    await expect(getExecutionPreview(executionId, { fetchImplementation })).resolves.toEqual({
      eligibility: { status: 'ELIGIBLE' },
      session: null,
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/${executionId}/preview`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('starts with only the bounded public request and projects the safe session', async () => {
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBe('{"ttlSeconds":600}');
      return json({ success: true, data: session(), metadata: metadata(), errors: [] }, 201);
    });

    const result = await startExecutionPreview(
      executionId,
      { ttlSeconds: 600 },
      { fetchImplementation },
    );
    expect(result.previewId).toBe(previewId);
    expect(JSON.stringify(result)).not.toContain('containerId');
    expect(JSON.stringify(result)).not.toContain('hostPort');
  });

  it('rejects invalid TTL locally before transport', async () => {
    const fetchImplementation = vi.fn();
    await expect(
      startExecutionPreview(executionId, { ttlSeconds: 901 }, { fetchImplementation }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('maps a sanitized API failure and never accepts a malformed success payload', async () => {
    const apiFailure = vi.fn(async () =>
      json(
        {
          success: false,
          data: null,
          metadata: metadata(),
          errors: [{ code: 'PREVIEW_ARTIFACT_UNAVAILABLE', message: 'Artifact unavailable.' }],
        },
        409,
      ),
    );
    await expect(
      getExecutionPreview(executionId, { fetchImplementation: apiFailure }),
    ).rejects.toMatchObject({
      code: 'API_ERROR',
      status: 409,
      message: 'Artifact unavailable.',
    });

    const malformed = vi.fn(async () =>
      json({
        success: true,
        data: { ...session(), containerId: 'secret' },
        metadata: metadata(),
        errors: [],
      }),
    );
    await expect(
      stopPreviewSession(previewId, { fetchImplementation: malformed }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects non-JSON and malformed JSON responses before contract parsing', async () => {
    const nonJson = vi.fn(
      async () =>
        new Response('<html>upstream failure</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    );
    await expect(
      getExecutionPreview(executionId, { fetchImplementation: nonJson }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });

    const malformedJson = vi.fn(
      async () =>
        new Response('{', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      getExecutionPreview(executionId, { fetchImplementation: malformedJson }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it('uses a generic API error when an upstream failure envelope is malformed', async () => {
    const malformedFailure = vi.fn(async () =>
      json({ error: 'docker host at tcp://private:2375' }, 503),
    );

    await expect(
      getExecutionPreview(executionId, { fetchImplementation: malformedFailure }),
    ).rejects.toMatchObject({
      code: 'API_ERROR',
      status: 503,
      message: 'O Preview não pôde ser concluído.',
    });
  });

  it('gets and stops a session through their canonical HTTP methods', async () => {
    const fetchImplementation = vi.fn(async () =>
      json({ success: true, data: session(), metadata: metadata(), errors: [] }),
    );

    await expect(getPreviewSession(previewId, { fetchImplementation })).resolves.toMatchObject({
      previewId,
      status: 'RUNNING',
    });
    await expect(stopPreviewSession(previewId, { fetchImplementation })).resolves.toMatchObject({
      previewId,
      status: 'RUNNING',
    });
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      `/api/previews/${previewId}`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      `/api/previews/${previewId}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('maps aborted transport separately from network failures', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImplementation = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      getExecutionPreview(executionId, { signal: controller.signal, fetchImplementation }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });

    const abortError = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      getExecutionPreview(executionId, { fetchImplementation: abortError }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });

    const networkFailure = vi.fn(async () => {
      throw new TypeError('connect ECONNREFUSED tcp://private:2375');
    });
    await expect(
      getExecutionPreview(executionId, { fetchImplementation: networkFailure }),
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Não foi possível conectar ao serviço de Preview.',
    });
  });
});
