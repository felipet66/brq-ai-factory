import { describe, expect, it } from 'vitest';

import { PROMPT_BUILDER_ERROR_CODES } from './errors';
import { DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES } from './limits';
import { assertPromptPreflightBudget } from './prompt-budget';
import { createPromptBuildInput } from './testing/prompt-fixtures';

describe('Prompt Builder preflight budget', () => {
  it('accepts a valid input under a generous lower-bound budget', () => {
    expect(() =>
      assertPromptPreflightBudget(
        createPromptBuildInput(),
        128 * 1024,
        DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES,
      ),
    ).not.toThrow();
  });

  it('rejects oversized content before schema cloning and rendering', () => {
    const base = createPromptBuildInput();
    const input = {
      ...base,
      variables: [{ name: 'USER_INPUT', value: 'x'.repeat(4_096) }],
    };

    expect(() =>
      assertPromptPreflightBudget(input, 1_024, DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES),
    ).toThrowError(expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED }));
  });

  it('rejects cyclic JSON-like runtime input with a canonical local error', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const input = {
      ...createPromptBuildInput(),
      variables: [{ name: 'USER_INPUT', value: cyclic }],
    };

    expect(() =>
      assertPromptPreflightBudget(input, 128 * 1024, DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES),
    ).toThrowError(expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT }));
  });

  it('does not charge non-rendered context provenance against the prompt budget', () => {
    const base = createPromptBuildInput();
    const references = Array.from({ length: 100 }, (_, index) => ({
      id: `knowledge:reference-${index}`,
      category: 'VISION',
      hash: `sha256:${'a'.repeat(64)}`,
    }));
    const input = {
      ...base,
      contexts: base.contexts.map((context) => ({ ...context, references })),
    };

    expect(() =>
      assertPromptPreflightBudget(input, 4_096, DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES),
    ).not.toThrow();
  });

  it('limits non-rendered provenance separately from the prompt-byte budget', () => {
    const base = createPromptBuildInput();
    const references = Array.from({ length: 2 }, (_, index) => ({
      id: `knowledge:reference-${index}`,
      category: 'VISION',
      hash: `sha256:${'a'.repeat(64)}`,
    }));
    const input = {
      ...base,
      contexts: base.contexts.map((context) => ({ ...context, references })),
    };

    expect(() => assertPromptPreflightBudget(input, 128 * 1024, 1)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT }),
    );
  });
});
