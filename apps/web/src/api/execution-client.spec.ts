import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EXECUTION_POLL_INTERVAL_MS,
  ExecutionClientError,
  enqueueExecution,
  executeWorkflow,
  getJob,
} from './execution-client';
import type { ExecutionJobStatus } from './execution-contracts';

const FIXED_UUID = '123e4567-e89b-42d3-a456-426614174000';
const EXECUTION_ID = `execution-${'a'.repeat(32)}`;
const JOB_ID = `job-${'b'.repeat(32)}`;
const REQUEST_ID = 'request-123e4567-e89b-12d3-a456-426614174000';
const INPUT = {
  deliveryMode: 'GREENFIELD',
  projectName: 'Portal',
  objective: 'Consultar pedidos.',
} as const;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function metadata(executionId: string | undefined = EXECUTION_ID) {
  return {
    requestId: REQUEST_ID,
    apiVersion: '2.0.0',
    ...(executionId === undefined ? {} : { executionId }),
  };
}

function acceptedEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: { executionId: EXECUTION_ID, jobId: JOB_ID, status: 'QUEUED', ...overrides },
    metadata: metadata(),
    errors: [],
  };
}

function jobEnvelope(status: ExecutionJobStatus, overrides: Record<string, unknown> = {}) {
  const terminal = status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED';
  return {
    success: true,
    data: {
      executionId: EXECUTION_ID,
      jobId: JOB_ID,
      status,
      queuedAt: '2026-08-07T18:00:00.000Z',
      startedAt: status === 'QUEUED' ? null : '2026-08-07T18:00:01.000Z',
      finishedAt: terminal ? '2026-08-07T18:00:02.000Z' : null,
      ...overrides,
    },
    metadata: metadata(),
    errors: [],
  };
}

function errorEnvelope(message = 'O job não foi encontrado.') {
  return {
    success: false,
    data: null,
    metadata: metadata(),
    errors: [{ code: 'JOB_NOT_FOUND', message }],
  };
}

