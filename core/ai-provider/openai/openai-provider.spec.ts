import { createLogger } from '@brq/shared/logger/logger';
import { APIConnectionError, APIError, APIUserAbortError, type OpenAI } from 'openai';
import type { Response } from 'openai/resources/responses/responses';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AIRequest } from '../contracts';
import type { OpenAIConfig } from '../config';
import { AI_PROVIDER_ERROR_CODES } from '../errors';
import { CONTRACT_REQUEST, defineAIProviderContract } from '../testing/ai-provider-contract';
import { OpenAIProvider } from './openai-provider';

const CONFIG: OpenAIConfig = {
  apiKey: 'test-api-key',
  timeoutMs: 60_000,
  maxRetries: 2,
};

function responseFixture(
  overrides: Partial<Response> = {},
  content: Array<
    { type: 'output_text'; text: string; annotations: [] } | { type: 'refusal'; refusal: string }
  > = [{ type: 'output_text', text: 'Resposta fictícia.', annotations: [] }],
): Response {
  return {
    id: 'response_1',
    object: 'response',
    created_at: 1,
    status: 'completed',
    completed_at: 2,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    model: 'test-model',
    output_text: content
      .filter(
        (item): item is Extract<(typeof content)[number], { type: 'output_text' }> =>
          item.type === 'output_text',
      )
      .map((item) => item.text)
      .join(''),
    output: [
      {
        id: 'message_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content,
      },
    ],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    usage: {
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    ...overrides,
  } as Response;
}

function mockClient(create: ReturnType<typeof vi.fn>): Pick<OpenAI, 'responses'> {
  return {
    responses: { create } as unknown as OpenAI['responses'],
  };
}

function silentLogger() {
  return createLogger({ sink: () => undefined });
}

describe('OpenAIProvider contract', () => {
  defineAIProviderContract(
    () =>
      new OpenAIProvider(CONFIG, {
        client: mockClient(vi.fn().mockResolvedValue(responseFixture())),
        logger: silentLogger(),
      }),
  );
});

describe('OpenAIProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails closed for REQUIRE_HIT before invoking the OpenAI client', async () => {
    const create = vi.fn().mockResolvedValue(responseFixture());
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: silentLogger(),
    });

    await expect(
      provider.generate(CONTRACT_REQUEST, { cacheMode: 'REQUIRE_HIT' }),
    ).rejects.toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.CACHE_MISS,
      provider: 'openai',
      retryable: false,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('should map only the abstract contract to the Responses API adapter', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        responseFixture({}, [
          { type: 'output_text', text: '{"status":"SUCCESS"}', annotations: [] },
        ]),
      );
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: silentLogger(),
      now: vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_025),
    });
    const structuredOutputSchema: Extract<
      AIRequest['responseFormat'],
      { type: 'json_schema' }
    >['schema'] = {
      type: 'object',
      properties: {
        status: { type: 'string', pattern: '^[A-Z_]+$', minLength: 1, maxLength: 32 },
        score: { type: 'integer', minimum: 0, maximum: 100 },
        labels: {
          type: 'array',
          items: { $ref: '#/$defs/label' },
          minItems: 1,
          maxItems: 5,
        },
      },
      required: ['status', 'score', 'labels'],
      additionalProperties: false,
      $defs: {
        label: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
    };
    const request: AIRequest = {
      ...CONTRACT_REQUEST,
      instructions: 'SYSTEM_PROMPT_SECRET',
      input: 'USER_INPUT_SECRET',
      maxOutputTokens: 500,
      responseFormat: {
        type: 'json_schema',
        name: 'agent_output',
        description: 'Contrato de teste.',
        schema: structuredOutputSchema,
        strict: true,
      },
    };

    const response = await provider.generate(request);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toEqual({
      model: 'test-model',
      instructions: 'SYSTEM_PROMPT_SECRET',
      input: 'USER_INPUT_SECRET',
      background: false,
      store: false,
      max_output_tokens: 500,
      text: {
        format: {
          type: 'json_schema',
          name: 'agent_output',
          description: 'Contrato de teste.',
          schema: structuredOutputSchema,
          strict: true,
        },
      },
    });
    expect(create.mock.calls[0]?.[1]).toMatchObject({ timeout: 60_000, maxRetries: 0 });
    expect(response).toMatchObject({
      provider: 'openai',
      model: 'test-model',
      structuredData: { status: 'SUCCESS' },
      usage: { inputTokens: 12, outputTokens: 7 },
      metadata: { responseId: 'response_1', durationMs: 25, attempts: 1 },
    });
  });

  it.each([
    ['max_output_tokens', 'MAX_OUTPUT_TOKENS'],
    ['content_filter', 'CONTENT_FILTER'],
  ] as const)('should normalize incomplete response reason %s', async (reason, finishReason) => {
    const create = vi
      .fn()
      .mockResolvedValue(responseFixture({ status: 'incomplete', incomplete_details: { reason } }));
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: silentLogger(),
    });

    await expect(provider.generate(CONTRACT_REQUEST)).resolves.toMatchObject({ finishReason });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('should normalize refusals as functional responses without retrying', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(responseFixture({}, [{ type: 'refusal', refusal: 'Não posso atender.' }]));
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: silentLogger(),
    });

    await expect(provider.generate(CONTRACT_REQUEST)).resolves.toMatchObject({
      content: 'Não posso atender.',
      structuredData: null,
      finishReason: 'REFUSAL',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['{"incomplete":', null],
    ['{"unexpected":true}', { unexpected: true }],
  ] as const)(
    'should return structured content %s without applying a functional schema',
    async (text, parsed) => {
      const create = vi
        .fn()
        .mockResolvedValue(responseFixture({}, [{ type: 'output_text', text, annotations: [] }]));
      const provider = new OpenAIProvider(CONFIG, {
        client: mockClient(create),
        logger: silentLogger(),
      });
      const request: AIRequest = {
        ...CONTRACT_REQUEST,
        responseFormat: {
          type: 'json_schema',
          name: 'expected_result',
          schema: {
            type: 'object',
            properties: { expected: { type: 'string' } },
            required: ['expected'],
          },
          strict: true,
        },
      };

      await expect(provider.generate(request)).resolves.toMatchObject({ structuredData: parsed });
      expect(create).toHaveBeenCalledTimes(1);
    },
  );

  it('should retry only connection failures without an HTTP response', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new APIConnectionError({ cause: new Error('socket-1') }))
      .mockRejectedValueOnce(new APIConnectionError({ cause: new Error('socket-2') }))
      .mockResolvedValue(responseFixture());
    const delays: number[] = [];
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: silentLogger(),
      random: () => 0,
      sleep: async (delay) => {
        delays.push(delay);
      },
    });

    await expect(provider.generate(CONTRACT_REQUEST)).resolves.toMatchObject({
      metadata: { attempts: 3 },
    });
    expect(create).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([125, 250]);
  });

  it.each([
    [400, AI_PROVIDER_ERROR_CODES.INVALID_REQUEST],
    [401, AI_PROVIDER_ERROR_CODES.AUTHENTICATION_FAILED],
    [403, AI_PROVIDER_ERROR_CODES.PERMISSION_DENIED],
    [429, AI_PROVIDER_ERROR_CODES.RATE_LIMITED],
    [500, AI_PROVIDER_ERROR_CODES.UNAVAILABLE],
  ] as const)('should not retry an HTTP %s response', async (status, code) => {
    const create = vi
      .fn()
      .mockRejectedValue(
        APIError.generate(
          status,
          { error: { message: 'provider detail', type: 'error', code: 'error' } },
          undefined,
          new Headers(),
        ),
      );
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: silentLogger(),
      sleep: async () => undefined,
    });

    await expect(provider.generate(CONTRACT_REQUEST)).rejects.toMatchObject({
      code,
      retryable: false,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('should not retry a technically invalid successful HTTP response', async () => {
    const invalidResponse = responseFixture();
    delete (invalidResponse as { usage?: unknown }).usage;
    const create = vi.fn().mockResolvedValue(invalidResponse);
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: silentLogger(),
    });

    await expect(provider.generate(CONTRACT_REQUEST)).rejects.toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
      retryable: false,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('should enforce the overall timeout without retrying', async () => {
    vi.useFakeTimers();
    const create = vi.fn().mockImplementation(
      (_body, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new APIUserAbortError()), {
            once: true,
          });
        }),
    );
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: silentLogger(),
    });

    const pending = provider.generate(CONTRACT_REQUEST, { timeoutMs: 1_000 });
    const rejection = expect(pending).rejects.toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.TIMEOUT,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('should propagate caller cancellation without retrying', async () => {
    const controller = new AbortController();
    const create = vi.fn().mockImplementation(
      (_body, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new APIUserAbortError()), {
            once: true,
          });
        }),
    );
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: silentLogger(),
    });

    const pending = provider.generate(CONTRACT_REQUEST, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: AI_PROVIDER_ERROR_CODES.CANCELLED });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('should emit only sanitized technical metadata', async () => {
    const lines: string[] = [];
    const create = vi
      .fn()
      .mockResolvedValue(
        responseFixture({}, [
          { type: 'output_text', text: 'FULL_RESPONSE_SECRET', annotations: [] },
        ]),
      );
    const provider = new OpenAIProvider(CONFIG, {
      client: mockClient(create),
      logger: createLogger({ sink: (line) => lines.push(line) }),
    });

    await provider.generate(
      {
        ...CONTRACT_REQUEST,
        instructions: 'FULL_PROMPT_SECRET',
        input: 'USER_INPUT_SECRET',
        responseFormat: {
          type: 'json_schema',
          name: 'secret_schema',
          schema: { description: 'FULL_SCHEMA_SECRET' },
          strict: true,
        },
      },
      { requestId: 'request_1', traceId: 'trace_1' },
    );

    const serializedLogs = lines.join('\n');
    expect(serializedLogs).not.toContain('FULL_PROMPT_SECRET');
    expect(serializedLogs).not.toContain('USER_INPUT_SECRET');
    expect(serializedLogs).not.toContain('FULL_RESPONSE_SECRET');
    expect(serializedLogs).not.toContain('FULL_SCHEMA_SECRET');
    expect(serializedLogs).not.toContain('test-api-key');
    expect(serializedLogs).toContain('request_1');
    expect(serializedLogs).toContain('ai.request.completed');
  });
});
