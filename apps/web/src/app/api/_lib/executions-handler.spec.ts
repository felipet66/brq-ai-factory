// @vitest-environment node

import type {
  ExecutionRecord,
  ExecutionRecordPage,
  ExecutionRecordRepository,
} from '@brq/execution-repository';
import type { ExecutionDispatcher } from '@brq/execution-worker';
import { jobRecordSchema, type JobRecord } from '@brq/job-queue';
import { describe, expect, it, vi } from 'vitest';

import {
  EXECUTION_ID,
  FIXED_REQUEST_ID,
  capturedLogger,
  executionBody,
  jsonRequest,
} from '@/test/api-fixtures';

import { createExecutionsHandler } from './executions-handler';

const JOB_ID = `job-${'a'.repeat(32)}`;
const QUEUED_AT = '2026-08-07T10:00:00.000Z';

function queuedJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return jobRecordSchema.parse({
    jobId: JOB_ID,
    executionId: EXECUTION_ID,
    workflowId: 'workflow-001',
    status: 'QUEUED',
    attempt: 1,
    queuedAt: QUEUED_AT,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failure: null,
    events: [
      {
        sequence: 1,
        type: 'job.created',
        jobId: JOB_ID,
        executionId: EXECUTION_ID,
        workflowId: 'workflow-001',
        status: 'QUEUED',
        occurredAt: QUEUED_AT,
        durationMs: null,
        errorCode: null,
      },
    ],
    ...overrides,
  });
}

function runningJob(): JobRecord {
  return jobRecordSchema.parse({
    ...queuedJob(),
    status: 'RUNNING',
    startedAt: '2026-08-07T10:00:00.010Z',
    events: [
      ...queuedJob().events,
      {
        sequence: 2,
        type: 'job.started',
        jobId: JOB_ID,
        executionId: EXECUTION_ID,
        workflowId: 'workflow-001',
        status: 'RUNNING',
        occurredAt: '2026-08-07T10:00:00.010Z',
        durationMs: null,
        errorCode: null,
      },
    ],
  });
}

function fakeDispatcher(job: JobRecord = queuedJob()) {
  const dispatch = vi.fn(async () => job);
  return { dispatch } as ExecutionDispatcher & { readonly dispatch: typeof dispatch };
}

function createHandler(dispatcher: ExecutionDispatcher, extra: Record<string, unknown> = {}) {
  const logger = capturedLogger().logger;
  const repository = fakeRepository();
  return createExecutionsHandler({
    getExecutionDispatcher: async () => dispatcher,
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
  it('injects requestId, dispatches once and returns a minimized 202 receipt', async () => {
    const dispatcher = fakeDispatcher();
    const { logger, records } = capturedLogger();
    const handler = createHandler(dispatcher, { logger, now: () => 50 });

    const response = await handler(jsonRequest('http://localhost/api/executions'), undefined);
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      success: true,
      data: { executionId: EXECUTION_ID, jobId: JOB_ID, status: 'QUEUED' },
      metadata: {
        requestId: FIXED_REQUEST_ID,
        apiVersion: '2.0.0',
        executionId: EXECUTION_ID,
      },
      errors: [],
    });
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      ...executionBody(),
      requestId: FIXED_REQUEST_ID,
    });
    expect(records.at(-1)).toMatchObject({
      event: 'http.request.completed',
      requestId: FIXED_REQUEST_ID,
      executionId: EXECUTION_ID,
      jobId: JOB_ID,
      statusCode: 202,
    });
    const logs = JSON.stringify(records);
    expect(logs).not.toContain('Consulta de pedidos');
    expect(logs).not.toContain('Reduzir contatos');
    expect(JSON.stringify(body)).not.toContain('events');
    expect(JSON.stringify(body)).not.toContain('workflowId');
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
  ])('rejects $label before calling the dispatcher', async ({ request, status, code }) => {
    const dispatcher = fakeDispatcher();
    const response = await createHandler(dispatcher)(request(), undefined);

    expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('enforces declared and streamed payload limits before dispatch', async () => {
    const dispatcher = fakeDispatcher();
    const handler = createHandler(dispatcher);
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
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('maps dispatcher factory and dispatch failures without exposing their causes', async () => {
    const { logger, records } = capturedLogger();
    const unavailable = createExecutionsHandler({
      getExecutionDispatcher: async () => {
        throw new Error('QUEUE_SECRET=private-factory');
      },
      getExecutionRepository: async () => fakeRepository(),
      logger,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });
    const dispatcher = fakeDispatcher();
    dispatcher.dispatch.mockRejectedValueOnce(new Error('private-dispatch-payload'));
    const failed = createExecutionsHandler({
      getExecutionDispatcher: async () => dispatcher,
      getExecutionRepository: async () => fakeRepository(),
      logger,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    for (const handler of [unavailable, failed]) {
      const response = await handler(jsonRequest('http://localhost/api/executions'), undefined);
      expect(response.status).toBe(503);
      expect((await response.json()).errors[0].code).toBe('EXECUTION_DISPATCHER_UNAVAILABLE');
    }
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain('private-factory');
    expect(serialized).not.toContain('private-dispatch-payload');
  });

  it.each([
    ['malformed job', { jobId: 'invalid' }],
    ['already-running job', runningJob()],
  ])('rejects a %s at the dispatcher boundary', async (_label, result) => {
    const dispatcher = {
      dispatch: vi.fn(async () => result),
    } as unknown as ExecutionDispatcher;
    const response = await createHandler(dispatcher)(
      jsonRequest('http://localhost/api/executions'),
      undefined,
    );

    expect(response.status).toBe(500);
    expect((await response.json()).errors[0].code).toBe('EXECUTION_DISPATCH_CONTRACT_VIOLATION');
  });

  it('returns a standardized 405 response', async () => {
    const dispatcher = fakeDispatcher();
    const response = await createHandler(dispatcher)(
      new Request('http://localhost/api/executions', { method: 'PUT' }),
      undefined,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('lists minimized persisted records with filters and cursor pagination', async () => {
    const repository = fakeRepository({
      items: [
        listRecord({
          storageId: 'private-storage-id',
          traceId: 'private-trace-id',
          failure: { kind: 'PRIVATE', code: 'PRIVATE_FAILURE', sourceCode: null },
        }),
      ],
      nextCursor: 'cursor-002',
    });
    const getExecutionDispatcher = vi.fn(async () => fakeDispatcher());
    const { logger, records } = capturedLogger();
    const handler = createExecutionsHandler({
      getExecutionDispatcher,
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
    expect(getExecutionDispatcher).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('private-storage-id');
    expect(JSON.stringify(body)).not.toContain('private-trace-id');
    expect(JSON.stringify(body)).not.toContain('PRIVATE_FAILURE');
    expect(JSON.stringify(records)).not.toContain('Portal do cliente');
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
    const dispatcher = fakeDispatcher();
    const handler = createExecutionsHandler({
      getExecutionDispatcher: async () => dispatcher,
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
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('maps repository factory and query failures without exposing their causes', async () => {
    const { logger, records } = capturedLogger();
    const dispatcher = fakeDispatcher();
    const unavailable = createExecutionsHandler({
      getExecutionDispatcher: async () => dispatcher,
      getExecutionRepository: async () => {
        throw new Error('DATABASE_URL=file:secret.db');
      },
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });
    const failingRepository = fakeRepository();
    failingRepository.list.mockRejectedValueOnce(new Error('query secret'));
    const failingQuery = createExecutionsHandler({
      getExecutionDispatcher: async () => dispatcher,
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
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});
