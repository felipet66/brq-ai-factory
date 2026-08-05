import { describe, expect, it } from 'vitest';

import { DEFAULT_OPENAI_MAX_RETRIES, DEFAULT_OPENAI_TIMEOUT_MS, parseOpenAIConfig } from './config';
import { AIProviderError, AI_PROVIDER_ERROR_CODES } from './errors';

describe('parseOpenAIConfig', () => {
  it('should apply secure server-side defaults', () => {
    expect(parseOpenAIConfig({ OPENAI_API_KEY: 'test-key' })).toEqual({
      apiKey: 'test-key',
      timeoutMs: DEFAULT_OPENAI_TIMEOUT_MS,
      maxRetries: DEFAULT_OPENAI_MAX_RETRIES,
    });
    expect(DEFAULT_OPENAI_TIMEOUT_MS).toBe(60_000);
  });

  it('should accept bounded timeout and retry overrides', () => {
    expect(
      parseOpenAIConfig({
        OPENAI_API_KEY: 'test-key',
        OPENAI_TIMEOUT_MS: '90000',
        OPENAI_MAX_RETRIES: '1',
      }),
    ).toEqual({ apiKey: 'test-key', timeoutMs: 90_000, maxRetries: 1 });
  });

  it('should reject missing secrets without including validation details in the message', () => {
    expect.assertions(3);

    try {
      parseOpenAIConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(AIProviderError);
      expect(error).toMatchObject({ code: AI_PROVIDER_ERROR_CODES.INVALID_CONFIGURATION });
      expect((error as Error).message).not.toContain('OPENAI_API_KEY');
    }
  });

  it.each([
    { OPENAI_TIMEOUT_MS: '999' },
    { OPENAI_TIMEOUT_MS: '600001' },
    { OPENAI_MAX_RETRIES: '-1' },
    { OPENAI_MAX_RETRIES: '6' },
  ])('should reject unsafe limits: %j', (overrides) => {
    expect(() => parseOpenAIConfig({ OPENAI_API_KEY: 'test-key', ...overrides })).toThrow(
      AIProviderError,
    );
  });
});
