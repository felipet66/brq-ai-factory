import { Buffer } from 'node:buffer';

import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { canonicalizeJson } from './canonical-json';
import { PROMPT_BUILDER_ERROR_CODES } from './errors';
import {
  createPromptBuilder,
  DEFAULT_PROMPT_MAX_BYTES,
  DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES,
} from './prompt-builder';
import { promptResultSchema } from './schemas';
import { createPromptBuildInput } from './testing/prompt-fixtures';

describe('Prompt Builder', () => {
  it('builds a validated, immutable and traceable prompt result', () => {
    const input = createPromptBuildInput();
    const result = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) }).build(
      input,
    );

    expect(promptResultSchema.safeParse(result).success).toBe(true);
    expect(result.metadata).toMatchObject({
      promptId: input.template.id,
      agent: input.template.agent,
      version: input.template.version,
      schemaVersion: input.template.schemaVersion,
    });
    expect(result.metadata.sectionHashes).toHaveLength(input.template.sections.length);
    expect(result.metadata.ruleSetHashes).toHaveLength(input.ruleSets.length);
    expect(result.metadata.contextHashes).toEqual([
      expect.objectContaining({
        contextId: input.contexts[0]?.id,
        contentHash: input.contexts[0]?.contentHash,
        references: input.contexts[0]?.references,
      }),
    ]);
    expect(result.document.sources).toEqual({
      ruleSets: result.metadata.ruleSetHashes,
      contexts: result.metadata.contextHashes,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.document.sections[0]?.blocks[0]?.fragments)).toBe(true);
    expect(Object.isFrozen(createPromptBuilder())).toBe(true);
  });

  it('is deterministic for equivalent input and contains no timestamps in its result', () => {
    const builder = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) });
    const first = builder.build(createPromptBuildInput());
    const second = builder.build(createPromptBuildInput());

    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain('timestamp');
    expect(JSON.stringify(first)).not.toContain('createdAt');
  });

  it('keeps template identity stable while dynamic input changes only input-derived hashes', () => {
    const builder = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) });
    const base = createPromptBuildInput();
    const changed = {
      ...base,
      variables: [{ name: 'USER_INPUT', value: 'Uma solicitação diferente.' }],
    };
    const first = builder.build(base);
    const second = builder.build(changed);

    expect(second.metadata.templateHash).toBe(first.metadata.templateHash);
    expect(second.metadata.instructionsHash).toBe(first.metadata.instructionsHash);
    expect(second.metadata.inputHash).not.toBe(first.metadata.inputHash);
    expect(second.metadata.promptHash).not.toBe(first.metadata.promptHash);
    expect(
      second.metadata.sectionHashes.filter(
        (section, index) => section.hash !== first.metadata.sectionHashes[index]?.hash,
      ),
    ).toEqual([expect.objectContaining({ sectionId: 'user-input' })]);
  });

  it('preserves versioned rule-set and document-reference provenance independently of prompt bytes', () => {
    const builder = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) });
    const base = createPromptBuildInput();
    const changed = {
      ...base,
      ruleSets: base.ruleSets.map((ruleSet) => ({ ...ruleSet, version: '1.0.1' })),
      contexts: base.contexts.map((context) => ({
        ...context,
        references: context.references.map((reference) => ({
          ...reference,
          category: 'ARCHITECTURE',
        })),
      })),
    };
    const first = builder.build(base);
    const second = builder.build(changed);

    expect(second.metadata.promptHash).toBe(first.metadata.promptHash);
    expect(second.metadata.ruleSetHashes).not.toEqual(first.metadata.ruleSetHashes);
    expect(second.metadata.contextHashes).not.toEqual(first.metadata.contextHashes);
    expect(second.metadata.contextHashes[0]?.references[0]?.category).toBe('ARCHITECTURE');
  });

  it('counts exact UTF-8 bytes for both channels and the output contract', () => {
    const base = createPromptBuildInput();
    const input = {
      ...base,
      variables: [{ name: 'USER_INPUT', value: 'ação 🚀' }],
    };
    const result = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) }).build(
      input,
    );

    expect(result.budget.instructionsBytes).toBe(
      Buffer.byteLength(result.rendered.instructions, 'utf8'),
    );
    expect(result.budget.inputBytes).toBe(Buffer.byteLength(result.rendered.input, 'utf8'));
    expect(result.budget.outputContractBytes).toBe(
      Buffer.byteLength(canonicalizeJson(input.outputContract as unknown as JsonValue), 'utf8'),
    );
  });

  it('accepts the exact budget and fails atomically one byte below it', () => {
    const quietLogger = createLogger({ sink: () => undefined });
    const input = createPromptBuildInput();
    const baseline = createPromptBuilder({ logger: quietLogger }).build(input);
    const exact = createPromptBuilder({
      logger: quietLogger,
      configuration: { maxBytes: baseline.budget.usedBytes },
    });
    const below = createPromptBuilder({
      logger: quietLogger,
      configuration: { maxBytes: baseline.budget.usedBytes - 1 },
    });

    expect(exact.build(input).budget.usedBytes).toBe(baseline.budget.usedBytes);
    expect(() => below.build(input)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED }),
    );
  });

  it('allows a call to reduce but never increase the instance budget', () => {
    const input = createPromptBuildInput();
    const builder = createPromptBuilder({
      configuration: { maxBytes: DEFAULT_PROMPT_MAX_BYTES },
      logger: createLogger({ sink: () => undefined }),
    });
    const baseline = builder.build(input);
    const reduced = builder.build(input, { maxBytes: baseline.budget.usedBytes });

    expect(reduced.metadata.promptHash).toBe(baseline.metadata.promptHash);
    expect(reduced.budget).toMatchObject({
      maxBytes: baseline.budget.usedBytes,
      usedBytes: baseline.budget.usedBytes,
    });
    expect(() => builder.build(input, { maxBytes: DEFAULT_PROMPT_MAX_BYTES + 1 })).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED }),
    );
  });

  it('enforces the configurable instance limit for context provenance references', () => {
    const base = createPromptBuildInput();
    const logger = createLogger({ sink: () => undefined });
    const builder = createPromptBuilder({
      logger,
      configuration: { maxContextReferences: 1 },
    });
    const references = [
      base.contexts[0]!.references[0]!,
      {
        id: 'knowledge:architecture',
        category: 'ARCHITECTURE',
        hash: `sha256:${'b'.repeat(64)}`,
      },
    ];

    expect(builder.build(base).metadata.contextHashes[0]?.references).toHaveLength(1);
    expect(() =>
      builder.build({
        ...base,
        contexts: base.contexts.map((context) => ({ ...context, references })),
      }),
    ).toThrowError(expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT }));
    expect(DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES).toBeGreaterThan(1);
  });

  it('supports the provider-neutral TEXT output contract', () => {
    const base = createPromptBuildInput();
    const input = {
      ...base,
      outputContract: {
        id: 'contract:text-output',
        version: '1.0.0',
        format: 'TEXT' as const,
        instructions: ['Retorne texto simples.'],
      },
    };
    const result = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) }).build(
      input,
    );

    expect(result.outputContract.format).toBe('TEXT');
    expect(result.rendered.instructions).toContain('contract:text-output');
  });

  it('rejects invalid configuration, input and build options with local errors', () => {
    expect(() => createPromptBuilder({ configuration: { maxBytes: 0 } })).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.INVALID_CONFIGURATION }),
    );

    const builder = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) });
    expect(() => builder.build({ template: { id: 'broken' } } as never)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.INVALID_TEMPLATE }),
    );
    expect(() => builder.build(createPromptBuildInput(), { maxBytes: 0 } as never)).toThrowError(
      expect.objectContaining({ code: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT }),
    );
  });

  it('logs only technical metadata and never prompt, response-like or schema content', () => {
    const lines: string[] = [];
    const privateInput = 'PRIVATE-USER-PROMPT-918273';
    const privateRule = 'PRIVATE-TRUSTED-RULE-456789';
    const privateSchemaKey = 'PRIVATE_SCHEMA_PROPERTY_112233';
    const base = createPromptBuildInput();
    if (base.outputContract.format !== 'JSON_SCHEMA') {
      throw new TypeError('The test fixture must use a JSON Schema output contract.');
    }
    const input = {
      ...base,
      variables: [{ name: 'USER_INPUT', value: privateInput }],
      ruleSets: base.ruleSets.map((ruleSet) =>
        ruleSet.id === 'rules:developer'
          ? {
              ...ruleSet,
              rules: [{ id: 'developer:private', content: privateRule }],
            }
          : ruleSet,
      ),
      outputContract: {
        ...base.outputContract,
        schema: {
          ...base.outputContract.schema,
          properties: { [privateSchemaKey]: { type: 'string' } },
        },
      },
    };
    const logger = createLogger({ sink: (line) => lines.push(line) });

    createPromptBuilder({ logger }).build(input, { requestId: 'request-1', traceId: 'trace-1' });

    const logs = lines.join('\n');
    expect(logs).toContain('prompt.build.completed');
    expect(logs).toContain('promptHash');
    expect(logs).not.toContain(privateInput);
    expect(logs).not.toContain(privateRule);
    expect(logs).not.toContain(privateSchemaKey);
    expect(logs).not.toContain('instructions\":');
    expect(logs).not.toContain('schema\":');
  });

  it('sanitizes validation and budget failure logs as metadata-only events', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const builder = createPromptBuilder({ logger, configuration: { maxBytes: 1 } });
    const secretMarker = 'SECRET-INVALID-PROMPT-0001';

    expect(() => builder.build({ template: secretMarker } as never)).toThrow();
    expect(() => builder.build(createPromptBuildInput())).toThrow();

    expect(lines.some((line) => line.includes('prompt.validation.failed'))).toBe(true);
    expect(lines.some((line) => line.includes('prompt.budget.exceeded'))).toBe(true);
    expect(lines.join('\n')).not.toContain(secretMarker);
  });
});
