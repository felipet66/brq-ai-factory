import type { AIProvider, AIResponse } from '@brq/ai-provider';
import { AIProviderError, AI_PROVIDER_ERROR_CODES, aiResponseSchema } from '@brq/ai-provider';
import { FakeAIProvider, type FakeAIProviderOutcome } from '@brq/ai-provider/fake';
import {
  PROMPT_BUILDER_ERROR_CODES,
  PromptBuilderError,
  createPromptBuilder,
  type PromptBuilder,
} from '@brq/prompt-builder';
import { describe, expect, it, vi } from 'vitest';

import { createAgentRunner } from './agent-runner';
import type { AgentRunRequest } from './contracts';
import { AGENT_RUN_ERROR_CODES, AgentRunError } from './errors';
import {
  createAgentRunRequest,
  deterministicNow,
  quietLogger,
  runnerDependencies,
} from './testing/agent-runner-fixtures';

function response(overrides: Partial<AIResponse> = {}): AIResponse {
  return aiResponseSchema.parse({
    provider: 'fake',
    model: 'resolved-test-model',
    content: 'Resposta técnica.',
    structuredData: { summary: 'ok' },
    finishReason: 'COMPLETED',
    usage: { inputTokens: 21, outputTokens: 8 },
    metadata: { responseId: 'response-1', durationMs: 17, attempts: 2 },
    ...overrides,
  });
}

function providerReturning(value: unknown, provider = 'fake'): AIProvider {
  return {
    provider,
    generate: vi.fn(async () => value as AIResponse),
  };
}

