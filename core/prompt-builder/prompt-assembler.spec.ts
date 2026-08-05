import { describe, expect, it } from 'vitest';

import { assemblePromptDocument } from './prompt-assembler';
import { PROMPT_BUILDER_ERROR_CODES } from './errors';
import { createPromptBuildInput, FIXTURE_CONTEXT_CONTENT } from './testing/prompt-fixtures';

describe('assemblePromptDocument', () => {
  it('resolves the four-level AST without flattening its structure', () => {
    const input = createPromptBuildInput();
    const document = assemblePromptDocument(input);
    const globalRules = document.sections.find(({ id }) => id === 'global-rules')!;
    const constraint = document.sections.find(({ id }) => id === 'constraints')!;
    const context = document.sections.find(({ id }) => id === 'knowledge-context')!;

    expect(document.promptId).toBe('prompt:developer');
    expect(globalRules.blocks[0]?.fragments[0]).toMatchObject({
      id: expect.stringMatching(/^global-rules:slot:item-[a-f0-9]{64}$/),
      type: 'RULE',
      sourceId: 'rules:global',
      sourceItemId: 'global:deterministic',
    });
    expect(constraint.blocks[0]?.fragments[0]).toMatchObject({
      type: 'CONSTRAINT',
      sourceId: 'constraint:scope',
      sourceItemId: null,
      content: 'Não altere a API.',
    });
    expect(context.blocks[0]?.fragments[0]?.content).toBe(FIXTURE_CONTEXT_CONTENT);
    expect(document.sections.every(({ hash }) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
  });

  it('keeps all resolved nodes deeply immutable', () => {
    const document = assemblePromptDocument(createPromptBuildInput());

    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.sections)).toBe(true);
    expect(Object.isFrozen(document.sections[0])).toBe(true);
    expect(Object.isFrozen(document.sections[0]?.blocks)).toBe(true);
    expect(Object.isFrozen(document.sections[0]?.blocks[0]?.fragments)).toBe(true);
    expect(Object.isFrozen(document.sections[0]?.blocks[0]?.fragments[0])).toBe(true);
  });

  it('rejects a missing slot value and a supplied value not referenced by the template', () => {
    const base = createPromptBuildInput();
    const missing = { ...base, variables: [] };

    expect(() => assemblePromptDocument(missing)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.MISSING_SLOT_VALUE }),
    );

    const unknown = {
      ...base,
      variables: [...base.variables, { name: 'UNKNOWN_VALUE', value: 'not referenced' }],
    };

    expect(() => assemblePromptDocument(unknown)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.UNKNOWN_SLOT_VALUE }),
    );
  });

  it('rejects agent-specific rules for a different agent', () => {
    const base = createPromptBuildInput();
    const input = {
      ...base,
      ruleSets: base.ruleSets.map((ruleSet) =>
        ruleSet.scope === 'AGENT' ? { ...ruleSet, agent: 'QA' as const } : ruleSet,
      ),
    };

    expect(() => assemblePromptDocument(input)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.AGENT_MISMATCH }),
    );
  });

  it('rejects a rule-set scope in the wrong section', () => {
    const base = createPromptBuildInput();
    const input = {
      ...base,
      ruleSets: base.ruleSets.map((ruleSet) =>
        ruleSet.id === 'rules:global'
          ? { ...ruleSet, scope: 'SECURITY' as const, agent: null }
          : ruleSet,
      ),
    };

    expect(() => assemblePromptDocument(input)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.INVALID_SECTION }),
    );
  });

  it('rejects contexts injected into an incompatible section', () => {
    const base = createPromptBuildInput();
    const input = {
      ...base,
      contexts: base.contexts.map((context) => ({ ...context, kind: 'USER_INPUT' as const })),
    };

    expect(() => assemblePromptDocument(input)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.INVALID_CONTEXT }),
    );
  });

  it('fails atomically when a declared constraints slot has no values', () => {
    const input = { ...createPromptBuildInput(), constraints: [] };

    expect(() => assemblePromptDocument(input)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.MISSING_SLOT_VALUE }),
    );
  });
});
