import { describe, expect, it, vi } from 'vitest';

import { getExecution, getExecutionTimeline, listExecutions } from './execution-history-client';

const EXECUTION_ID = `execution-${'a'.repeat(32)}`;
const OTHER_EXECUTION_ID = `execution-${'b'.repeat(32)}`;
const HASH = '1'.repeat(64);
const KNOWLEDGE_HASH = `sha256:${'2'.repeat(64)}`;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function metadata(executionId?: string) {
  return {
    requestId: 'request-123e4567-e89b-12d3-a456-426614174000',
    apiVersion: '1.0.0',
    ...(executionId === undefined ? {} : { executionId }),
  };
}

function successEnvelope(data: unknown, executionId?: string) {
  return { success: true, data, metadata: metadata(executionId), errors: [] };
}

function historyItem(overrides: Record<string, unknown> = {}) {
  return {
    executionId: EXECUTION_ID,
    workflowId: 'workflow-001',
    projectName: 'Customer Portal',
    status: 'SUCCESS',
    readiness: 'READY',
    startedAt: '2026-08-07T10:00:00.000Z',
    finishedAt: '2026-08-07T10:00:00.250Z',
    durationMs: 250,
    ...overrides,
  };
}

function detailData(overrides: Record<string, unknown> = {}) {
  return {
    ...historyItem(),
    createdAt: '2026-08-07T09:59:59.999Z',
    requestId: 'request-123e4567-e89b-12d3-a456-426614174000',
    metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    hashes: {
      executionRequestHash: HASH,
      workflowRequestHash: HASH,
      workflowHash: HASH,
      lineageHash: HASH,
      provenanceHash: HASH,
      executionHash: HASH,
    },
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
      privateValue: 'must not cross the presentation boundary',
    },
    provenance: {
      stages: [
        {
          stage: 'PRODUCT_OWNER',
          agent: 'PRODUCT_OWNER',
          executionId: EXECUTION_ID,
          agentExecutionId: 'po-001',
          agentVersion: '1.0.1',
          outcome: 'GENERATED',
          readiness: 'READY',
          hashes: {
            assetBundleHash: HASH,
            knowledgeContextHash: KNOWLEDGE_HASH,
            promptHash: HASH,
            responseHash: HASH,
            validationHash: HASH,
            generationHash: HASH,
            artifactHashes: [HASH],
          },
          privateValue: 'must not cross the presentation boundary',
        },
      ],
    },
    rawResponse: 'must not cross the presentation boundary',
    ...overrides,
  };
}

function timelineData(overrides: Record<string, unknown> = {}) {
  return {
    observabilityVersion: '1.0.0',
    revision: 9,
    executionId: EXECUTION_ID,
    workflowId: 'workflow-001',
    requestId: 'request-123e4567-e89b-12d3-a456-426614174000',
    status: 'SUCCESS',
    updatedAt: '2026-08-07T10:00:00.250Z',
    events: [{ raw: 'not projected' }],
    stages: [
      ['KNOWLEDGE', 'Knowledge'],
      ['PRODUCT_OWNER', 'Product Owner'],
      ['DEVELOPER', 'Developer'],
      ['QA', 'QA'],
    ].map(([stageId, stageName]) => ({
      stageId,
      stageName,
      status: 'SUCCESS',
      startedAt: '2026-08-07T10:00:00.000Z',
      finishedAt: '2026-08-07T10:00:00.010Z',
      durationMs: 10,
      requestId: 'request-001',
      executionId: EXECUTION_ID,
    })),
    stageMetrics: ['PRODUCT_OWNER', 'DEVELOPER', 'QA'].map((stageId) => ({
      stageId,
      durationMs: 10,
      promptBytes: 100,
      completionBytes: 50,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      providerLatencyMs: 8,
      validationDurationMs: 1,
      artifactGenerationDurationMs: 1,
    })),
    summary: {
      executionId: EXECUTION_ID,
      workflowStatus: 'SUCCESS',
      readinessFinal: 'READY',
      totalDurationMs: 250,
      totalTokens: 90,
      totalCostEstimate: { amount: 0.001, currency: 'USD', rateCardVersion: '1.0.0' },
      executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
      skippedStages: [],
      hashes: {
        executionRequestHash: HASH,
        workflowRequestHash: HASH,
        workflowHash: HASH,
        lineageHash: HASH,
        provenanceHash: HASH,
        executionHash: HASH,
      },
    },
    ...overrides,
  };
}

