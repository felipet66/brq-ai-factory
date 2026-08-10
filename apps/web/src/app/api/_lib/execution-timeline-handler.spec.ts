// @vitest-environment node

import type { ExecutionRecord, ExecutionRecordRepository } from '@brq/execution-repository';
import type {
  ExecutionObservabilitySnapshot,
  ExecutionStageMetrics,
  FactoryExecutionObservabilitySnapshot,
} from '@brq/observability';
import { describe, expect, it, vi } from 'vitest';

import {
  EXECUTION_ID,
  FIXED_REQUEST_ID,
  authenticateRequestFixture,
  capturedLogger,
} from '@/test/api-fixtures';

import { createExecutionTimelineHandler } from './execution-timeline-handler';

const WORKFLOW_ID = 'workflow-123e4567-e89b-12d3-a456-426614174000';
const UNKNOWN_EXECUTION_ID = `execution-${'b'.repeat(32)}`;
const AGENT_STAGE_IDS = ['PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const;

function emptyStageMetrics(stageId: ExecutionStageMetrics['stageId']): ExecutionStageMetrics {
  return {
    stageId,
    durationMs: null,
    promptBytes: null,
    completionBytes: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    providerLatencyMs: null,
    validationDurationMs: null,
    artifactGenerationDurationMs: null,
  };
}

const SNAPSHOT = {
  observabilityVersion: '1.0.0',
  revision: 3,
  executionId: EXECUTION_ID,
  workflowId: WORKFLOW_ID,
  requestId: FIXED_REQUEST_ID,
  status: 'RUNNING',
  updatedAt: '2026-08-07T10:00:00.002Z',
  events: [
    {
      sequence: 1,
      type: 'execution.started',
      stageId: 'EXECUTION',
      stageName: 'Execution',
      status: 'RUNNING',
      startedAt: '2026-08-07T10:00:00.000Z',
      finishedAt: null,
      durationMs: null,
      requestId: FIXED_REQUEST_ID,
      executionId: EXECUTION_ID,
      errorCode: null,
    },
    {
      sequence: 2,
      type: 'stage.started',
      stageId: 'KNOWLEDGE',
      stageName: 'Knowledge',
      status: 'RUNNING',
      startedAt: '2026-08-07T10:00:00.001Z',
      finishedAt: null,
      durationMs: null,
      requestId: FIXED_REQUEST_ID,
      executionId: EXECUTION_ID,
      errorCode: null,
    },
  ],
  stages: [
    {
      stageId: 'KNOWLEDGE',
      stageName: 'Knowledge',
      status: 'RUNNING',
      startedAt: '2026-08-07T10:00:00.001Z',
      finishedAt: null,
      durationMs: null,
      requestId: FIXED_REQUEST_ID,
      executionId: EXECUTION_ID,
    },
    {
      stageId: 'PRODUCT_OWNER',
      stageName: 'Product Owner',
      status: 'PENDING',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      requestId: FIXED_REQUEST_ID,
      executionId: EXECUTION_ID,
    },
    {
      stageId: 'DEVELOPER',
      stageName: 'Developer',
      status: 'PENDING',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      requestId: FIXED_REQUEST_ID,
      executionId: EXECUTION_ID,
    },
    {
      stageId: 'QA',
      stageName: 'QA',
      status: 'PENDING',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      requestId: FIXED_REQUEST_ID,
      executionId: EXECUTION_ID,
    },
  ],
  stageMetrics: AGENT_STAGE_IDS.map(emptyStageMetrics),
  summary: null,
} as const satisfies ExecutionObservabilitySnapshot;

const FACTORY_SNAPSHOT = {
  ...SNAPSHOT,
  observabilityVersion: '2.0.0',
  revision: 4,
  stages: [
    ...SNAPSHOT.stages,
    ...[
      ['CODE_GENERATOR', 'Code Generator'],
      ['WORKSPACE', 'Controlled Workspace'],
      ['SANDBOX_PREPARE', 'Prepare'],
      ['SANDBOX_TYPECHECK', 'Typecheck'],
      ['SANDBOX_BUILD', 'Build'],
      ['SANDBOX_TEST', 'Test'],
    ].map(([stageId, stageName]) => ({
      stageId,
      stageName,
      status: 'PENDING' as const,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      requestId: FIXED_REQUEST_ID,
      executionId: EXECUTION_ID,
    })),
  ],
} as FactoryExecutionObservabilitySnapshot;

function record(snapshot: ExecutionObservabilitySnapshot = SNAPSHOT): ExecutionRecord {
  return { observation: snapshot } as ExecutionRecord;
}

function fakeRepository() {
  const findByExecutionId = vi.fn(async (id: string) => (id === EXECUTION_ID ? record() : null));
  const findByWorkflowId = vi.fn(async (id: string) => (id === WORKFLOW_ID ? record() : null));
  return { findByExecutionId, findByWorkflowId } as unknown as ExecutionRecordRepository & {
    readonly findByExecutionId: typeof findByExecutionId;
    readonly findByWorkflowId: typeof findByWorkflowId;
  };
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('execution timeline HTTP adapter', () => {
  it('returns an existing snapshot in the standard secure envelope', async () => {
    const repository = fakeRepository();
    const { logger, records } = capturedLogger();
    const handler = createExecutionTimelineHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      logger,
      now: () => 50,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}/timeline`),
      context(EXECUTION_ID),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: SNAPSHOT,
      metadata: {
        requestId: FIXED_REQUEST_ID,
        apiVersion: '3.2.0',
        executionId: EXECUTION_ID,
      },
      errors: [],
    });
    expect(repository.findByExecutionId).toHaveBeenCalledOnce();
    expect(repository.findByExecutionId).toHaveBeenCalledWith(EXECUTION_ID);
    expect(repository.findByWorkflowId).not.toHaveBeenCalled();
    expect(response.headers.get('x-request-id')).toBe(FIXED_REQUEST_ID);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(records.map((record) => record.event)).toEqual([
      'http.request.started',
      'http.request.completed',
    ]);
    expect(records.at(-1)).toMatchObject({
      endpoint: '/api/executions/[id]/timeline',
      method: 'GET',
      statusCode: 200,
      executionId: EXECUTION_ID,
    });
    const logs = JSON.stringify(records);
    expect(logs).not.toContain(WORKFLOW_ID);
    expect(logs).not.toContain('Knowledge');
    expect(logs).not.toContain('stageMetrics');
  });

  it('returns the additive Observability v2 snapshot through the same endpoint', async () => {
    const repository = fakeRepository();
    repository.findByExecutionId.mockResolvedValueOnce(record(FACTORY_SNAPSHOT));
    const handler = createExecutionTimelineHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      logger: capturedLogger().logger,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}/timeline`),
      context(EXECUTION_ID),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.observabilityVersion).toBe('2.0.0');
    expect(body.data.stages).toHaveLength(10);
    expect(body.data.stages.map((stage: { stageId: string }) => stage.stageId).slice(4)).toEqual([
      'CODE_GENERATOR',
      'WORKSPACE',
      'SANDBOX_PREPARE',
      'SANDBOX_TYPECHECK',
      'SANDBOX_BUILD',
      'SANDBOX_TEST',
    ]);
  });

  it('looks up an active timeline by its workflowId alias', async () => {
    const repository = fakeRepository();
    const handler = createExecutionTimelineHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      logger: capturedLogger().logger,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${WORKFLOW_ID}/timeline`),
      context(WORKFLOW_ID),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('RUNNING');
    expect(body.data.executionId).toBe(EXECUTION_ID);
    expect(body.metadata.executionId).toBe(EXECUTION_ID);
    expect(repository.findByWorkflowId).toHaveBeenCalledWith(WORKFLOW_ID);
    expect(repository.findByExecutionId).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown valid identifier', async () => {
    const repository = fakeRepository();
    const handler = createExecutionTimelineHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      logger: capturedLogger().logger,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${UNKNOWN_EXECUTION_ID}/timeline`),
      context(UNKNOWN_EXECUTION_ID),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      success: false,
      data: null,
      metadata: { requestId: FIXED_REQUEST_ID, apiVersion: '3.2.0' },
      errors: [
        {
          code: 'EXECUTION_TIMELINE_NOT_FOUND',
          message: 'A timeline da execução não foi encontrada.',
        },
      ],
    });
    expect(repository.findByExecutionId).toHaveBeenCalledWith(UNKNOWN_EXECUTION_ID);
  });

  it('rejects malformed identifiers and query parameters before lookup', async () => {
    const repository = fakeRepository();
    const handler = createExecutionTimelineHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      logger: capturedLogger().logger,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    const invalid = await handler(
      new Request('http://localhost/api/executions/not-an-id/timeline'),
      context('not-an-id'),
    );
    const query = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}/timeline?include=content`),
      context(EXECUTION_ID),
    );

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      success: false,
      data: null,
      errors: [{ code: 'INVALID_REQUEST', path: 'id' }],
    });
    expect(query.status).toBe(400);
    expect(await query.json()).toMatchObject({
      success: false,
      data: null,
      errors: [{ code: 'INVALID_REQUEST' }],
    });
    expect(repository.findByExecutionId).not.toHaveBeenCalled();
    expect(repository.findByWorkflowId).not.toHaveBeenCalled();
  });

  it('returns a standardized 405 without consulting history', async () => {
    const repository = fakeRepository();
    const handler = createExecutionTimelineHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      logger: capturedLogger().logger,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}/timeline`, {
        method: 'DELETE',
      }),
      context(EXECUTION_ID),
    );
    const body = await response.json();

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(body).toMatchObject({
      success: false,
      data: null,
      metadata: { requestId: FIXED_REQUEST_ID, apiVersion: '3.2.0' },
      errors: [{ code: 'METHOD_NOT_ALLOWED' }],
    });
    expect(repository.findByExecutionId).not.toHaveBeenCalled();
    expect(repository.findByWorkflowId).not.toHaveBeenCalled();
  });

  it('maps repository failures to a sanitized 503 response', async () => {
    const repository = fakeRepository();
    repository.findByExecutionId.mockRejectedValueOnce(new Error('file:private-database.db'));
    const { logger, records } = capturedLogger();
    const handler = createExecutionTimelineHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      logger,
      requestIdFactory: () => FIXED_REQUEST_ID,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}/timeline`),
      context(EXECUTION_ID),
    );
    const serialized = JSON.stringify(await response.json()) + JSON.stringify(records);

    expect(response.status).toBe(503);
    expect(serialized).toContain('EXECUTION_REPOSITORY_UNAVAILABLE');
    expect(serialized).not.toContain('private-database.db');
  });
});
