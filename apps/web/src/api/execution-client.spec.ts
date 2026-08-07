import { describe, expect, it, vi } from 'vitest';
import { executionObservabilitySnapshotSchema } from '@brq/observability';

import { ExecutionClientError, executeWorkflow } from './execution-client';

const FIXED_UUID = '123e4567-e89b-42d3-a456-426614174000';
const EXECUTION_ID = `execution-${'a'.repeat(32)}`;
const REQUEST_ID = 'request-123e4567-e89b-12d3-a456-426614174000';
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function executionData(overrides: Record<string, unknown> = {}) {
  return {
    executionId: EXECUTION_ID,
    workflowId: 'workflow-001',
    status: 'SUCCESS',
    metrics: { observed: { totalDurationMs: 321, orchestratorInvocations: 1 } },
    hashes: {
      executionRequestHash: '1'.repeat(64),
      workflowRequestHash: '2'.repeat(64),
      workflowHash: '3'.repeat(64),
      lineageHash: '4'.repeat(64),
      provenanceHash: '5'.repeat(64),
      executionHash: '6'.repeat(64),
    },
    lineage: {
      outputs: {
        productOwnerSpecificationHash: `sha256:${'7'.repeat(64)}`,
        technicalSpecificationHash: `sha256:${'8'.repeat(64)}`,
        qaSpecificationHash: `sha256:${'9'.repeat(64)}`,
      },
      handoffs: [{ verified: true }, { verified: true }],
    },
    provenance: {
      stages: [
        {
          stage: 'PRODUCT_OWNER',
          agentVersion: '1.0.0',
          outcome: 'GENERATED',
          readiness: 'READY',
          secretInternalField: 'must-not-cross-the-client-boundary',
        },
        {
          stage: 'DEVELOPER',
          agentVersion: '1.0.0',
          outcome: 'GENERATED',
          readiness: 'PARTIALLY_READY',
        },
        {
          stage: 'QA',
          agentVersion: '1.0.0',
          outcome: 'GENERATED',
          readiness: 'REQUIRES_CLARIFICATION',
        },
      ],
    },
    specifications: { sensitive: 'never projected' },
    ...overrides,
  };
}

function observabilityData(overrides: Record<string, unknown> = {}) {
  const stages = [
    ['KNOWLEDGE', 'Knowledge'],
    ['PRODUCT_OWNER', 'Product Owner'],
    ['DEVELOPER', 'Developer'],
    ['QA', 'QA'],
  ].map(([stageId, stageName]) => ({
    stageId,
    stageName,
    status: 'SUCCESS',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.010Z',
    durationMs: 10,
    requestId: REQUEST_ID,
    executionId: EXECUTION_ID,
  }));
  const stageMetrics = ['PRODUCT_OWNER', 'DEVELOPER', 'QA'].map((stageId) => ({
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
  }));

  return {
    observabilityVersion: '1.0.0',
    revision: 9,
    executionId: EXECUTION_ID,
    workflowId: `workflow-${FIXED_UUID}`,
    requestId: REQUEST_ID,
    status: 'SUCCESS',
    updatedAt: '2026-01-01T00:00:00.010Z',
    events: [
      {
        sequence: 1,
        type: 'execution.started',
        stageId: 'EXECUTION',
        stageName: 'Execution',
        status: 'RUNNING',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: null,
        durationMs: null,
        requestId: REQUEST_ID,
        executionId: EXECUTION_ID,
        errorCode: null,
      },
    ],
    stages,
    stageMetrics,
    summary: {
      executionId: EXECUTION_ID,
      workflowStatus: 'SUCCESS',
      readinessFinal: 'REQUIRES_CLARIFICATION',
      totalDurationMs: 321,
      totalTokens: 90,
      totalCostEstimate: {
        amount: 0.0012,
        currency: 'USD',
        rateCardVersion: '1.0.0',
      },
      executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
      skippedStages: [],
      hashes: {
        executionRequestHash: '1'.repeat(64),
        workflowRequestHash: '2'.repeat(64),
        workflowHash: '3'.repeat(64),
        lineageHash: '4'.repeat(64),
        provenanceHash: '5'.repeat(64),
        executionHash: '6'.repeat(64),
      },
    },
    ...overrides,
  };
}

