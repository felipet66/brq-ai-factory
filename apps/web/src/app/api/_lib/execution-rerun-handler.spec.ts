// @vitest-environment node

import type { ExecutionRecord, ExecutionRecordRepository } from '@brq/execution-repository';
import {
  EXECUTION_WORKER_ERROR_CODES,
  ExecutionWorkerError,
  type ExecutionRerunDispatcher,
} from '@brq/execution-worker';
import { describe, expect, it, vi } from 'vitest';

import {
  AUTHENTICATED_PRINCIPAL,
  EXECUTION_ID,
  FIXED_REQUEST_ID,
  authenticateRequestFixture,
  capturedLogger,
} from '@/test/api-fixtures';

import { createExecutionRerunHandler } from './execution-rerun-handler';

const CHILD_EXECUTION_ID = `execution-${'b'.repeat(32)}`;
const CHILD_JOB_ID = `job-${'b'.repeat(32)}`;

function sourceRecord(codeGeneratorStatus = 'SUCCESS', status = 'FAILED'): ExecutionRecord {
  return {
    executionId: EXECUTION_ID,
    status,
    factoryResult: {
      stages: [{ stageId: 'CODE_GENERATOR', status: codeGeneratorStatus }],
    },
  } as unknown as ExecutionRecord;
}

function fakeRepository(record: ExecutionRecord | null = sourceRecord()) {
  const findByExecutionId = vi.fn(async () => record);
  return { findByExecutionId } as unknown as ExecutionRecordRepository & {
    readonly findByExecutionId: typeof findByExecutionId;
  };
}

function accepted() {
  return {
    sourceExecutionId: EXECUTION_ID,
    executionId: CHILD_EXECUTION_ID,
    jobId: CHILD_JOB_ID,
    status: 'QUEUED' as const,
    usesOpenAI: false as const,
  };
}

function fakeDispatcher(outcome: ReturnType<typeof accepted> | Error = accepted()) {
  const dispatch = vi.fn<ExecutionRerunDispatcher['dispatch']>(async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  return { dispatch } as ExecutionRerunDispatcher & { readonly dispatch: typeof dispatch };
}

function request(suffix = '', init: RequestInit = {}): Request {
  return new Request(`http://localhost/api/executions/${EXECUTION_ID}/rerun${suffix}`, {
    method: 'POST',
    headers: { origin: 'http://localhost', ...init.headers },
    ...init,
  });
}

function context(id = EXECUTION_ID) {
  return { params: Promise.resolve({ id }) };
}

function handler(repository: ExecutionRecordRepository, dispatcher: ExecutionRerunDispatcher) {
  return createExecutionRerunHandler({
    authenticate: authenticateRequestFixture,
    expectedOrigin: 'http://localhost',
    getExecutionRepository: async () => repository,
    getExecutionRerunDispatcher: async () => dispatcher,
    requestIdFactory: () => FIXED_REQUEST_ID,
    logger: capturedLogger().logger,
    now: () => 10,
  });
}

describe('execution rerun HTTP adapter', () => {
  it('accepts an eligible owner-scoped rerun in strict cache-only mode', async () => {
    const repository = fakeRepository();
    const dispatcher = fakeDispatcher();
    const response = await handler(repository, dispatcher)(request(), context());
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(repository.findByExecutionId).toHaveBeenCalledWith(EXECUTION_ID);
    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      ownerId: AUTHENTICATED_PRINCIPAL.userId,
      sourceExecutionId: EXECUTION_ID,
      requestId: FIXED_REQUEST_ID,
    });
    expect(body).toEqual({
      success: true,
      data: {
        sourceExecutionId: EXECUTION_ID,
        executionId: CHILD_EXECUTION_ID,
        jobId: CHILD_JOB_ID,
        status: 'QUEUED',
        replayMode: 'REQUIRE_CACHE_HIT',
        usesOpenAI: false,
      },
      metadata: {
        requestId: FIXED_REQUEST_ID,
        apiVersion: '4.1.0',
        executionId: CHILD_EXECUTION_ID,
      },
      errors: [],
    });
  });

  it('rejects a body or query parameters before repository access', async () => {
    const repository = fakeRepository();
    const dispatcher = fakeDispatcher();
    const route = handler(repository, dispatcher);

    const bodyResponse = await route(
      request('', { body: '{}', headers: { origin: 'http://localhost' } }),
      context(),
    );
    const queryResponse = await route(request('?retry=1'), context());

    expect(bodyResponse.status).toBe(400);
    expect(queryResponse.status).toBe(400);
    expect(repository.findByExecutionId).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('returns not found without revealing an inaccessible source', async () => {
    const repository = fakeRepository(null);
    const dispatcher = fakeDispatcher();
    const response = await handler(repository, dispatcher)(request(), context());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.errors[0].code).toBe('EXECUTION_NOT_FOUND');
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('requires a successful Code Generator stage on the source execution', async () => {
    const repository = fakeRepository(sourceRecord('FAILED'));
    const dispatcher = fakeDispatcher();
    const response = await handler(repository, dispatcher)(request(), context());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe('EXECUTION_RERUN_SOURCE_NOT_ELIGIBLE');
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-terminal source even when Code Generator already succeeded', async () => {
    const repository = fakeRepository(sourceRecord('SUCCESS', 'RUNNING'));
    const dispatcher = fakeDispatcher();
    const response = await handler(repository, dispatcher)(request(), context());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe('EXECUTION_RERUN_SOURCE_NOT_ELIGIBLE');
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    [EXECUTION_WORKER_ERROR_CODES.SNAPSHOT_NOT_FOUND, 'EXECUTION_RERUN_SNAPSHOT_NOT_FOUND'],
    [EXECUTION_WORKER_ERROR_CODES.SOURCE_NOT_ELIGIBLE, 'EXECUTION_RERUN_SOURCE_NOT_ELIGIBLE'],
    [EXECUTION_WORKER_ERROR_CODES.REGENERATE_REQUIRED, 'EXECUTION_RERUN_REGENERATE_REQUIRED'],
  ] as const)('maps %s deterministically to %s', async (workerCode, apiCode) => {
    const error = new ExecutionWorkerError('sanitized', { code: workerCode });
    const response = await handler(fakeRepository(), fakeDispatcher(error))(request(), context());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe(apiCode);
    expect(JSON.stringify(body)).not.toContain('sanitized');
  });
});
