import type { PromptContextInput } from './contracts';
import { PROMPT_BUILDER_ERROR_CODES, PromptBuilderError } from './errors';
import { calculatePromptHash } from './hashing';
import { serializePromptValue } from './variable-resolver';

export function serializeAndVerifyPromptContext(context: PromptContextInput): string {
  const content = serializePromptValue(context.content, context.serialization, context.id);
  const calculatedHash = `sha256:${calculatePromptHash(content)}`;

  if (calculatedHash !== context.contentHash) {
    throw new PromptBuilderError('O hash do contexto não corresponde ao conteúdo fornecido.', {
      code: PROMPT_BUILDER_ERROR_CODES.INVALID_CONTEXT,
      slotName: context.id,
    });
  }

  return content;
}
