import { describe, expect, it } from 'vitest';

import type { PromptVariable } from './contracts';
import { PROMPT_BUILDER_ERROR_CODES } from './errors';
import { resolvePromptVariable, serializePromptValue } from './variable-resolver';

describe('Prompt variable resolution', () => {
  it('preserves TEXT values exactly without interpreting nested placeholder syntax', () => {
    const marker = '  {{ANOTHER_SLOT}}\nexact  ';
    const variables = new Map<string, PromptVariable>([
      ['USER_INPUT', { name: 'USER_INPUT', value: marker }],
    ]);

    expect(resolvePromptVariable(variables, 'USER_INPUT', 'TEXT')).toBe(marker);
  });

  it('serializes JSON values canonically', () => {
    expect(serializePromptValue({ z: 1, a: { y: true, x: false } }, 'JSON', 'DATA')).toBe(
      '{"a":{"x":false,"y":true},"z":1}',
    );
  });

  it('rejects missing and type-incompatible variables', () => {
    const variables = new Map<string, PromptVariable>([
      ['DATA', { name: 'DATA', value: { enabled: true } }],
    ]);

    expect(() => resolvePromptVariable(variables, 'MISSING', 'TEXT')).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.MISSING_SLOT_VALUE }),
    );
    expect(() => resolvePromptVariable(variables, 'DATA', 'TEXT')).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.SLOT_TYPE_MISMATCH }),
    );
    expect(() => serializePromptValue('   ', 'TEXT', 'EMPTY')).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.SLOT_TYPE_MISMATCH }),
    );
  });
});
