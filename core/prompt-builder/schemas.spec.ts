import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';

import { canonicalizeJson } from './canonical-json';
import { createPromptBuilder } from './prompt-builder';
import { calculateCanonicalJsonHash, calculatePromptHash } from './hashing';
import { ABSOLUTE_PROMPT_MAX_CONTEXT_REFERENCES } from './limits';
import { createPromptBuildInput } from './testing/prompt-fixtures';
import {
  promptBuildInputSchema,
  promptContextInputSchema,
  promptOutputContractSchema,
  promptResultSchema,
  promptTemplateSchema,
  resolvedPromptFragmentSchema,
  resolvedPromptSectionSchema,
} from './schemas';

describe('Prompt Builder schemas', () => {
  it('accepts a four-level prompt AST and complete build input', () => {
    const input = createPromptBuildInput();

    expect(promptBuildInputSchema.safeParse(input).success).toBe(true);
    expect(input.template.sections[0]?.blocks[0]?.fragments[0]).toBeDefined();
  });

  it('rejects extra properties at every template level', () => {
    const input = createPromptBuildInput();
    const section = input.template.sections[0]!;
    const block = section.blocks[0]!;
    const fragment = block.fragments[0]!;

    expect(promptTemplateSchema.safeParse({ ...input.template, extra: true }).success).toBe(false);
    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: [{ ...section, extra: true }, ...input.template.sections.slice(1)],
      }).success,
    ).toBe(false);
    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: [
          {
            ...section,
            blocks: [{ ...block, extra: true }],
          },
          ...input.template.sections.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: [
          {
            ...section,
            blocks: [{ ...block, fragments: [{ ...fragment, extra: true }] }],
          },
          ...input.template.sections.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects unsafe IDs and placeholder names', () => {
    const input = createPromptBuildInput();
    const userSection = input.template.sections.find(({ id }) => id === 'user-input')!;
    const userBlock = userSection.blocks[0]!;

    expect(promptTemplateSchema.safeParse({ ...input.template, id: '../prompt' }).success).toBe(
      false,
    );
    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: input.template.sections.map((section) =>
          section.id === 'user-input'
            ? {
                ...userSection,
                blocks: [
                  {
                    ...userBlock,
                    fragments: [
                      {
                        id: 'user-input:slot',
                        type: 'VARIABLE_SLOT',
                        name: '{{USER_INPUT}}',
                        serialization: 'TEXT',
                      },
                    ],
                  },
                ],
              }
            : section,
        ),
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate section, block, fragment and supplied-value IDs', () => {
    const input = createPromptBuildInput();
    const firstSection = input.template.sections[0]!;
    const firstBlock = firstSection.blocks[0]!;
    const firstFragment = firstBlock.fragments[0]!;

    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: [firstSection, { ...input.template.sections[1]!, id: firstSection.id }],
      }).success,
    ).toBe(false);
    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: [
          { ...firstSection, blocks: [firstBlock, { ...firstBlock }] },
          ...input.template.sections.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: [
          {
            ...firstSection,
            blocks: [{ ...firstBlock, fragments: [firstFragment, { ...firstFragment }] }],
          },
          ...input.template.sections.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      promptBuildInputSchema.safeParse({
        ...input,
        variables: [input.variables[0], input.variables[0]],
      }).success,
    ).toBe(false);
  });

  it('keeps dynamic input out of trusted instructions', () => {
    const input = createPromptBuildInput();
    const identity = input.template.sections.find(({ id }) => id === 'agent-identity')!;

    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: input.template.sections.map((section) =>
          section.id === identity.id
            ? {
                ...identity,
                blocks: [
                  {
                    id: 'agent-identity:block',
                    kind: 'CONTENT',
                    fragments: [
                      {
                        id: 'agent-identity:variable',
                        type: 'VARIABLE_SLOT',
                        name: 'USER_INPUT',
                        serialization: 'TEXT',
                      },
                    ],
                  },
                ],
              }
            : section,
        ),
      }).success,
    ).toBe(false);
  });

  it('enforces semantic compatibility between section, block and slot kinds', () => {
    const input = createPromptBuildInput();
    const outputSection = input.template.sections.find(({ kind }) => kind === 'OUTPUT_CONTRACT')!;

    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: input.template.sections.map((section) =>
          section.id === outputSection.id
            ? {
                ...outputSection,
                blocks: [
                  {
                    id: 'output-contract:wrong-block',
                    kind: 'CONTENT',
                    fragments: [
                      { id: 'output-contract:text', type: 'TEXT', value: 'Not a contract slot.' },
                    ],
                  },
                ],
              }
            : section,
        ),
      }).success,
    ).toBe(false);
  });

  it('requires exactly one provider-neutral output-contract slot', () => {
    const input = createPromptBuildInput();

    expect(
      promptTemplateSchema.safeParse({
        ...input.template,
        sections: input.template.sections.filter(({ kind }) => kind !== 'OUTPUT_CONTRACT'),
      }).success,
    ).toBe(false);
    expect(
      promptOutputContractSchema.safeParse({
        id: 'contract:text',
        version: '1.0.0',
        format: 'TEXT',
        instructions: ['Texto livre.'],
      }).success,
    ).toBe(true);
    expect(
      promptOutputContractSchema.safeParse({
        id: 'contract:json',
        version: '1.0.0',
        format: 'JSON_SCHEMA',
        instructions: ['JSON.'],
      }).success,
    ).toBe(false);
  });

  it('validates minimum result budget and identity coherence', () => {
    const input = createPromptBuildInput();
    const invalid = {
      document: {
        promptId: input.template.id,
        agent: input.template.agent,
        version: input.template.version,
        schemaVersion: input.template.schemaVersion,
        sections: [],
      },
      rendered: { instructions: '', input: '' },
      metadata: {},
      budget: {
        maxBytes: 1,
        usedBytes: 2,
        instructionsBytes: 1,
        inputBytes: 1,
        outputContractBytes: 1,
      },
      outputContract: input.outputContract,
    };

    expect(promptResultSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects tampered result bytes, hashes and section-hash metadata', () => {
    const result = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) }).build(
      createPromptBuildInput(),
    );

    expect(
      promptResultSchema.safeParse({
        ...result,
        budget: { ...result.budget, instructionsBytes: result.budget.instructionsBytes + 1 },
      }).success,
    ).toBe(false);
    expect(
      promptResultSchema.safeParse({
        ...result,
        metadata: { ...result.metadata, inputHash: '0'.repeat(64) },
      }).success,
    ).toBe(false);
    expect(
      promptResultSchema.safeParse({
        ...result,
        metadata: { ...result.metadata, sectionHashes: [] },
      }).success,
    ).toBe(false);
  });

  it('rejects a rendered result that no longer derives from document section order', () => {
    const result = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) }).build(
      createPromptBuildInput(),
    );
    const sections = [...result.document.sections].reverse();

    expect(
      promptResultSchema.safeParse({
        ...result,
        document: { ...result.document, sections },
        metadata: {
          ...result.metadata,
          sectionHashes: sections.map((section) => ({
            sectionId: section.id,
            hash: section.hash,
          })),
        },
      }).success,
    ).toBe(false);
  });

  it('reapplies channel and trust boundaries to a self-consistently hashed resolved section', () => {
    const result = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) }).build(
      createPromptBuildInput(),
    );
    const section = result.document.sections.find(({ id }) => id === 'user-input')!;
    const tampered = {
      ...section,
      channel: 'INSTRUCTIONS' as const,
      trust: 'TRUSTED' as const,
      hash: calculateCanonicalJsonHash({
        id: section.id,
        kind: section.kind,
        channel: 'INSTRUCTIONS',
        trust: 'TRUSTED',
        blocks: section.blocks.map((block) => ({ id: block.id, hash: block.hash })),
      }),
    };

    expect(resolvedPromptSectionSchema.safeParse(tampered).success).toBe(false);
  });

  it('rejects a resolved variable forged into a trusted instruction section', () => {
    const result = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) }).build(
      createPromptBuildInput(),
    );
    const section = result.document.sections.find(({ id }) => id === 'agent-identity')!;
    const block = section.blocks[0]!;
    const originalFragment = block.fragments[0]!;
    const fragment = {
      ...originalFragment,
      type: 'VARIABLE' as const,
      sourceId: 'USER_INPUT',
      sourceItemId: null,
      hash: calculateCanonicalJsonHash({
        id: originalFragment.id,
        type: 'VARIABLE',
        sourceId: 'USER_INPUT',
        sourceItemId: null,
        content: originalFragment.content,
      }),
    };
    const tamperedBlock = {
      ...block,
      fragments: [fragment, ...block.fragments.slice(1)],
      hash: calculateCanonicalJsonHash({
        id: block.id,
        kind: block.kind,
        fragments: [fragment, ...block.fragments.slice(1)].map((item) => ({
          id: item.id,
          hash: item.hash,
        })),
      }),
    };
    const tamperedSection = {
      ...section,
      blocks: [tamperedBlock, ...section.blocks.slice(1)],
      hash: calculateCanonicalJsonHash({
        id: section.id,
        kind: section.kind,
        channel: section.channel,
        trust: section.trust,
        blocks: [tamperedBlock, ...section.blocks.slice(1)].map((item) => ({
          id: item.id,
          hash: item.hash,
        })),
      }),
    };

    expect(resolvedPromptSectionSchema.safeParse(tamperedSection).success).toBe(false);
  });

  it('applies an absolute schema cap to context provenance references', () => {
    const context = createPromptBuildInput().contexts[0]!;
    const references = Array.from(
      { length: ABSOLUTE_PROMPT_MAX_CONTEXT_REFERENCES + 1 },
      (_, index) => ({
        id: `reference:${index}`,
        category: 'VISION',
        hash: `sha256:${'a'.repeat(64)}`,
      }),
    );

    expect(promptContextInputSchema.safeParse({ ...context, references }).success).toBe(false);
  });

  it('supports deterministic derived fragment IDs composed from maximum-length input IDs', () => {
    const id = `${'a'.repeat(128)}:${'b'.repeat(128)}`;
    const sourceId = 's'.repeat(128);
    const content = 'content';
    const fragment = {
      id,
      type: 'RULE' as const,
      sourceId,
      sourceItemId: 'rule:item',
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      hash: calculateCanonicalJsonHash({
        id,
        type: 'RULE',
        sourceId,
        sourceItemId: 'rule:item',
        content,
      }),
    };

    expect(resolvedPromptFragmentSchema.safeParse(fragment).success).toBe(true);
  });

  it('binds the external output contract to its unique rendered AST fragment', () => {
    const result = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) }).build(
      createPromptBuildInput(),
    );
    const outputContract = {
      id: 'contract:other',
      version: '2.0.0',
      format: 'TEXT' as const,
      instructions: ['Outro contrato.'],
    };
    const outputContractCanonical = canonicalizeJson(outputContract);
    const outputContractBytes = Buffer.byteLength(outputContractCanonical, 'utf8');
    const usedBytes =
      result.budget.instructionsBytes + result.budget.inputBytes + outputContractBytes;
    const candidate = {
      ...result,
      outputContract,
      budget: { ...result.budget, outputContractBytes, usedBytes },
      metadata: {
        ...result.metadata,
        outputContractHash: calculatePromptHash(outputContractCanonical),
        promptHash: calculateCanonicalJsonHash({
          promptId: result.metadata.promptId,
          agent: result.metadata.agent,
          version: result.metadata.version,
          schemaVersion: result.metadata.schemaVersion,
          instructions: result.rendered.instructions,
          input: result.rendered.input,
          outputContract,
        }),
      },
    };

    expect(promptResultSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects forged rule-set hashes and context kinds even when metadata mirrors the document', () => {
    const result = createPromptBuilder({ logger: createLogger({ sink: () => undefined }) }).build(
      createPromptBuildInput(),
    );
    const ruleSets = result.document.sources.ruleSets.map((source, index) =>
      index === 0 ? { ...source, hash: '0'.repeat(64) } : source,
    );
    const firstContext = result.document.sources.contexts[0]!;
    const forgedContext = {
      ...firstContext,
      kind: 'USER_INPUT' as const,
      descriptorHash: calculateCanonicalJsonHash({
        id: firstContext.contextId,
        kind: 'USER_INPUT',
        serialization: firstContext.serialization,
        contentHash: firstContext.contentHash,
        references: firstContext.references,
      } as unknown as JsonValue),
    };
    const contexts = [forgedContext, ...result.document.sources.contexts.slice(1)];
    const candidate = {
      ...result,
      document: { ...result.document, sources: { ruleSets, contexts } },
      metadata: { ...result.metadata, ruleSetHashes: ruleSets, contextHashes: contexts },
    };

    expect(promptResultSchema.safeParse(candidate).success).toBe(false);
  });
});
