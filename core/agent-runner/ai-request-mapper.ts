import { aiRequestSchema, type AIRequest } from '@brq/ai-provider';
import type { PromptResult } from '@brq/prompt-builder';
import type { JsonObject } from '@brq/shared/types/json-value';

const RESPONSE_FORMAT_PREFIX = 'contract_';
const RESPONSE_FORMAT_HASH_LENGTH = 55;

export function structuredOutputName(outputContractHash: string): string {
  return `${RESPONSE_FORMAT_PREFIX}${outputContractHash.slice(0, RESPONSE_FORMAT_HASH_LENGTH)}`;
}

export function toAIRequest(
  prompt: PromptResult,
  model: string,
  maxOutputTokens?: number,
): AIRequest {
  const responseFormat: AIRequest['responseFormat'] =
    prompt.outputContract.format === 'TEXT'
      ? { type: 'text' }
      : {
          type: 'json_schema',
          name: structuredOutputName(prompt.metadata.outputContractHash),
          schema: structuredClone(prompt.outputContract.schema) as JsonObject,
          strict: true,
        };

  return aiRequestSchema.parse({
    model,
    instructions: prompt.rendered.instructions,
    input: prompt.rendered.input,
    responseFormat,
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  });
}
