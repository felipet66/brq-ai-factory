import { expect, it } from 'vitest';

import type { AIProvider } from '../ai-provider';
import type { AIRequest } from '../contracts';
import { AIProviderError, AI_PROVIDER_ERROR_CODES } from '../errors';
import { aiResponseSchema } from '../schemas';

export const CONTRACT_REQUEST: AIRequest = {
  model: 'test-model',
  instructions: 'Use somente dados fictícios.',
  input: 'Retorne uma resposta curta.',
  responseFormat: { type: 'text' },
};

export function defineAIProviderContract(factory: () => AIProvider): void {
  it('should expose a provider name and return the canonical response contract', async () => {
    const provider = factory();
    const response = await provider.generate(CONTRACT_REQUEST);

    expect(provider.provider).not.toHaveLength(0);
    expect(aiResponseSchema.safeParse(response).success).toBe(true);
    expect(response.model).toBe(CONTRACT_REQUEST.model);
  });

  it('should reject an invalid abstract request before calling a model', async () => {
    const provider = factory();
    const invalidRequest = {
      ...CONTRACT_REQUEST,
      input: '   ',
    } as AIRequest;

    await expect(provider.generate(invalidRequest)).rejects.toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
      retryable: false,
    } satisfies Partial<AIProviderError>);
  });
}
