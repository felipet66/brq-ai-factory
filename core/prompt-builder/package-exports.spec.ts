import { createPromptBuilder, promptTemplateSchema } from '@brq/prompt-builder';
import { createPromptBuildInput } from '@brq/prompt-builder/testing';
import { describe, expect, it } from 'vitest';

describe('@brq/prompt-builder package exports', () => {
  it('exposes the public builder API and explicit testing fixture subpath', () => {
    const input = createPromptBuildInput();

    expect(promptTemplateSchema.safeParse(input.template).success).toBe(true);
    expect(createPromptBuilder).toBeTypeOf('function');
  });
});
