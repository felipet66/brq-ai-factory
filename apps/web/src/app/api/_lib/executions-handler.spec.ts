// @vitest-environment node

import {
  EXECUTION_ENGINE_ERROR_CODES,
  ExecutionEngineError,
  type ExecutionEngine,
} from '@brq/execution-engine';
import { describe, expect, it, vi } from 'vitest';

import {
  EXECUTION_ID,
  FIXED_REQUEST_ID,
  capturedLogger,
  executionBody,
  executionResult,
  fakeEngine,
  jsonRequest,
} from '@/test/api-fixtures';

import { createExecutionsHandler } from './executions-handler';

function createHandler(engine: ExecutionEngine, extra: Record<string, unknown> = {}) {
  const logger = capturedLogger().logger;
  return createExecutionsHandler({
    getExecutionEngine: async () => engine,
    requestIdFactory: () => FIXED_REQUEST_ID,
    logger,
    ...extra,
  });
}

describe('executions HTTP adapter', () => {
  it('injects requestId, propagates cancellation and preserves ExecutionResult', async () => {
    const engine = fakeEngine();
    const controller = new AbortController();
    const { logger, records } = capturedLogger();
    const handler = createHandler(engine, { logger, now: () => 50 });
    const request = jsonRequest('http://localhost/api/executions', undefined, {
      signal: controller.signal,
    });

    const response = await handler(request, undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(executionResult());
    expect(body.metadata).toEqual({
      requestId: FIXED_REQUEST_ID,
      apiVersion: '1.0.0',
      executionId: EXECUTION_ID,
    });
    expect(engine.execute).toHaveBeenCalledWith(
      { ...executionBody(), requestId: FIXED_REQUEST_ID },
      { signal: request.signal },
    );
    expect(records.at(-1)).toMatchObject({
      event: 'http.request.completed',
      requestId: FIXED_REQUEST_ID,
      executionId: EXECUTION_ID,
      statusCode: 200,
    });
    expect(JSON.stringify(records)).not.toContain('Implemente');
    expect(JSON.stringify(records)).not.toContain('workflowHash');
  });

  it.each([
    {
      label: 'missing content type',
      request: () => new Request('http://localhost/api/executions', { method: 'POST', body: '{}' }),
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    },
    {
      label: 'unsupported encoding',
      request: () =>
        jsonRequest('http://localhost/api/executions', undefined, {
          headers: { 'content-encoding': 'gzip' },
        }),
      status: 415,
      code: 'UNSUPPORTED_CONTENT_ENCODING',
    },
    {
      label: 'malformed json',
      request: () =>
        new Request('http://localhost/api/executions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        }),
      status: 400,
      code: 'API_INVALID_JSON',
    },
    {
      label: 'unknown field',
      request: () =>
        jsonRequest('http://localhost/api/executions', { ...executionBody(), executionId: 'x' }),
      status: 400,
      code: 'INVALID_REQUEST',
    },
    {
      label: 'duplicate agent execution identifiers',
      request: () => {
        const body = executionBody();
        const agents = body.agents as Record<string, Record<string, unknown>>;
        agents.qa!.agentExecutionId = agents.developer!.agentExecutionId;
        return jsonRequest('http://localhost/api/executions', body);
      },
      status: 400,
      code: 'INVALID_REQUEST',
    },
    {
      label: 'query parameter',
      request: () => jsonRequest('http://localhost/api/executions?wait=true'),
      status: 400,
      code: 'INVALID_REQUEST',
    },
  ])('rejects $label before calling the engine', async ({ request, status, code }) => {
    const engine = fakeEngine();
    const response = await createHandler(engine)(request(), undefined);

    expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('enforces declared and streamed payload limits', async () => {
    const engine = fakeEngine();
    const handler = createHandler(engine);
    const declared = jsonRequest('http://localhost/api/executions', undefined, {
      headers: { 'content-length': String(512 * 1024 + 1) },
    });
    const streamed = jsonRequest('http://localhost/api/executions', {
      padding: 'x'.repeat(512 * 1024),
    });

    for (const request of [declared, streamed]) {
      const response = await handler(request, undefined);
      expect(response.status).toBe(413);
      expect((await response.json()).errors[0].code).toBe('PAYLOAD_TOO_LARGE');
    }
    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('maps runtime unavailability without exposing its cause', async () => {
    const { logger, records } = capturedLogger();
    const handler = createExecutionsHandler({
      getExecutionEngine: async () => {
        throw new Error('OPENAI_API_KEY=super-secret');
      },
      logger,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    const response = await handler(jsonRequest('http://localhost/api/executions'), undefined);
    const serialized = JSON.stringify(await response.json()) + JSON.stringify(records);

    expect(response.status).toBe(503);
    expect(serialized).toContain('EXECUTION_ENGINE_UNAVAILABLE');
    expect(serialized).not.toContain('super-secret');
  });

  it.each([
    [EXECUTION_ENGINE_ERROR_CODES.CANCELLED, 408, 'EXECUTION_CANCELLED'],
    [EXECUTION_ENGINE_ERROR_CODES.CONTRACT_VIOLATION, 500, 'EXECUTION_CONTRACT_VIOLATION'],
    [EXECUTION_ENGINE_ERROR_CODES.ORCHESTRATOR_FAILED, 500, 'EXECUTION_ENGINE_FAILED'],
    [EXECUTION_ENGINE_ERROR_CODES.INVALID_REQUEST, 400, 'INVALID_REQUEST'],
    [EXECUTION_ENGINE_ERROR_CODES.INVALID_CONFIGURATION, 503, 'EXECUTION_ENGINE_UNAVAILABLE'],
  ] as const)('maps engine error %s', async (engineCode, status, apiCode) => {
    const engine: ExecutionEngine = {
      execute: vi.fn(async () => {
        throw new ExecutionEngineError('sensitive engine error', {
          code: engineCode,
          state: 'FAILED',
          durationMs: 1,
          executionId: EXECUTION_ID,
        });
      }),
    };

    const response = await createHandler(engine)(
      jsonRequest('http://localhost/api/executions'),
      undefined,
    );
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.errors[0].code).toBe(apiCode);
    expect(JSON.stringify(body)).not.toContain('sensitive engine error');
  });

  it('rejects an invalid ExecutionResult at the public boundary', async () => {
    const engine = {
      execute: vi.fn(async () => ({ executionId: 'invalid' })),
    } as unknown as ExecutionEngine;
    const response = await createHandler(engine)(
      jsonRequest('http://localhost/api/executions'),
      undefined,
    );

    expect(response.status).toBe(500);
    expect((await response.json()).errors[0].code).toBe('EXECUTION_CONTRACT_VIOLATION');
  });

  it('returns a standardized 405 response', async () => {
    const engine = fakeEngine();
    const response = await createHandler(engine)(
      new Request('http://localhost/api/executions'),
      undefined,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(engine.execute).not.toHaveBeenCalled();
  });
});
