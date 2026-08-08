// @vitest-environment node

import type { ExecutionRecord, ExecutionRecordRepository } from '@brq/execution-repository';
import { describe, expect, it, vi } from 'vitest';

import {
  EXECUTION_ID,
  FIXED_REQUEST_ID,
  authenticateRequestFixture,
  capturedLogger,
} from '@/test/api-fixtures';

import { createExecutionLookupHandler } from './execution-lookup-handler';

const HASH = '1'.repeat(64);
const KNOWLEDGE_HASH = `sha256:${'2'.repeat(64)}`;

function executionRecord(): ExecutionRecord {
  return {
    storageId: 'storage-private',
    workflowId: 'workflow-001',
    executionId: EXECUTION_ID,
    requestId: FIXED_REQUEST_ID,
    traceId: 'trace-private',
    projectName: 'Portal do cliente',
    status: 'SUCCESS',
    workflowStatus: 'SUCCESS',
    readiness: 'READY',
    createdAt: '2026-08-07T09:59:59.999Z',
    startedAt: '2026-08-07T10:00:00.000Z',
    finishedAt: '2026-08-07T10:00:00.250Z',
    durationMs: 250,
    job: {
      jobId: `job-${'b'.repeat(32)}`,
      status: 'SUCCESS',
      queuedAt: '2026-08-07T09:59:59.000Z',
      startedAt: '2026-08-07T10:00:00.000Z',
      finishedAt: '2026-08-07T10:00:00.250Z',
    },
    metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    hashes: {
      executionRequestHash: HASH,
      workflowRequestHash: HASH,
      workflowHash: HASH,
      lineageHash: HASH,
      provenanceHash: HASH,
      executionHash: HASH,
    },
    failure: null,
    lineage: {
      outputs: {
        productOwnerSpecificationHash: KNOWLEDGE_HASH,
        technicalSpecificationHash: KNOWLEDGE_HASH,
        qaSpecificationHash: KNOWLEDGE_HASH,
      },
      handoffs: [
        {
          from: 'PRODUCT_OWNER',
          to: 'DEVELOPER',
          specification: 'PRODUCT_OWNER_SPECIFICATION',
          calculatedHash: KNOWLEDGE_HASH,
          declaredHash: KNOWLEDGE_HASH,
          verified: true,
        },
      ],
    },
    provenance: {
      stages: [
        {
          stage: 'PRODUCT_OWNER',
          agent: 'PRODUCT_OWNER',
          executionId: EXECUTION_ID,
          agentExecutionId: 'product-owner-private',
          agentVersion: '1.0.1',
          outcome: 'GENERATED',
          readiness: 'READY',
          assetBundleHash: HASH,
          knowledgeContextHash: KNOWLEDGE_HASH,
          promptHash: HASH,
          responseHash: HASH,
          validationHash: HASH,
          generationHash: HASH,
          artifactHashes: [HASH],
        },
      ],
    },
    observation: null,
    lifecycle: [
      {
        sequence: 1,
        event: 'EXECUTION_CREATED',
        state: 'CREATED',
        occurredAt: '2026-08-07T09:59:59.999Z',
        durationMs: null,
      },
      {
        sequence: 2,
        event: 'EXECUTION_RUNNING',
        state: 'RUNNING',
        occurredAt: '2026-08-07T10:00:00.000Z',
        durationMs: null,
      },
      {
        sequence: 3,
        event: 'EXECUTION_FINISHED',
        state: 'SUCCESS',
        occurredAt: '2026-08-07T10:00:00.250Z',
        durationMs: 250,
      },
    ],
    revision: 3,
  };
}

function fakeRepository(record: ExecutionRecord | null = executionRecord()) {
  const findByExecutionId = vi.fn(async () => record);
  return { findByExecutionId } as unknown as ExecutionRecordRepository & {
    readonly findByExecutionId: typeof findByExecutionId;
  };
}

function context(id = EXECUTION_ID) {
  return { params: Promise.resolve({ id }) };
}

describe('execution lookup HTTP adapter', () => {
  it('returns the minimized persisted detail without private repository fields', async () => {
    const repository = fakeRepository();
    const { logger, records } = capturedLogger();
    const handler = createExecutionLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
      now: () => 50,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}`),
      context(),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(repository.findByExecutionId).toHaveBeenCalledWith(EXECUTION_ID);
    expect(body.data).toMatchObject({
      executionId: EXECUTION_ID,
      workflowId: 'workflow-001',
      projectName: 'Portal do cliente',
      status: 'SUCCESS',
      readiness: 'READY',
      job: {
        jobId: `job-${'b'.repeat(32)}`,
        status: 'SUCCESS',
        queuedAt: '2026-08-07T09:59:59.000Z',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: '2026-08-07T10:00:00.250Z',
      },
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
      lineage: {
        handoffs: [
          {
            from: 'PRODUCT_OWNER',
            to: 'DEVELOPER',
            specification: 'PRODUCT_OWNER_SPECIFICATION',
            verified: true,
          },
        ],
      },
      provenance: {
        stages: [
          {
            stage: 'PRODUCT_OWNER',
            agentVersion: '1.0.1',
            outcome: 'GENERATED',
            readiness: 'READY',
            hashes: { artifactHashes: [HASH] },
          },
        ],
      },
    });
    expect(body.metadata.executionId).toBe(EXECUTION_ID);
    expect(serialized).not.toContain('storage-private');
    expect(serialized).not.toContain('trace-private');
    expect(serialized).not.toContain('product-owner-private');
    expect(serialized).not.toContain('calculatedHash');
    expect(serialized).not.toContain('lifecycle');
    expect(serialized).not.toContain('observation');
    expect(JSON.stringify(records)).not.toContain('Portal do cliente');
  });

  it('returns 404 for an unknown execution', async () => {
    const repository = fakeRepository(null);
    const handler = createExecutionLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}`),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.errors[0].code).toBe('EXECUTION_NOT_FOUND');
    expect(body.metadata.executionId).toBe(EXECUTION_ID);
  });

  it('rejects malformed identifiers, query parameters and methods before lookup', async () => {
    const repository = fakeRepository();
    const handler = createExecutionLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });
    const invalid = await handler(
      new Request('http://localhost/api/executions/not-an-id'),
      context('not-an-id'),
    );
    const query = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}?full=true`),
      context(),
    );
    const method = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}`, { method: 'DELETE' }),
      context(),
    );

    expect(invalid.status).toBe(400);
    expect(query.status).toBe(400);
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');
    expect(repository.findByExecutionId).not.toHaveBeenCalled();
  });

  it('maps repository unavailability and sanitizes its cause', async () => {
    const { logger, records } = capturedLogger();
    const handler = createExecutionLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => {
        throw new Error('DATABASE_URL=file:private.db');
      },
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}`),
      context(),
    );
    const serialized = JSON.stringify(await response.json()) + JSON.stringify(records);

    expect(response.status).toBe(503);
    expect(serialized).toContain('EXECUTION_REPOSITORY_UNAVAILABLE');
    expect(serialized).not.toContain('private.db');
  });

  it('rejects a corrupted repository record at the HTTP projection boundary', async () => {
    const malformed = { ...executionRecord(), executionId: null } as ExecutionRecord;
    const repository = fakeRepository(malformed);
    const handler = createExecutionLookupHandler({
      authenticate: authenticateRequestFixture,
      getExecutionRepository: async () => repository,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger: capturedLogger().logger,
    });

    const response = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}`),
      context(),
    );

    expect(response.status).toBe(500);
    expect((await response.json()).errors[0].code).toBe('INTERNAL_ERROR');
  });
});
