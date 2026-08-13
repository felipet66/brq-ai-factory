import { describe, expect, it } from 'vitest';

import type { AIRequest, AIResponse } from './contracts';
import { calculateAIRequestHash, calculateAIResponseHash } from './hashing';

const REQUEST: AIRequest = {
  model: 'test-model',
  instructions: 'Instruções privadas.',
  input: 'Entrada privada.',
  responseFormat: {
    type: 'json_schema',
    name: 'result',
    strict: true,
    schema: {
      type: 'object',
      properties: { status: { type: 'string' }, count: { type: 'integer' } },
      required: ['status', 'count'],
      additionalProperties: false,
    },
  },
  maxOutputTokens: 512,
};

const RESPONSE: AIResponse = {
  provider: 'fake',
  model: 'test-model',
  content: '{"status":"OK","count":1}',
  structuredData: { status: 'OK', count: 1 },
  finishReason: 'COMPLETED',
  usage: { inputTokens: 10, outputTokens: 5 },
  metadata: { responseId: 'response_1', durationMs: 25, attempts: 1 },
};

describe('AI provider cache hashing', () => {
  it('hashes the validated AIRequest canonically without exposing its content', () => {
    const reordered: AIRequest = {
      ...REQUEST,
      responseFormat: {
        type: 'json_schema',
        name: 'result',
        strict: true,
        schema: {
          additionalProperties: false,
          required: ['status', 'count'],
          properties: { count: { type: 'integer' }, status: { type: 'string' } },
          type: 'object',
        },
      },
    };

    const hash = calculateAIRequestHash(REQUEST);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(calculateAIRequestHash(reordered)).toBe(hash);
    expect(hash).not.toContain(REQUEST.instructions);
    expect(hash).not.toContain(REQUEST.input);
  });

  it('changes the request hash for every semantic request field', () => {
    expect(calculateAIRequestHash({ ...REQUEST, model: 'other-model' })).not.toBe(
      calculateAIRequestHash(REQUEST),
    );
    expect(calculateAIRequestHash({ ...REQUEST, input: 'Outra entrada.' })).not.toBe(
      calculateAIRequestHash(REQUEST),
    );
    expect(calculateAIRequestHash({ ...REQUEST, maxOutputTokens: 513 })).not.toBe(
      calculateAIRequestHash(REQUEST),
    );
  });

  it('hashes the complete validated AIResponse deterministically', () => {
    const hash = calculateAIResponseHash(RESPONSE);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(calculateAIResponseHash(structuredClone(RESPONSE))).toBe(hash);
    expect(calculateAIResponseHash({ ...RESPONSE, content: 'Outro conteúdo.' })).not.toBe(hash);
  });
});
