import type { JsonValue } from '@brq/shared/types/json-value';

import { canonicalizeJson } from './canonical-json';
import type { PromptSerialization, PromptVariable } from './contracts';
import { PROMPT_BUILDER_ERROR_CODES, PromptBuilderError } from './errors';

export function serializePromptValue(
  value: PromptVariable['value'],
  serialization: PromptSerialization,
  slotName: string,
): string {
  if (serialization === 'TEXT') {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new PromptBuilderError('O valor do slot não corresponde à serialização TEXT.', {
        code: PROMPT_BUILDER_ERROR_CODES.SLOT_TYPE_MISMATCH,
        slotName,
      });
    }

    return value;
  }

  try {
    return canonicalizeJson(value as unknown as JsonValue);
  } catch (error) {
    throw new PromptBuilderError('O valor do slot não pode ser serializado como JSON.', {
      code: PROMPT_BUILDER_ERROR_CODES.SLOT_TYPE_MISMATCH,
      slotName,
      cause: error,
    });
  }
}

export function resolvePromptVariable(
  variables: ReadonlyMap<string, PromptVariable>,
  name: string,
  serialization: PromptSerialization,
): string {
  const variable = variables.get(name);

  if (variable === undefined) {
    throw new PromptBuilderError('Uma variável exigida pelo template não foi fornecida.', {
      code: PROMPT_BUILDER_ERROR_CODES.MISSING_SLOT_VALUE,
      slotName: name,
    });
  }

  return serializePromptValue(variable.value, serialization, name);
}
