import type { AIResponse } from '@brq/ai-provider';
import { canonicalizeJson, calculatePromptHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { AgentRunOutput } from './contracts';
import { deepFreeze } from './immutability';
import { canonicalByteLength } from './metrics';

interface ResponseEnvelope {
  readonly response: AIResponse;
  readonly canonical: string;
  readonly responseHash: string;
  readonly sizeBytes: number;
}

export function createResponseEnvelope(response: AIResponse): ResponseEnvelope {
  const value = response as unknown as JsonValue;
  const canonical = canonicalizeJson(value);

  return deepFreeze({
    response,
    canonical,
    responseHash: calculatePromptHash(canonical),
    sizeBytes: canonicalByteLength(value),
  });
}

export function responseEnvelopeOutput(envelope: ResponseEnvelope): AgentRunOutput {
  return {
    content: envelope.response.content,
    structuredData: envelope.response.structuredData,
    finishReason: envelope.response.finishReason,
    responseHash: envelope.responseHash,
  };
}
