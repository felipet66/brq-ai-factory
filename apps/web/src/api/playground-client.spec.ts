import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  builtPreviewFixture,
  playgroundCatalogFixture,
  PLAYGROUND_REQUEST_ID,
  successEnvelope,
  validationFixture,
} from '@/components/playground/playground.spec.fixtures';

import {
  buildPlaygroundPreview,
  getPlaygroundAgents,
  PlaygroundClientError,
  validatePlaygroundCandidate,
} from './playground-client';

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Prompt Playground HTTP client', () => {
  it('loads and validates the exact ephemeral catalog envelope', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(playgroundCatalogFixture())),
    );

    await expect(getPlaygroundAgents({ fetchImplementation })).resolves.toEqual(
      playgroundCatalogFixture(),
    );
    expect(fetchImplementation).toHaveBeenCalledWith('/api/playground/agents', {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('posts only the selected agent input and forwards AbortSignal outside the payload', async () => {
    const controller = new AbortController();
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(builtPreviewFixture())),
    );
    const request = {
      agent: 'PRODUCT_OWNER' as const,
      input: { projectName: 'Portal', objective: 'Track orders.' },
    };

    await expect(
      buildPlaygroundPreview(request, { fetchImplementation, signal: controller.signal }),
    ).resolves.toMatchObject({ status: 'BUILT', agent: 'PRODUCT_OWNER' });

    expect(fetchImplementation).toHaveBeenCalledWith(
      '/api/playground/preview',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      }),
    );
    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body));
    expect(body).toEqual(request);
    expect(body).not.toHaveProperty('signal');
  });

  it('posts a manual candidate to the validation endpoint', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(validationFixture())),
    );
    const request = {
      agent: 'PRODUCT_OWNER' as const,
      input: { projectName: 'Portal', objective: 'Track orders.' },
      candidate: { content: '{"status":"READY"}' },
    };

    await expect(
      validatePlaygroundCandidate(request, { fetchImplementation }),
    ).resolves.toMatchObject({ status: 'PASS' });
    expect(fetchImplementation).toHaveBeenCalledWith(
      '/api/playground/validate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    );
  });

  it('rejects invalid input and UTF-8 candidates over the byte limit before HTTP', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>();

    await expect(
      buildPlaygroundPreview(
        { agent: 'PRODUCT_OWNER', input: { projectName: ' ', objective: 'Track orders.' } },
        { fetchImplementation },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      validatePlaygroundCandidate(
        {
          agent: 'PRODUCT_OWNER',
          input: { projectName: 'Portal', objective: 'Track orders.' },
          candidate: { content: 'é'.repeat(524_289) },
        },
        { fetchImplementation },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('maps a valid API error envelope without exposing response internals', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        {
          success: false,
          data: null,
          metadata: { requestId: PLAYGROUND_REQUEST_ID, apiVersion: '3.0.0' },
          errors: [
            {
              code: 'PLAYGROUND_INPUT_INVALID',
              message: 'The inspection input is invalid.',
              path: 'input',
            },
          ],
        },
        400,
      ),
    );

    await expect(
      buildPlaygroundPreview(
        { agent: 'PRODUCT_OWNER', input: { projectName: 'Portal', objective: 'Track orders.' } },
        { fetchImplementation },
      ),
    ).rejects.toMatchObject({
      name: 'PlaygroundClientError',
      code: 'API_ERROR',
      status: 400,
      requestId: PLAYGROUND_REQUEST_ID,
      path: 'input',
      message: 'The inspection input is invalid.',
    });
  });

  it('rejects malformed, non-JSON and cross-agent success responses', async () => {
    const malformed = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope({ ...playgroundCatalogFixture(), retention: 'PERSISTED' })),
    );
    const text = vi.fn<FetchImplementation>(
      async () =>
        new Response('internal details', {
          status: 503,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    const mismatched = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(builtPreviewFixture('QA'))),
    );

    await expect(getPlaygroundAgents({ fetchImplementation: malformed })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(getPlaygroundAgents({ fetchImplementation: text })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(
      buildPlaygroundPreview(
        { agent: 'PRODUCT_OWNER', input: { projectName: 'Portal', objective: 'Track orders.' } },
        { fetchImplementation: mismatched },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('maps network failures and cancellation to stable typed errors', async () => {
    const network = vi.fn<FetchImplementation>(async () => {
      throw new Error('socket contained a secret');
    });
    const abortedController = new AbortController();
    abortedController.abort();

    const networkError = await getPlaygroundAgents({ fetchImplementation: network }).catch(
      (error: unknown) => error,
    );
    expect(networkError).toBeInstanceOf(PlaygroundClientError);
    expect(networkError).toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'The Playground service is unavailable.',
    });
    expect(String(networkError)).not.toContain('socket contained a secret');

    await expect(
      getPlaygroundAgents({ fetchImplementation: network, signal: abortedController.signal }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(network).toHaveBeenCalledOnce();
  });

  it('uses the global fetch implementation when no transport override is supplied', async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(playgroundCatalogFixture())),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPlaygroundAgents()).resolves.toMatchObject({ retention: 'EPHEMERAL' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playground/agents',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('maps AbortError variants raised by an active transport', async () => {
    const domAbort = vi.fn<FetchImplementation>(async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    const errorAbort = vi.fn<FetchImplementation>(async () => {
      const error = new Error('cancelled');
      error.name = 'AbortError';
      throw error;
    });

    await expect(getPlaygroundAgents({ fetchImplementation: domAbort })).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    });
    await expect(getPlaygroundAgents({ fetchImplementation: errorAbort })).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    });
  });

  it('rejects invalid JSON, missing content type and malformed API error envelopes', async () => {
    const invalidJson = vi.fn<FetchImplementation>(
      async () =>
        new Response('{', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const missingContentType = vi.fn<FetchImplementation>(
      async () => new Response(null, { status: 204 }),
    );
    const malformedError = vi.fn<FetchImplementation>(async () =>
      jsonResponse({ error: 'internal shape' }, 503),
    );

    await expect(getPlaygroundAgents({ fetchImplementation: invalidJson })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
    });
    await expect(
      getPlaygroundAgents({ fetchImplementation: missingContentType }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 204 });
    await expect(
      getPlaygroundAgents({ fetchImplementation: malformedError }),
    ).rejects.toMatchObject({
      code: 'API_ERROR',
      status: 503,
      requestId: null,
    });
  });

  it('maps valid API errors without paths and rejects cross-agent validation results', async () => {
    const noPathError = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        {
          success: false,
          data: null,
          metadata: { requestId: PLAYGROUND_REQUEST_ID, apiVersion: '3.0.0' },
          errors: [{ code: 'PLAYGROUND_UNAVAILABLE', message: 'Inspection unavailable.' }],
        },
        503,
      ),
    );
    const mismatchedValidation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope({
          ...validationFixture(),
          agent: 'QA',
        }),
      ),
    );

    await expect(getPlaygroundAgents({ fetchImplementation: noPathError })).rejects.toMatchObject({
      code: 'API_ERROR',
      path: null,
      requestId: PLAYGROUND_REQUEST_ID,
    });
    await expect(
      validatePlaygroundCandidate(
        {
          agent: 'PRODUCT_OWNER',
          input: { projectName: 'Portal', objective: 'Track orders.' },
          candidate: { content: '{}' },
        },
        { fetchImplementation: mismatchedValidation },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
