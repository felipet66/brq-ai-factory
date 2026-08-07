// @vitest-environment node

import {
  EXECUTION_ENGINE_ERROR_CODES,
  ExecutionEngineError,
  type ExecutionEngine,
} from '@brq/execution-engine';
import type {
  ExecutionRecord,
  ExecutionRecordPage,
  ExecutionRecordRepository,
} from '@brq/execution-repository';
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
  const repository = fakeRepository();
  return createExecutionsHandler({
    getExecutionEngine: async () => engine,
    getExecutionRepository: async () => repository,
    requestIdFactory: () => FIXED_REQUEST_ID,
    logger,
    ...extra,
  });
}

function listRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    executionId: EXECUTION_ID,
    workflowId: 'workflow-001',
    projectName: 'Portal do cliente',
    status: 'SUCCESS',
    readiness: 'READY',
    startedAt: '2026-08-07T10:00:00.000Z',
    finishedAt: '2026-08-07T10:00:00.250Z',
    durationMs: 250,
    ...overrides,
  } as ExecutionRecord;
}

function fakeRepository(page: ExecutionRecordPage = { items: [], nextCursor: null }) {
  const list = vi.fn(async () => page);
  return { list } as unknown as ExecutionRecordRepository & {
    readonly list: typeof list;
  };
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
      getExecutionRepository: async () => fakeRepository(),
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
      new Request('http://localhost/api/executions', { method: 'PUT' }),
      undefined,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('lists minimized persisted records with filters and cursor pagination', async () => {
    const repository = fakeRepository({
      items: [
        listRecord({
          storageId: 'private-storage-id',
          traceId: 'private-trace-id',
          failure: {
            kind: 'PRIVATE',
            code: 'PRIVATE_FAILURE',
            sourceCode: null,
          },
        }),
      ],
      nextCursor: 'cursor-002',
    });
    const { logger, records } = capturedLogger();
    const handler = createExecutionsHandler({
      getExecutionEngine: async () => fakeEngine(),
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
      now: () => 50,
    });
    const request = new Request(
      'http://localhost/api/executions?status=SUCCESS&readiness=READY&createdAfter=2026-08-01T00%3A00%3A00.000Z&createdBefore=2026-08-31T23%3A59%3A59.999Z&limit=10&cursor=cursor-001',
    );

    const response = await handler(request, undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(repository.list).toHaveBeenCalledWith({
      status: 'SUCCESS',
      readiness: 'READY',
      createdAfter: '2026-08-01T00:00:00.000Z',
      createdBefore: '2026-08-31T23:59:59.999Z',
      limit: 10,
      cursor: 'cursor-001',
    });
    expect(body.data).toEqual({
      items: [
        {
          executionId: EXECUTION_ID,
          workflowId: 'workflow-001',
          projectName: 'Portal do cliente',
          status: 'SUCCESS',
          readiness: 'READY',
          startedAt: '2026-08-07T10:00:00.000Z',
          finishedAt: '2026-08-07T10:00:00.250Z',
          durationMs: 250,
        },
      ],
      nextCursor: 'cursor-002',
    });
    expect(JSON.stringify(body)).not.toContain('private-storage-id');
    expect(JSON.stringify(body)).not.toContain('private-trace-id');
    expect(JSON.stringify(body)).not.toContain('PRIVATE_FAILURE');
    expect(JSON.stringify(records)).not.toContain('Portal do cliente');
    expect(records.at(-1)).toMatchObject({
      event: 'http.request.completed',
      endpoint: '/api/executions',
      method: 'GET',
      statusCode: 200,
    });
  });

  it.each([
    ['unknown filter', '?unknown=value', 'query.unknown'],
    ['duplicate filter', '?status=SUCCESS&status=FAILED', 'query.status'],
    ['invalid status', '?status=UNKNOWN', 'query.status'],
    ['invalid limit', '?limit=101', 'query.limit'],
    [
      'inverted date range',
      '?createdAfter=2026-09-01T00%3A00%3A00.000Z&createdBefore=2026-08-01T00%3A00%3A00.000Z',
      'query.createdAfter',
    ],
  ])('rejects %s before querying the repository', async (_label, query, path) => {
    const repository = fakeRepository();
    const handler = createExecutionsHandler({
      getExecutionEngine: async () => fakeEngine(),
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions${query}`),
      undefined,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors[0]).toMatchObject({ code: 'INVALID_REQUEST', path });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('maps repository factory and query failures without exposing their causes', async () => {
    const { logger, records } = capturedLogger();
    const engine = fakeEngine();
    const unavailable = createExecutionsHandler({
      getExecutionEngine: async () => engine,
      getExecutionRepository: async () => {
        throw new Error('DATABASE_URL=file:secret.db');
      },
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });
    const failingRepository = fakeRepository();
    failingRepository.list.mockRejectedValueOnce(new Error('query secret'));
    const failingQuery = createExecutionsHandler({
      getExecutionEngine: async () => engine,
      getExecutionRepository: async () => failingRepository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });

    for (const handler of [unavailable, failingQuery]) {
      const response = await handler(new Request('http://localhost/api/executions'), undefined);
      expect(response.status).toBe(503);
      expect((await response.json()).errors[0].code).toBe('EXECUTION_REPOSITORY_UNAVAILABLE');
    }
    const logs = JSON.stringify(records);
    expect(logs).not.toContain('secret.db');
    expect(logs).not.toContain('query secret');
    expect(engine.execute).not.toHaveBeenCalled();
  });
});
