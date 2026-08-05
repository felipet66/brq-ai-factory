import { Buffer } from 'node:buffer';

import { PROMPT_BUILDER_ERROR_CODES, PromptBuilderError } from './errors';

type UnknownRecord = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

class ContentBudgetCounter {
  #usedBytes = 0;
  readonly #ancestors = new WeakSet<object>();

  constructor(private readonly maxBytes: number) {}

  addStructure(): void {
    this.#add(1);
  }

  addText(value: unknown): void {
    if (typeof value === 'string') {
      this.#add(Buffer.byteLength(value, 'utf8'));
    }
  }

  addJsonLowerBound(value: unknown): void {
    if (typeof value === 'string') {
      this.addText(value);
      return;
    }

    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      this.#add(1);
      return;
    }

    if (typeof value !== 'object') {
      this.#add(1);
      return;
    }

    if (this.#ancestors.has(value)) {
      throw new PromptBuilderError('A entrada do prompt contém uma referência cíclica.', {
        code: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT,
      });
    }

    this.#ancestors.add(value);
    this.#add(1);

    try {
      if (Array.isArray(value)) {
        for (const item of value) this.addJsonLowerBound(item);
        return;
      }

      for (const [key, nestedValue] of Object.entries(value)) {
        this.addText(key);
        this.addJsonLowerBound(nestedValue);
      }
    } finally {
      this.#ancestors.delete(value);
    }
  }

  #add(bytes: number): void {
    this.#usedBytes += bytes;

    if (this.#usedBytes > this.maxBytes) {
      throw new PromptBuilderError('A entrada excede o orçamento antes da montagem.', {
        code: PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED,
      });
    }
  }
}

/**
 * Applies a cheap lower-bound check before Zod cloning, canonicalization and rendering.
 * The final rendered payload is still measured exactly by PromptBuilder.
 */
export function assertPromptPreflightBudget(
  input: unknown,
  maxBytes: number,
  maxContextReferences: number,
): void {
  const counter = new ContentBudgetCounter(maxBytes);
  const root = asRecord(input);
  const template = asRecord(root?.template);
  const contexts = asArray(root?.contexts);
  let contextReferenceCount = 0;

  for (const contextValue of contexts) {
    const references = asArray(asRecord(contextValue)?.references);
    contextReferenceCount += references.length;

    if (contextReferenceCount > maxContextReferences) {
      throw new PromptBuilderError('A entrada excede o limite estrutural de referências.', {
        code: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT,
      });
    }
  }

  for (const sectionValue of asArray(template?.sections)) {
    counter.addStructure();
    const section = asRecord(sectionValue);

    for (const blockValue of asArray(section?.blocks)) {
      counter.addStructure();
      const block = asRecord(blockValue);

      for (const fragmentValue of asArray(block?.fragments)) {
        counter.addStructure();
        const fragment = asRecord(fragmentValue);
        if (fragment?.type === 'TEXT') counter.addText(fragment.value);
      }
    }
  }

  for (const ruleSetValue of asArray(root?.ruleSets)) {
    counter.addStructure();
    const ruleSet = asRecord(ruleSetValue);
    for (const ruleValue of asArray(ruleSet?.rules)) {
      counter.addStructure();
      counter.addText(asRecord(ruleValue)?.content);
    }
  }

  for (const contextValue of contexts) {
    counter.addStructure();
    const promptContext = asRecord(contextValue);
    counter.addJsonLowerBound(promptContext?.content);
  }

  for (const variableValue of asArray(root?.variables)) {
    counter.addStructure();
    counter.addJsonLowerBound(asRecord(variableValue)?.value);
  }

  for (const constraintValue of asArray(root?.constraints)) {
    counter.addStructure();
    counter.addJsonLowerBound(asRecord(constraintValue)?.value);
  }

  counter.addJsonLowerBound(root?.outputContract);
}