describe('execution history HTTP client', () => {
  it('builds the canonical list query and projects immutable list items', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope({
          items: [historyItem({ privateValue: 'not projected' })],
          nextCursor: 'cursor-002',
        }),
      ),
    );

    const result = await listExecutions(
      {
        status: 'SUCCESS',
        readiness: ' READY ',
        createdAfter: '2026-08-01T00:00:00.000Z',
        createdBefore: '2026-08-31T23:59:59.999Z',
        limit: 20,
        cursor: ' cursor-001 ',
      },
      { fetchImplementation },
    );

    expect(fetchImplementation).toHaveBeenCalledWith(
      '/api/executions?status=SUCCESS&readiness=READY&createdAfter=2026-08-01T00%3A00%3A00.000Z&createdBefore=2026-08-31T23%3A59%3A59.999Z&limit=20&cursor=cursor-001',
      {
        method: 'GET',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      },
    );
    expect(result).toEqual({ items: [historyItem()], nextCursor: 'cursor-002' });
    expect(result.items[0]).not.toHaveProperty('privateValue');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
  });

  it('rejects invalid filters before HTTP is called', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>();

    await expect(
      listExecutions(
        {
          createdAfter: '2026-09-01T00:00:00.000Z',
          createdBefore: '2026-08-01T00:00:00.000Z',
        },
        { fetchImplementation },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FILTERS' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('validates and minimizes persisted execution detail', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(detailData(), EXECUTION_ID)),
    );

    const detail = await getExecution(EXECUTION_ID, { fetchImplementation });

    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/${EXECUTION_ID}`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(detail).not.toHaveProperty('rawResponse');
    expect(detail.lineage).not.toHaveProperty('privateValue');
    expect(detail.provenance?.stages[0]).not.toHaveProperty('privateValue');
    expect(detail.lineage?.handoffs[0]).toEqual({
      from: 'PRODUCT_OWNER',
      to: 'DEVELOPER',
      specification: 'PRODUCT_OWNER_SPECIFICATION',
      verified: true,
    });
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.provenance?.stages[0]?.hashes.artifactHashes)).toBe(true);
  });

  it('rejects an uncorrelated detail and an invalid execution identifier', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(detailData({ executionId: OTHER_EXECUTION_ID }))),
    );

    await expect(getExecution(EXECUTION_ID, { fetchImplementation })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(getExecution('../secret', { fetchImplementation })).rejects.toMatchObject({
      code: 'INVALID_EXECUTION_ID',
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('loads the persisted timeline and projects only presentation metadata', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(timelineData(), EXECUTION_ID)),
    );

    const timeline = await getExecutionTimeline(EXECUTION_ID, { fetchImplementation });

    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/${EXECUTION_ID}/timeline`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(timeline).not.toHaveProperty('events');
    expect(timeline.stages).toHaveLength(4);
    expect(timeline.stageMetrics).toHaveLength(3);
    expect(timeline.summary?.totalTokens).toBe(90);
    expect(Object.isFrozen(timeline.stages)).toBe(true);
  });

  it('surfaces a sanitized API error with request correlation', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        {
          success: false,
          data: null,
          metadata: metadata(),
          errors: [{ code: 'EXECUTION_NOT_FOUND', message: 'Execution not found.' }],
        },
        404,
      ),
    );

    await expect(getExecution(EXECUTION_ID, { fetchImplementation })).rejects.toEqual(
      expect.objectContaining({
        name: 'ExecutionHistoryClientError',
        code: 'API_ERROR',
        status: 404,
        requestId: 'request-123e4567-e89b-12d3-a456-426614174000',
        message: 'Execution not found.',
      }),
    );
  });

  it('rejects malformed and non-JSON responses without leaking their body', async () => {
    const malformedFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope({ items: 'secret malformed payload', nextCursor: null })),
    );
    const textFetch = vi.fn<FetchImplementation>(
      async () =>
        new Response('secret internal response', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    );

    await expect(listExecutions({}, { fetchImplementation: malformedFetch })).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
    await expect(listExecutions({}, { fetchImplementation: textFetch })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'The execution history response is invalid.',
    });
  });

  it('maps network and cancellation failures separately', async () => {
    const networkFetch = vi.fn<FetchImplementation>(async () => {
      throw new Error('secret network internals');
    });
    const controller = new AbortController();
    controller.abort();
    const abortedFetch = vi.fn<FetchImplementation>(async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    await expect(listExecutions({}, { fetchImplementation: networkFetch })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Execution history is unavailable.',
    });
    await expect(
      listExecutions({}, { fetchImplementation: abortedFetch, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  });
});