function options(fetchImplementation: FetchImplementation, extra: Record<string, unknown> = {}) {
  return {
    fetchImplementation,
    idFactory: () => FIXED_UUID,
    pollIntervalMs: 0,
    ...extra,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('asynchronous execution HTTP client', () => {
  it('exposes the canonical polling cadence and accepts an execution without polling', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(acceptedEnvelope(), 202),
    );

    const accepted = await enqueueExecution(INPUT, options(fetchImplementation));

    expect(EXECUTION_POLL_INTERVAL_MS).toBe(750);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      '/api/executions',
      expect.objectContaining({ method: 'POST', cache: 'no-store' }),
    );
    expect(accepted).toEqual({
      executionId: EXECUTION_ID,
      jobId: JOB_ID,
      status: 'QUEUED',
      queuedAt: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(Object.isFrozen(accepted)).toBe(true);
  });

  it('loads exactly one correlated job snapshot without scheduling polling', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(jobEnvelope('RUNNING')),
    );

    const job = await getJob(JOB_ID, { fetchImplementation });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(`/api/jobs/${JOB_ID}`, {
      method: 'GET',
      cache: 'no-store',
    });
    expect(job).toMatchObject({ jobId: JOB_ID, executionId: EXECUTION_ID, status: 'RUNNING' });
    expect(Object.isFrozen(job)).toBe(true);
  });

  it.each(['GREENFIELD', 'CHANGE'] as const)(
    'posts the explicit %s delivery mode without projecting a raw delivery intent',
    async (deliveryMode) => {
      const fetchImplementation = vi.fn<FetchImplementation>(async () =>
        jsonResponse(acceptedEnvelope(), 202),
      );

      await enqueueExecution({ ...INPUT, deliveryMode }, options(fetchImplementation));

      const requestBody = JSON.parse(
        String(fetchImplementation.mock.calls[0]?.[1]?.body),
      ) as Record<string, unknown>;
      expect(requestBody.deliveryMode).toBe(deliveryMode);
      expect(requestBody).not.toHaveProperty('deliveryIntent');
    },
  );

  it('rejects an invalid job identifier before issuing a lookup request', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>();

    await expect(getJob('../private', { fetchImplementation })).rejects.toMatchObject({
      code: 'INVALID_JOB_ID',
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('posts once, polls sequentially and exposes only immutable job view models', async () => {
    const responses = [
      jsonResponse(acceptedEnvelope(), 202),
      jsonResponse(jobEnvelope('RUNNING')),
      jsonResponse(jobEnvelope('SUCCESS')),
    ];
    const fetchImplementation = vi.fn<FetchImplementation>(async () => responses.shift()!);
    const updates: unknown[] = [];

    const result = await executeWorkflow(
      {
        deliveryMode: 'GREENFIELD',
        projectName: '  Portal de pedidos  ',
        objective: '  Consultar pedidos.  ',
      },
      options(fetchImplementation, { onJobUpdate: (job: unknown) => updates.push(job) }),
    );

    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    const posts = fetchImplementation.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject([
      '/api/executions',
      {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
      },
    ]);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
      deliveryMode: 'GREENFIELD',
      workflowId: `workflow-${FIXED_UUID}`,
      demand: { title: 'Portal de pedidos', description: 'Consultar pedidos.' },
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
    expect(fetchImplementation.mock.calls.slice(1)).toEqual([
      [`/api/jobs/${JOB_ID}`, expect.objectContaining({ method: 'GET', cache: 'no-store' })],
      [`/api/jobs/${JOB_ID}`, expect.objectContaining({ method: 'GET', cache: 'no-store' })],
    ]);
    expect(updates).toMatchObject([
      { status: 'QUEUED', queuedAt: null },
      { status: 'RUNNING' },
      { status: 'SUCCESS' },
    ]);
    expect(result).toEqual({
      executionId: EXECUTION_ID,
      jobId: JOB_ID,
      status: 'SUCCESS',
      queuedAt: '2026-08-07T18:00:00.000Z',
      startedAt: '2026-08-07T18:00:01.000Z',
      finishedAt: '2026-08-07T18:00:02.000Z',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('workflowResult');
    expect(result).not.toHaveProperty('specifications');
    expect(result).not.toHaveProperty('artifacts');
  });

  it('never overlaps polling requests', async () => {
    const firstPoll = deferred<Response>();
    let getCalls = 0;
    const fetchImplementation = vi.fn<FetchImplementation>(async (_input, init) => {
      if (init?.method === 'POST') return jsonResponse(acceptedEnvelope(), 202);
      getCalls += 1;
      return getCalls === 1 ? firstPoll.promise : jsonResponse(jobEnvelope('SUCCESS'));
    });

    const execution = executeWorkflow(INPUT, options(fetchImplementation));
    await vi.waitFor(() => expect(getCalls).toBe(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(getCalls).toBe(1);

    firstPoll.resolve(jsonResponse(jobEnvelope('RUNNING')));
    await expect(execution).resolves.toMatchObject({ status: 'SUCCESS' });
    expect(getCalls).toBe(2);
  });

  it.each(['FAILED', 'CANCELLED'] as const)(
    'stops polling on %s without reposting the execution',
    async (status) => {
      const fetchImplementation = vi
        .fn<FetchImplementation>()
        .mockResolvedValueOnce(jsonResponse(acceptedEnvelope(), 202))
        .mockResolvedValueOnce(jsonResponse(jobEnvelope(status)));

      await expect(executeWorkflow(INPUT, options(fetchImplementation))).resolves.toMatchObject({
        status,
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
      expect(
        fetchImplementation.mock.calls.filter(([, init]) => init?.method === 'POST'),
      ).toHaveLength(1);
    },
  );

  it('aborts and cleans up while waiting for the next poll', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchImplementation = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(acceptedEnvelope(), 202));
    const updates: unknown[] = [];
    const execution = executeWorkflow(
      INPUT,
      options(fetchImplementation, {
        signal: controller.signal,
        pollIntervalMs: 30_000,
        onJobUpdate: (job: unknown) => updates.push(job),
      }),
    );

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    controller.abort();

    await expect(execution).rejects.toMatchObject({
      name: 'ExecutionClientError',
      code: 'REQUEST_ABORTED',
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates the AbortSignal to the active polling request', async () => {
    const controller = new AbortController();
    let pollingSignal: AbortSignal | undefined;
    const fetchImplementation = vi.fn<FetchImplementation>(async (_input, init) => {
      if (init?.method === 'POST') return jsonResponse(acceptedEnvelope(), 202);
      pollingSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        pollingSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    const execution = executeWorkflow(
      INPUT,
      options(fetchImplementation, { signal: controller.signal }),
    );

    await vi.waitFor(() => expect(pollingSignal).toBe(controller.signal));
    controller.abort();
    await expect(execution).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  });

  it('isolates presentation callbacks from transport', async () => {
    const fetchImplementation = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(acceptedEnvelope(), 202))
      .mockResolvedValueOnce(jsonResponse(jobEnvelope('SUCCESS')));

    await expect(
      executeWorkflow(
        INPUT,
        options(fetchImplementation, {
          onJobUpdate: () => {
            throw new Error('presentation failure');
          },
        }),
      ),
    ).resolves.toMatchObject({ status: 'SUCCESS' });
  });

  it('rejects invalid input and technical configuration before HTTP', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>();

    await expect(
      executeWorkflow(
        { deliveryMode: 'GREENFIELD', projectName: ' ', objective: 'valid' },
        options(fetchImplementation),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      executeWorkflow(
        { ...INPUT, deliveryMode: 'AUTOMATIC' as never },
        options(fetchImplementation),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      executeWorkflow(INPUT, options(fetchImplementation, { idFactory: () => 'unsafe-id' })),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects mismatched job and execution correlation', async () => {
    const fetchImplementation = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(acceptedEnvelope(), 202))
      .mockResolvedValueOnce(
        jsonResponse(jobEnvelope('SUCCESS', { jobId: `job-${'c'.repeat(32)}` })),
      );

    await expect(executeWorkflow(INPUT, options(fetchImplementation))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects invalid success envelopes and non-JSON responses', async () => {
    const invalidEnvelopeFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(acceptedEnvelope({ status: 'RUNNING' }), 202),
    );
    const textFetch = vi.fn<FetchImplementation>(
      async () =>
        new Response('service unavailable', {
          status: 503,
          headers: { 'content-type': 'text/plain' },
        }),
    );

    await expect(executeWorkflow(INPUT, options(invalidEnvelopeFetch))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(executeWorkflow(INPUT, options(textFetch))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('maps valid API errors without exposing response internals', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(errorEnvelope('O serviço está indisponível.'), 503),
    );

    await expect(executeWorkflow(INPUT, options(fetchImplementation))).rejects.toMatchObject({
      name: 'ExecutionClientError',
      code: 'API_ERROR',
      status: 503,
      message: 'O serviço está indisponível.',
      requestId: REQUEST_ID,
      executionId: EXECUTION_ID,
    });
  });

  it('does not retry a failed polling request or repeat the POST', async () => {
    const fetchImplementation = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(acceptedEnvelope(), 202))
      .mockResolvedValueOnce(jsonResponse(errorEnvelope('Falha ao consultar o job.'), 503));

    await expect(executeWorkflow(INPUT, options(fetchImplementation))).rejects.toMatchObject({
      code: 'API_ERROR',
      status: 503,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(
      fetchImplementation.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });

  it('requires the exact transport statuses for acceptance and job lookup', async () => {
    const invalidAcceptance = vi.fn<FetchImplementation>(async () =>
      jsonResponse(acceptedEnvelope(), 200),
    );
    const invalidLookup = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(acceptedEnvelope(), 202))
      .mockResolvedValueOnce(jsonResponse(jobEnvelope('SUCCESS'), 202));

    await expect(executeWorkflow(INPUT, options(invalidAcceptance))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
    });
    await expect(executeWorkflow(INPUT, options(invalidLookup))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 202,
    });
  });

  it('maps network failures and preserves the typed error contract', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () => {
      throw new Error('socket secret');
    });

    const error = await executeWorkflow(INPUT, options(fetchImplementation)).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ExecutionClientError);
    expect(error).toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Não foi possível conectar ao serviço de execução.',
    });
    expect(String(error)).not.toContain('socket secret');
  });
});
