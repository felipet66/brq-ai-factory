import { describe, expect, it } from 'vitest';

import { PROMPT_BUILDER_ERROR_CODES } from './errors';
import { parsePromptTemplate } from './prompt-template';
import { createPromptBuildInput } from './testing/prompt-fixtures';

describe('parsePromptTemplate', () => {
  it('returns a deeply immutable template without mutating the source', () => {
    const source = createPromptBuildInput().template;
    const snapshot = structuredClone(source);
    const result = parsePromptTemplate(source);

    expect(source).toEqual(snapshot);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.template)).toBe(true);
    expect(Object.isFrozen(result.template.sections)).toBe(true);
    expect(Object.isFrozen(result.template.sections[0]?.blocks)).toBe(true);
    expect(Object.isFrozen(result.template.sections[0]?.blocks[0]?.fragments)).toBe(true);
  });

  it('calculates the same hash for an equivalent parsed structure', () => {
    const template = createPromptBuildInput().template;

    expect(parsePromptTemplate(template).hash).toBe(
      parsePromptTemplate(structuredClone(template)).hash,
    );
  });

  it('changes the template hash when its versioned definition changes', () => {
    const template = createPromptBuildInput().template;

    expect(parsePromptTemplate({ ...template, version: '1.0.1' }).hash).not.toBe(
      parsePromptTemplate(template).hash,
    );
  });

  it('translates schema failures into a local canonical error', () => {
    expect(() => parsePromptTemplate({ id: 'invalid' })).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.INVALID_TEMPLATE }),
    );
  });
});
