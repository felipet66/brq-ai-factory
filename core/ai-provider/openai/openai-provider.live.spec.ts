import { describe, expect, it } from 'vitest';

import { OpenAIProvider } from './openai-provider';

const liveTestsEnabled = process.env.RUN_OPENAI_LIVE_TESTS === 'true';

describe.runIf(liveTestsEnabled)('OpenAIProvider live', () => {
  it('should complete one explicitly enabled synthetic request', async () => {
    const model = process.env.OPENAI_LIVE_TEST_MODEL;
    if (model === undefined || model.trim().length === 0) {
      throw new Error('OPENAI_LIVE_TEST_MODEL é obrigatória para o teste live.');
    }

    const provider = OpenAIProvider.fromEnvironment(process.env);
    const response = await provider.generate({
      model,
      instructions: 'Responda de forma concisa usando apenas dados fictícios.',
      input: 'Retorne exatamente a palavra OK.',
      responseFormat: { type: 'text' },
      maxOutputTokens: 16,
    });

    expect(response.content.trim().length).toBeGreaterThan(0);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
  });
});
