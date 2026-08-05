import { describe, expect, it } from 'vitest';

import {
  aiGenerateMetadataSchema,
  aiRequestSchema,
  aiResponseFormatSchema,
  aiResponseSchema,
} from './schemas';

describe('AI provider schemas', () => {
  it('should accept abstract text and structured requests', () => {
    expect(
      aiRequestSchema.safeParse({
        model: 'test-model',
        instructions: 'Instruções já montadas.',
        input: 'Entrada já montada.',
        responseFormat: { type: 'text' },
      }).success,
    ).toBe(true);

    expect(
      aiResponseFormatSchema.safeParse({
        type: 'json_schema',
        name: 'agent_output-1',
        description: 'Contrato fictício.',
        schema: {
          type: 'object',
          properties: { status: { type: 'string' } },
          required: ['status'],
          additionalProperties: false,
        },
        strict: true,
      }).success,
    ).toBe(true);
  });

  it.each(['', 'with space', 'path/schema', 'a'.repeat(65)])(
    'should reject unsafe structured output name %j',
    (name) => {
      expect(
        aiResponseFormatSchema.safeParse({
          type: 'json_schema',
          name,
          schema: {},
          strict: true,
        }).success,
      ).toBe(false);
    },
  );

  it('should reject unknown request fields and invalid runtime metadata', () => {
    expect(
      aiRequestSchema.safeParse({
        model: 'test-model',
        instructions: 'Instruções.',
        input: 'Entrada.',
        responseFormat: { type: 'text' },
        prompt: 'provider-specific-field',
      }).success,
    ).toBe(false);

    expect(
      aiGenerateMetadataSchema.safeParse({
        timeoutMs: 999,
      }).success,
    ).toBe(false);
  });

  it('should validate normalized content, usage and technical metadata', () => {
    expect(
      aiResponseSchema.safeParse({
        provider: 'fake',
        model: 'test-model',
        content: '{"status":"SUCCESS"}',
        structuredData: { status: 'SUCCESS' },
        finishReason: 'COMPLETED',
        usage: { inputTokens: 10, outputTokens: 5 },
        metadata: { responseId: 'response_1', durationMs: 25, attempts: 1 },
      }).success,
    ).toBe(true);

    expect(
      aiResponseSchema.safeParse({
        provider: 'fake',
        model: 'test-model',
        content: '',
        structuredData: null,
        finishReason: 'UNKNOWN',
        usage: { inputTokens: -1, outputTokens: 0 },
        metadata: { responseId: null, durationMs: 0, attempts: 0 },
      }).success,
    ).toBe(false);
  });
});
