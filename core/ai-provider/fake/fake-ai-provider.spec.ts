import { describe, expect, it } from 'vitest';

import { AI_PROVIDER_ERROR_CODES } from '../errors';
import { CONTRACT_REQUEST, defineAIProviderContract } from '../testing/ai-provider-contract';
import { FakeAIProvider, type FakeAIProviderOutcome } from './fake-ai-provider';

describe('FakeAIProvider contract', () => {
  defineAIProviderContract(() => new FakeAIProvider());
});

describe('FakeAIProvider scenarios', () => {
  it.each<[FakeAIProviderOutcome['type'], string, boolean]>([
    ['timeout', AI_PROVIDER_ERROR_CODES.TIMEOUT, false],
    ['cancelled', AI_PROVIDER_ERROR_CODES.CANCELLED, false],
    ['rate_limit', AI_PROVIDER_ERROR_CODES.RATE_LIMITED, false],
    ['invalid_response', AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE, false],
    ['transient_failure', AI_PROVIDER_ERROR_CODES.CONNECTION_FAILED, true],
    ['permanent_failure', AI_PROVIDER_ERROR_CODES.FAILURE, false],
  ])('should simulate %s deterministically', async (type, code, retryable) => {
    const provider = new FakeAIProvider([{ type } as FakeAIProviderOutcome]);

    await expect(provider.generate(CONTRACT_REQUEST)).rejects.toMatchObject({ code, retryable });
  });

  it('should simulate malformed JSON without classifying it as a transport retry', async () => {
    const provider = new FakeAIProvider([{ type: 'malformed_json' }]);
    const response = await provider.generate({
      ...CONTRACT_REQUEST,
      responseFormat: {
        type: 'json_schema',
        name: 'result',
        schema: { type: 'object' },
        strict: true,
      },
    });

    expect(response.content).toBe('{"incomplete":');
    expect(response.structuredData).toBeNull();
    expect(response.metadata.attempts).toBe(1);
  });

  it('should simulate a valid JSON value incompatible with the requested schema', async () => {
    const provider = new FakeAIProvider([{ type: 'incompatible_structured_output' }]);
    const response = await provider.generate({
      ...CONTRACT_REQUEST,
      responseFormat: {
        type: 'json_schema',
        name: 'result',
        schema: {
          type: 'object',
          properties: { expected: { type: 'string' } },
          required: ['expected'],
        },
        strict: true,
      },
    });

    expect(response.structuredData).toEqual({ unexpected: true });
  });

  it('should honor an already aborted caller signal and capture calls', async () => {
    const controller = new AbortController();
    const provider = new FakeAIProvider();
    controller.abort();

    await expect(
      provider.generate(CONTRACT_REQUEST, { signal: controller.signal, requestId: 'request_1' }),
    ).rejects.toMatchObject({ code: AI_PROVIDER_ERROR_CODES.CANCELLED });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request).toEqual(CONTRACT_REQUEST);
  });
});
