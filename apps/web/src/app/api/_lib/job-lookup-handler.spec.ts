// @vitest-environment node

import type { ExecutionRecord, ExecutionRecordRepository } from '@brq/execution-repository';
import type { JobStatus } from '@brq/job-queue';
import { describe, expect, it, vi } from 'vitest';

import {
  EXECUTION_ID,
  FIXED_REQUEST_ID,
  authenticateRequestFixture,
  capturedLogger,
} from '@/test/api-fixtures';

import { createJobLookupHandler } from './job-lookup-handler';

const JOB_ID = `job-${'a'.repeat(32)}`;
const UNKNOWN_JOB_ID = `job-${'b'.repeat(32)}`;
const QUEUED_AT = '2026-08-07T10:00:00.000Z';
const STARTED_AT = '2026-08-07T10:00:00.010Z';
const FINISHED_AT = '2026-08-07T10:00:00.040Z';

function executionRecord(status: JobStatus = 'RUNNING'): ExecutionRecord {
  return {
    executionId: EXECUTION_ID,
    projectName: 'private user project',
    traceId: 'private-trace',
    job: {
      jobId: JOB_ID,
      status,
      queuedAt: QUEUED_AT,
      startedAt: status === 'QUEUED' ? null : STARTED_AT,
      finishedAt: ['SUCCESS', 'FAILED', 'CANCELLED'].includes(status) ? FINISHED_AT : null,
    },
  } as ExecutionRecord;
}

function fakeRepository(record: ExecutionRecord | null = executionRecord()) {
  const findByJobId = vi.fn(async () => record);
  return { findByJobId } as unknown as ExecutionRecordRepository & {
    readonly findByJobId: typeof findByJobId;
  };
}

function context(id = JOB_ID) {
  return { params: Promise.resolve({ id }) };
}

describe('job lookup HTTP adapter', () => {
  it.each(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const)(
    'returns minimized %s job metadata',
    async (status) => {
      const repository = fakeRepository(executionRecord(status));
      const { logger, records } = capturedLogger();
      const handler = createJobLookupHandler({
        authenticate: authenticateRequestFixture,
        getExecutionRepository: async () => repository,
        requestIdFactory: () => FIXED_REQUEST_ID,
        logger,
        now: () => 50,
      });

      const response = await handler(new Request(`http://localhost/api/jobs/${JOB_ID}`), context());
      const body = await response.json();
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(200);
      expect(repository.findByJobId).toHaveBeenCalledWith(JOB_ID);
      expect(body).toEqual({
        success: true,
        data: {
          jobId: JOB_ID,
          executionId: EXECUTION_ID,
          status,
          queuedAt: QUEUED_AT,
          startedAt: status === 'QUEUED' ? null : STARTED_AT,
          finishedAt: ['SUCCESS', 'FAILED', 'CANCELLED'].includes(status) ? FINISHED_AT : null,
        },
        metadata: {
          requestId: FIXED_REQUEST_ID,
          apiVersion: '4.1.0',
          executionId: EXECUTION_ID,
        },
        errors: [],
      });
      expect(records.at(-1)).toMatchObject({
        event: 'http.request.completed',
        endpoint: '/api/jobs/[id]',
        method: 'GET',
        statusCode: 200,
        executionId: EXECUTION_ID,
        jobId: JOB_ID,
      });
      expect(serialized).not.toContain('private user project');
      expect(serialized).not.toContain('private-trace');
      expect(JSON.stringify(records)).not.toContain('private user project');
    },
  );

  it('returns a correlated and sanitized 404 for an unknown job', async () => {
    const repository = fakeRepository(null);
    const { logger, records } = capturedLogger();
    const handler = createJobLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });

    const response = await handler(
      new Request(`http://localhost/api/jobs/${UNKNOWN_JOB_ID}`),
      context(UNKNOWN_JOB_ID),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.errors[0].code).toBe('JOB_NOT_FOUND');
    expect(records.at(-1)).toMatchObject({
      event: 'http.request.failed',
      statusCode: 404,
      jobId: UNKNOWN_JOB_ID,
      error: { code: 'JOB_NOT_FOUND' },
    });
  });

  it('rejects malformed IDs, query parameters and methods before repository access', async () => {
    const repository = fakeRepository();
    const handler = createJobLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const malformed = await handler(
      new Request('http://localhost/api/jobs/not-a-job'),
      context('not-a-job'),
    );
    const query = await handler(
      new Request(`http://localhost/api/jobs/${JOB_ID}?payload=true`),
      context(),
    );
    const method = await handler(
      new Request(`http://localhost/api/jobs/${JOB_ID}`, { method: 'POST' }),
      context(),
    );

    expect(malformed.status).toBe(400);
    expect((await malformed.json()).errors[0]).toMatchObject({
      code: 'INVALID_REQUEST',
      path: 'id',
    });
    expect(query.status).toBe(400);
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');
    expect(repository.findByJobId).not.toHaveBeenCalled();
  });

  it('maps repository factory and query failures to sanitized 503 responses', async () => {
    const { logger, records } = capturedLogger();
    const unavailable = createJobLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => {
        throw new Error('DATABASE_URL=file:private.db');
      },
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });
    const repository = fakeRepository();
    repository.findByJobId.mockRejectedValueOnce(new Error('private query payload'));
    const failed = createJobLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });

    for (const handler of [unavailable, failed]) {
      const response = await handler(new Request(`http://localhost/api/jobs/${JOB_ID}`), context());
      expect(response.status).toBe(503);
      expect((await response.json()).errors[0].code).toBe('EXECUTION_REPOSITORY_UNAVAILABLE');
    }
    const logs = JSON.stringify(records);
    expect(logs).not.toContain('private.db');
    expect(logs).not.toContain('private query payload');
  });

  it.each([
    ['missing job', { executionId: EXECUTION_ID, job: null }],
    ['missing execution', { executionId: null, job: executionRecord().job }],
    [
      'uncorrelated job',
      {
        executionId: EXECUTION_ID,
        job: { ...executionRecord().job, jobId: UNKNOWN_JOB_ID },
      },
    ],
  ])('rejects a corrupted record with %s', async (_label, rawRecord) => {
    const repository = fakeRepository(rawRecord as ExecutionRecord);
    const handler = createJobLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const response = await handler(new Request(`http://localhost/api/jobs/${JOB_ID}`), context());

    expect(response.status).toBe(500);
    expect((await response.json()).errors[0].code).toBe('INTERNAL_ERROR');
  });
});
