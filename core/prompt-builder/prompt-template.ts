import type { JsonValue } from '@brq/shared/types/json-value';

import type { PromptTemplate } from './contracts';
import { PROMPT_BUILDER_ERROR_CODES, PromptBuilderError } from './errors';
import { calculateCanonicalJsonHash } from './hashing';
import { deepFreeze } from './immutability';
import { promptTemplateSchema } from './schemas';

export interface ParsedPromptTemplate {
  readonly hash: string;
  readonly template: PromptTemplate;
}

export function parsePromptTemplate(input: unknown): ParsedPromptTemplate {
  const result = promptTemplateSchema.safeParse(input);

  if (!result.success) {
    throw new PromptBuilderError('Template de prompt inválido.', {
      code: PROMPT_BUILDER_ERROR_CODES.INVALID_TEMPLATE,
      cause: result.error,
    });
  }

  const template = deepFreeze(result.data) as PromptTemplate;

  return deepFreeze({
    template,
    hash: calculateCanonicalJsonHash(template as unknown as JsonValue),
  });
}
