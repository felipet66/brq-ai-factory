import { createPromptBuilder } from '@brq/prompt-builder';
import { describe, expect, it } from 'vitest';

import { structuredOutputName, toAIRequest } from './ai-request-mapper';
import { quietLogger, createAgentRunRequest } from './testing/agent-runner-fixtures';

describe('Agent Runner AI request mapper', () => {
  it('preserves both rendered channels and maps JSON Schema output deterministically', () => {
    const request = createAgentRunRequest();
    const prompt = createPromptBuilder({ logger: quietLogger() }).build(request.prompt);
    const aiRequest = toAIRequest(prompt, request.model, request.maxOutputTokens);

    expect(aiRequest.instructions).toBe(prompt.rendered.instructions);
    expect(aiRequest.input).toBe(prompt.rendered.input);
    expect(aiRequest.maxOutputTokens).toBe(512);
    expect(aiRequest.responseFormat).toEqual({
      type: 'json_schema',
      name: structuredOutputName(prompt.metadata.outputContractHash),
      schema: prompt.outputContract.format === 'JSON_SCHEMA' ? prompt.outputContract.schema : {},
      strict: true,
    });
    expect(
      aiRequest.responseFormat.type === 'json_schema' && aiRequest.responseFormat.name,
    ).toMatch(/^contract_[a-f0-9]{55}$/);
  });

  it('maps a provider-neutral TEXT contract without structured output', () => {
    const request = createAgentRunRequest();
    const prompt = createPromptBuilder({ logger: quietLogger() }).build({
      ...request.prompt,
      outputContract: {
        id: 'contract:text',
        version: '1.0.0',
        format: 'TEXT',
        instructions: ['Retorne texto simples.'],
      },
    });

    expect(toAIRequest(prompt, 'text-model').responseFormat).toEqual({ type: 'text' });
  });

  it('always derives a provider-safe 64-character name from the contract hash', () => {
    expect(structuredOutputName('a'.repeat(64))).toBe(`contract_${'a'.repeat(55)}`);
    expect(structuredOutputName('a'.repeat(64))).toHaveLength(64);
  });
});