describe('Agent Runner', () => {
  it('executes one deterministic run and separates observed from reported metrics', async () => {
    const aiProvider = new FakeAIProvider([{ type: 'success', response: response() }]);
    const runner = createAgentRunner(runnerDependencies(aiProvider));
    const request = createAgentRunRequest();
    const result = await runner.run(request);

    expect(aiProvider.calls).toHaveLength(1);
    expect(aiProvider.calls[0]?.options).toMatchObject({
      timeoutMs: 30_000,
      requestId: 'request-1',
      traceId: 'trace-1',
    });
    expect(result.provider).toEqual({
      provider: 'fake',
      requestedModel: 'test-model',
      responseModel: 'resolved-test-model',
      responseId: 'response-1',
    });
    expect(result.metrics.observed).toMatchObject({
      totalDurationMs: 50,
      promptBuilderDurationMs: 10,
      providerDurationMs: 10,
    });
    expect(result.metrics.observed.bytesSent).toBeGreaterThan(0);
    expect(result.metrics.observed.bytesReceived).toBeGreaterThan(0);
    expect(result.metrics.reported).toEqual({
      durationMs: 17,
      attempts: 2,
      usage: { inputTokens: 21, outputTokens: 8 },
    });
    expect(result.output).toMatchObject({
      content: 'Resposta técnica.',
      structuredData: { summary: 'ok' },
      finishReason: 'COMPLETED',
      responseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect('response' in result).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.output)).toBe(true);
    expect(Object.isFrozen(result.output.structuredData)).toBe(true);
  });

  it('passes the rendered channels and all technical options without mutation', async () => {
    const request = createAgentRunRequest();
    const snapshot = structuredClone(request);
    const controller = new AbortController();
    const provider = new FakeAIProvider();
    const builder = createPromptBuilder({ logger: quietLogger() });
    const expectedPrompt = builder.build(request.prompt);
    const runner = createAgentRunner(
      runnerDependencies(provider, { promptBuilder: builder, now: deterministicNow() }),
    );

    await runner.run(request, { signal: controller.signal });

    expect(provider.calls[0]?.request.instructions).toBe(expectedPrompt.rendered.instructions);
    expect(provider.calls[0]?.request.input).toBe(expectedPrompt.rendered.input);
    expect(provider.calls[0]?.request.model).toBe('test-model');
    expect(provider.calls[0]?.request.maxOutputTokens).toBe(512);
    expect(provider.calls[0]?.options.signal).toBe(controller.signal);
    expect(request).toEqual(snapshot);
  });

  it.each<FakeAIProviderOutcome['type']>(['malformed_json', 'incompatible_structured_output'])(
    'keeps %s for the future Response Validator',
    async (type) => {
      const runner = createAgentRunner(
        runnerDependencies(new FakeAIProvider([{ type } as FakeAIProviderOutcome])),
      );

      const result = await runner.run(createAgentRunRequest());

      expect(result.output.finishReason).toBe('COMPLETED');
      expect(result.output.responseHash).toMatch(/^[a-f0-9]{64}$/);
    },
  );

  it.each(['MAX_OUTPUT_TOKENS', 'CONTENT_FILTER', 'REFUSAL'] as const)(
    'returns the technically valid %s finish reason without retry',
    async (finishReason) => {
      const provider = providerReturning(response({ finishReason }));
      const runner = createAgentRunner(runnerDependencies(provider));

      await expect(runner.run(createAgentRunRequest())).resolves.toMatchObject({
        output: { finishReason },
      });
      expect(provider.generate).toHaveBeenCalledOnce();
    },
  );

  it('maps provider timeout without implementing a second attempt', async () => {
    const provider = new FakeAIProvider([{ type: 'timeout' }]);
    const runner = createAgentRunner(runnerDependencies(provider));

    await expect(runner.run(createAgentRunRequest())).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.TIMEOUT,
      sourceCode: AI_PROVIDER_ERROR_CODES.TIMEOUT,
      stage: 'PROVIDER_CALL',
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('maps an unavailable provider and preserves its diagnostic retry hint without acting on it', async () => {
    const provider: AIProvider = {
      provider: 'unavailable',
      generate: vi.fn(async () => {
        throw new AIProviderError('Unavailable.', {
          code: AI_PROVIDER_ERROR_CODES.UNAVAILABLE,
          provider: 'unavailable',
          retryable: true,
        });
      }),
    };
    const runner = createAgentRunner(runnerDependencies(provider));

    await expect(runner.run(createAgentRunRequest())).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.PROVIDER_FAILED,
      provider: 'unavailable',
      providerRetryable: true,
      sourceCode: AI_PROVIDER_ERROR_CODES.UNAVAILABLE,
    });
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it('short-circuits an already cancelled request before building a prompt', async () => {
    const controller = new AbortController();
    controller.abort();
    const promptBuilder: PromptBuilder = { build: vi.fn() };
    const provider = new FakeAIProvider();
    const runner = createAgentRunner(runnerDependencies(provider, { promptBuilder }));

    await expect(
      runner.run(createAgentRunRequest(), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AgentRunError);
    await expect(
      runner.run(createAgentRunRequest(), { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.CANCELLED,
    });
    expect(promptBuilder.build).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });

  it('propagates the exact AbortSignal during an in-flight provider cancellation', async () => {
    const controller = new AbortController();
    const generate = vi.fn<AIProvider['generate']>(async (_request, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      throw new AIProviderError('Cancelled.', {
        code: AI_PROVIDER_ERROR_CODES.CANCELLED,
        provider: 'blocking',
      });
    });
    const provider: AIProvider = { provider: 'blocking', generate };
    const runner = createAgentRunner(runnerDependencies(provider));

    await expect(
      runner.run(createAgentRunRequest(), { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.CANCELLED,
      stage: 'PROVIDER_CALL',
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('translates a Prompt Builder failure and never calls the provider', async () => {
    const promptBuilder: PromptBuilder = {
      build: vi.fn(() => {
        throw new PromptBuilderError('Invalid prompt.', {
          code: PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED,
        });
      }),
    };
    const provider = new FakeAIProvider();
    const runner = createAgentRunner(runnerDependencies(provider, { promptBuilder }));

    await expect(runner.run(createAgentRunRequest())).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.PROMPT_BUILD_FAILED,
      sourceCode: PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED,
      stage: 'PROMPT_BUILD',
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects an invalid result returned by an injected Prompt Builder', async () => {
    const promptBuilder: PromptBuilder = {
      build: vi.fn(() => ({ metadata: {} }) as never),
    };
    const provider = new FakeAIProvider();
    const runner = createAgentRunner(runnerDependencies(provider, { promptBuilder }));

    await expect(runner.run(createAgentRunRequest())).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.INVALID_PROMPT_RESULT,
      stage: 'PROMPT_VALIDATION',
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects a malformed provider response and a provider identity mismatch', async () => {
    const invalidProvider = providerReturning({ provider: 'fake' });
    const mismatchedProvider = providerReturning(response({ provider: 'other' }));

    await expect(
      createAgentRunner(runnerDependencies(invalidProvider)).run(createAgentRunRequest()),
    ).rejects.toMatchObject({ code: AGENT_RUN_ERROR_CODES.INVALID_PROVIDER_RESPONSE });
    await expect(
      createAgentRunner(runnerDependencies(mismatchedProvider)).run(createAgentRunRequest()),
    ).rejects.toMatchObject({ code: AGENT_RUN_ERROR_CODES.INVALID_PROVIDER_RESPONSE });
    expect(invalidProvider.generate).toHaveBeenCalledOnce();
    expect(mismatchedProvider.generate).toHaveBeenCalledOnce();
  });

  it('rejects invalid configuration and invalid request data with local errors', async () => {
    expect(() =>
      createAgentRunner({
        promptBuilder: {} as PromptBuilder,
        aiProvider: new FakeAIProvider(),
      }),
    ).toThrowError(expect.objectContaining({ code: AGENT_RUN_ERROR_CODES.INVALID_CONFIGURATION }));

    const runner = createAgentRunner(runnerDependencies(new FakeAIProvider()));
    const request = { ...createAgentRunRequest(), model: '   ' } as AgentRunRequest;

    await expect(runner.run(request)).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
    });
    await expect(
      runner.run(createAgentRunRequest(), { signal: { aborted: false } as AbortSignal }),
    ).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
    });
    await expect(
      runner.run(createAgentRunRequest(), { signal: undefined, extra: true } as never),
    ).rejects.toMatchObject({
      code: AGENT_RUN_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
    });
  });

  it('produces the same response hash for the same normalized response', async () => {
    const first = await createAgentRunner(
      runnerDependencies(new FakeAIProvider([{ type: 'success', response: response() }])),
    ).run(createAgentRunRequest());
    const second = await createAgentRunner(
      runnerDependencies(new FakeAIProvider([{ type: 'success', response: response() }])),
    ).run(createAgentRunRequest());

    expect(second.output.responseHash).toBe(first.output.responseHash);
  });

  it('logs only allowlisted technical metadata', async () => {
    const lines: string[] = [];
    const privateInput = 'PRIVATE_INPUT_12345';
    const privateRule = 'PRIVATE_RULE_67890';
    const privateSchemaKey = 'PRIVATE_SCHEMA_24680';
    const privateResponse = 'PRIVATE_RESPONSE_13579';
    const base = createAgentRunRequest();
    if (base.prompt.outputContract.format !== 'JSON_SCHEMA') {
      throw new TypeError('Fixture must contain a JSON Schema output contract.');
    }
    const request: AgentRunRequest = {
      ...base,
      prompt: {
        ...base.prompt,
        variables: [{ name: 'USER_INPUT', value: privateInput }],
        ruleSets: base.prompt.ruleSets.map((ruleSet) =>
          ruleSet.scope === 'AGENT'
            ? {
                ...ruleSet,
                rules: [{ id: 'developer:private', content: privateRule }],
              }
            : ruleSet,
        ),
        outputContract: {
          ...base.prompt.outputContract,
          schema: {
            ...base.prompt.outputContract.schema,
            properties: { [privateSchemaKey]: { type: 'string' } },
          },
        },
      },
    };
    const provider = providerReturning(
      response({ content: privateResponse, structuredData: { secretResult: privateResponse } }),
    );
    const runner = createAgentRunner(
      runnerDependencies(provider, {
        logger: quietLogger(lines),
      }),
    );

    await runner.run(request);

    const logs = lines.join('\n');
    expect(logs).toContain('agent.run.completed');
    expect(logs).toContain('usageInputCount');
    expect(logs).not.toContain('[REDACTED]');
    expect(logs).not.toContain(privateInput);
    expect(logs).not.toContain(privateRule);
    expect(logs).not.toContain(privateSchemaKey);
    expect(logs).not.toContain(privateResponse);
    expect(logs).not.toContain('structuredData');
    expect(logs).not.toContain('"schema":');
  });
});