function successEnvelope(data = executionData()) {
  return {
    success: true,
    data,
    metadata: {
      requestId: REQUEST_ID,
      apiVersion: '1.0.0',
      executionId: EXECUTION_ID,
    },
    errors: [],
  };
}

function timelineEnvelope(data = observabilityData()) {
  return {
    success: true,
    data,
    metadata: {
      requestId: REQUEST_ID,
      apiVersion: '1.0.0',
      executionId: EXECUTION_ID,
    },
    errors: [],
  };
}

function successfulFetch(data = executionData(), timeline = observabilityData()) {
  return vi.fn<FetchImplementation>(async (input) =>
    String(input) === '/api/executions'
      ? jsonResponse(successEnvelope(data))
      : jsonResponse(timelineEnvelope(timeline)),
  );
}

function clientOptions(fetchImplementation: FetchImplementation) {
  return {
    fetchImplementation,
    idFactory: () => FIXED_UUID,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('execution HTTP client', () => {
  it('normalizes form input and calls only the same-origin executions endpoint', async () => {
    const fetchImplementation = successfulFetch();

    await executeWorkflow(
      { projectName: '  Portal de pedidos  ', objective: '  Consultar pedidos.  ' },
      clientOptions(fetchImplementation),
    );

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImplementation.mock.calls.find(
      ([input]) => input === '/api/executions',
    )!;
    expect(url).toBe('/api/executions');
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      workflowId: `workflow-${FIXED_UUID}`,
      demand: {
        title: 'Portal de pedidos',
        description: 'Consultar pedidos.',
      },
      agents: {
        productOwner: {
          agentExecutionId: `product-owner-${FIXED_UUID}`,
          agentVersion: '1.0.0',
          model: 'gpt-5-mini',
        },
        developer: {
          agentExecutionId: `developer-${FIXED_UUID}`,
          agentVersion: '1.0.0',
          model: 'gpt-5-mini',
        },
        qa: {
          agentExecutionId: `qa-${FIXED_UUID}`,
          agentVersion: '1.0.0',
          model: 'gpt-5-mini',
        },
      },
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/${EXECUTION_ID}/timeline`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('projects the raw ExecutionResult into the only presentation contract', async () => {
    const fetchImplementation = successfulFetch();

    const summary = await executeWorkflow(
      { projectName: 'Portal', objective: 'Consultar pedidos.' },
      clientOptions(fetchImplementation),
    );

    expect(summary).toEqual({
      executionId: EXECUTION_ID,
      status: 'SUCCESS',
      durationMs: 321,
      readiness: 'REQUIRES_CLARIFICATION',
      hashes: {
        executionRequestHash: '1'.repeat(64),
        workflowRequestHash: '2'.repeat(64),
        workflowHash: '3'.repeat(64),
        lineageHash: '4'.repeat(64),
        provenanceHash: '5'.repeat(64),
        executionHash: '6'.repeat(64),
      },
      lineage: { outputCount: 3, verifiedHandoffs: 2 },
      provenance: {
        stages: [
          {
            stage: 'PRODUCT_OWNER',
            agentVersion: '1.0.0',
            outcome: 'GENERATED',
            readiness: 'READY',
          },
          {
            stage: 'DEVELOPER',
            agentVersion: '1.0.0',
            outcome: 'GENERATED',
            readiness: 'PARTIALLY_READY',
          },
          {
            stage: 'QA',
            agentVersion: '1.0.0',
            outcome: 'GENERATED',
            readiness: 'REQUIRES_CLARIFICATION',
          },
        ],
      },
      observability: {
        revision: 9,
        status: 'SUCCESS',
        stages: [
          { stageId: 'KNOWLEDGE', stageName: 'Knowledge', status: 'SUCCESS', durationMs: 10 },
          {
            stageId: 'PRODUCT_OWNER',
            stageName: 'Product Owner',
            status: 'SUCCESS',
            durationMs: 10,
          },
          { stageId: 'DEVELOPER', stageName: 'Developer', status: 'SUCCESS', durationMs: 10 },
          { stageId: 'QA', stageName: 'QA', status: 'SUCCESS', durationMs: 10 },
        ],
        stageMetrics: [
          {
            stageId: 'PRODUCT_OWNER',
            durationMs: 10,
            promptBytes: 100,
            completionBytes: 50,
            inputTokens: 20,
            outputTokens: 10,
            totalTokens: 30,
            providerLatencyMs: 8,
            validationDurationMs: 1,
            artifactGenerationDurationMs: 1,
          },
          {
            stageId: 'DEVELOPER',
            durationMs: 10,
            promptBytes: 100,
            completionBytes: 50,
            inputTokens: 20,
            outputTokens: 10,
            totalTokens: 30,
            providerLatencyMs: 8,
            validationDurationMs: 1,
            artifactGenerationDurationMs: 1,
          },
          {
            stageId: 'QA',
            durationMs: 10,
            promptBytes: 100,
            completionBytes: 50,
            inputTokens: 20,
            outputTokens: 10,
            totalTokens: 30,
            providerLatencyMs: 8,
            validationDurationMs: 1,
            artifactGenerationDurationMs: 1,
          },
        ],
        summary: {
          totalTokens: 90,
          totalCostEstimate: {
            amount: 0.0012,
            currency: 'USD',
            rateCardVersion: '1.0.0',
          },
          executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
          skippedStages: [],
        },
      },
    });
    expect(JSON.stringify(summary)).not.toContain('specifications');
    expect(JSON.stringify(summary)).not.toContain('secretInternalField');
    expect(JSON.stringify(summary)).not.toContain('requestId');
    expect(JSON.stringify(summary)).not.toContain('events');
  });

  it('polls live metadata by workflowId, tolerates a transient 404 and reconciles by executionId', async () => {
    const post = deferred<Response>();
    const observations: Exclude<
      Awaited<ReturnType<typeof executeWorkflow>>['observability'],
      null
    >[] = [];
    let workflowReads = 0;
    const runningStages = observabilityData().stages.map((stage) => ({
      ...stage,
      status: stage.stageId === 'PRODUCT_OWNER' ? 'RUNNING' : 'PENDING',
      finishedAt: null,
      durationMs: null,
    }));
    const running = observabilityData({
      revision: 2,
      status: 'RUNNING',
      stages: runningStages,
      summary: null,
    });
    const fetchImplementation = vi.fn<FetchImplementation>(async (input) => {
      const url = String(input);
      if (url === '/api/executions') return post.promise;
      if (url.includes(`workflow-${FIXED_UUID}`)) {
        workflowReads += 1;
        if (workflowReads === 1) return jsonResponse({ unavailable: true }, 404);
        return jsonResponse(timelineEnvelope(workflowReads === 2 ? running : observabilityData()));
      }
      return jsonResponse(timelineEnvelope());
    });

    const execution = executeWorkflow(
      { projectName: 'Portal', objective: 'Consultar pedidos.' },
      {
        ...clientOptions(fetchImplementation),
        onObservability: (observability) => observations.push(observability),
        pollIntervalMs: 0,
      },
    );

    await vi.waitFor(() =>
      expect(observations.some((observation) => observation.revision === 2)).toBe(true),
    );
    post.resolve(jsonResponse(successEnvelope()));

    const summary = await execution;
    expect(summary.observability).toMatchObject({ revision: 9, status: 'SUCCESS' });
    expect(observations.at(-1)).toEqual(summary.observability);
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/workflow-${FIXED_UUID}/timeline`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/${EXECUTION_ID}/timeline`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('keeps observability transport failures degradable', async () => {
    const callback = vi.fn();
    const fetchImplementation = vi.fn<FetchImplementation>(async (input) =>
      String(input) === '/api/executions'
        ? jsonResponse(successEnvelope())
        : jsonResponse({ internal: 'must-not-reach-the-presentation' }, 503),
    );

    const summary = await executeWorkflow(
      { projectName: 'Portal', objective: 'Consultar pedidos.' },
      {
        ...clientOptions(fetchImplementation),
        onObservability: callback,
        pollIntervalMs: 0,
      },
    );

    expect(summary.status).toBe('SUCCESS');
    expect(summary.observability).toBeNull();
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not let a hanging timeline request block a completed workflow', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async (input) => {
      if (String(input) === '/api/executions') return jsonResponse(successEnvelope());
      return new Promise<Response>(() => undefined);
    });

    await expect(
      executeWorkflow(
        { projectName: 'Portal', objective: 'Consultar pedidos.' },
        {
          ...clientOptions(fetchImplementation),
          onObservability: () => undefined,
          pollIntervalMs: 0,
          timelineRequestTimeoutMs: 1,
        },
      ),
    ).resolves.toMatchObject({ status: 'SUCCESS', observability: null });
  });

  it('aborts an in-flight timeline read with the caller request', async () => {
    const controller = new AbortController();
    let timelineSignal: AbortSignal | undefined;
    const fetchImplementation = vi.fn<FetchImplementation>((input, init) => {
      const signal = init?.signal;
      if (String(input) !== '/api/executions') timelineSignal = signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted transport', 'AbortError')),
          { once: true },
        );
      });
    });

    const execution = executeWorkflow(
      { projectName: 'Portal', objective: 'Consultar pedidos.' },
      {
        ...clientOptions(fetchImplementation),
        signal: controller.signal,
        onObservability: () => undefined,
        pollIntervalMs: 0,
      },
    );
    await vi.waitFor(() => expect(timelineSignal).toBeDefined());
    controller.abort();

    await expect(execution).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(timelineSignal?.aborted).toBe(true);
    expect(
      fetchImplementation.mock.calls.filter(([input]) => String(input).includes('/timeline')),
    ).toHaveLength(1);
  });

  it('keeps the browser fixture aligned with the public observability contract', () => {
    expect(executionObservabilitySnapshotSchema.safeParse(observabilityData()).success).toBe(true);
  });

  it('isolates presentation callback failures from the execution result', async () => {
    await expect(
      executeWorkflow(
        { projectName: 'Portal', objective: 'Consultar pedidos.' },
        {
          ...clientOptions(successfulFetch()),
          onObservability: () => {
            throw new Error('presentation observer failed');
          },
          pollIntervalMs: 0,
        },
      ),
    ).resolves.toMatchObject({ status: 'SUCCESS', observability: { status: 'SUCCESS' } });
  });

  it('treats a functional FAILED result with nullable workflow data as a valid summary', async () => {
    const data = executionData({
      status: 'FAILED',
      lineage: null,
      provenance: null,
      hashes: {
        executionRequestHash: '1'.repeat(64),
        workflowRequestHash: '2'.repeat(64),
        workflowHash: null,
        lineageHash: null,
        provenanceHash: null,
        executionHash: '6'.repeat(64),
      },
    });
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(data)),
    );

    await expect(
      executeWorkflow(
        { projectName: 'Portal', objective: 'Consultar pedidos.' },
        clientOptions(fetchImplementation),
      ),
    ).resolves.toMatchObject({
      status: 'FAILED',
      readiness: null,
      lineage: null,
      provenance: null,
    });
  });

  it('propagates the AbortSignal without adding retry behavior', async () => {
    const controller = new AbortController();
    const fetchImplementation = successfulFetch();

    await executeWorkflow(
      { projectName: 'Portal', objective: 'Consultar pedidos.' },
      { ...clientOptions(fetchImplementation), signal: controller.signal },
    );

    expect(fetchImplementation).toHaveBeenCalledWith(
      '/api/executions',
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(
      fetchImplementation.mock.calls.filter(([input]) => input === '/api/executions'),
    ).toHaveLength(1);
  });

  it.each([
    [{ projectName: '', objective: 'Objetivo' }, 'INVALID_INPUT'],
    [{ projectName: 'Projeto', objective: ' ' }, 'INVALID_INPUT'],
    [{ projectName: 'x'.repeat(201), objective: 'Objetivo' }, 'INVALID_INPUT'],
    [{ projectName: 'Projeto', objective: 'x'.repeat(16_001) }, 'INVALID_INPUT'],
  ] as const)('rejects invalid form input before HTTP', async (input, code) => {
    const fetchImplementation = vi.fn<FetchImplementation>();

    await expect(executeWorkflow(input, clientOptions(fetchImplementation))).rejects.toMatchObject({
      code,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects invalid temporary identifiers and host profiles before HTTP', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>();
    const input = { projectName: 'Portal', objective: 'Consultar pedidos.' };

    await expect(
      executeWorkflow(input, {
        ...clientOptions(fetchImplementation),
        idFactory: () => 'invalid-id',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(
      executeWorkflow(input, {
        ...clientOptions(fetchImplementation),
        profile: {
          productOwner: { agentVersion: 'latest', model: 'model' },
          developer: { agentVersion: '1.0.0', model: 'model' },
          qa: { agentVersion: '1.0.0', model: 'model' },
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('uses only the sanitized API error and observable request metadata', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        {
          success: false,
          data: null,
          metadata: { requestId: REQUEST_ID, apiVersion: '1.0.0' },
          errors: [{ code: 'INVALID_REQUEST', message: 'A requisição é inválida.' }],
        },
        400,
      ),
    );

    await expect(
      executeWorkflow(
        { projectName: 'Portal', objective: 'Consultar pedidos.' },
        clientOptions(fetchImplementation),
      ),
    ).rejects.toMatchObject({
      code: 'API_ERROR',
      status: 400,
      requestId: REQUEST_ID,
      message: 'A requisição é inválida.',
    });
  });

  it.each([
    ['non-JSON response', () => new Response('<html>sensitive</html>', { status: 502 })],
    [
      'malformed JSON',
      () =>
        new Response('{', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    [
      'invalid success envelope',
      () => jsonResponse({ ...successEnvelope(), metadata: { requestId: REQUEST_ID } }),
    ],
    [
      'mismatched execution identifier',
      () =>
        jsonResponse({
          ...successEnvelope(),
          metadata: {
            requestId: REQUEST_ID,
            apiVersion: '1.0.0',
            executionId: `execution-${'b'.repeat(32)}`,
          },
        }),
    ],
  ])('rejects $label without exposing response content', async (_label, responseFactory) => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () => responseFactory());

    await expect(
      executeWorkflow(
        { projectName: 'Portal', objective: 'Consultar pedidos.' },
        clientOptions(fetchImplementation),
      ),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/API_ERROR|INVALID_RESPONSE/),
      message: expect.not.stringContaining('sensitive'),
    });
  });

  it('maps network and cancellation failures without leaking their causes', async () => {
    const networkFetch = vi.fn<FetchImplementation>(async () => {
      throw new Error('OPENAI_API_KEY=secret');
    });
    const controller = new AbortController();
    controller.abort();
    const abortedFetch = vi.fn<FetchImplementation>(async () => {
      throw new DOMException('private payload', 'AbortError');
    });
    const input = { projectName: 'Portal', objective: 'Consultar pedidos.' };

    const network = executeWorkflow(input, clientOptions(networkFetch));
    const aborted = executeWorkflow(input, {
      ...clientOptions(abortedFetch),
      signal: controller.signal,
    });

    await expect(network).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: expect.not.stringContaining('secret'),
    });
    await expect(aborted).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
      message: expect.not.stringContaining('private payload'),
    });
  });

  it('exposes typed safe errors to the presentation coordinator', () => {
    const error = new ExecutionClientError('safe', {
      code: 'API_ERROR',
      status: 503,
      requestId: REQUEST_ID,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'ExecutionClientError',
      message: 'safe',
      code: 'API_ERROR',
      status: 503,
      requestId: REQUEST_ID,
    });
  });
});
