import { describe, expect, it } from 'vitest';

import { KNOWLEDGE_ERROR_CODES } from './errors';
import { KNOWLEDGE_MANIFEST } from './manifest';
import {
  getKnowledgeSelectionRule,
  KNOWLEDGE_SELECTION_POLICY,
  parseKnowledgeSelectionPolicy,
} from './selection-policy';

const ADR_IDS = Array.from(
  { length: 17 },
  (_, index) => `adr:${String(index + 1).padStart(3, '0')}`,
);

describe('Knowledge selection policy', () => {
  it('defines every canonical context under a versioned policy', () => {
    expect(KNOWLEDGE_SELECTION_POLICY.version).toBe('1.4.0');
    expect(Object.keys(KNOWLEDGE_SELECTION_POLICY.contexts)).toEqual([
      'GLOBAL',
      'PRODUCT_OWNER',
      'DEVELOPER',
      'QA',
      'SECURITY',
      'ARCHITECTURE',
    ]);
    expect(Object.isFrozen(KNOWLEDGE_SELECTION_POLICY)).toBe(true);
    expect(Object.isFrozen(KNOWLEDGE_SELECTION_POLICY.contexts.GLOBAL.required)).toBe(true);
  });

  it('implements the approved GLOBAL and PRODUCT_OWNER matrices', () => {
    expect(getKnowledgeSelectionRule('GLOBAL')).toEqual({
      required: [
        'knowledge:vision',
        'knowledge:project-context',
        'knowledge:workflow',
        'knowledge:agents',
        'knowledge:security',
      ],
      optional: ['knowledge:glossary', 'adr:002', 'adr:003', 'adr:004', 'adr:005', 'adr:010'],
    });
    expect(getKnowledgeSelectionRule('PRODUCT_OWNER').required).toContain(
      'knowledge:product-owner-agent',
    );
  });

  it('makes the complete ADR set optional for DEVELOPER and ARCHITECTURE', () => {
    expect(getKnowledgeSelectionRule('DEVELOPER').optional).toEqual([
      'knowledge:workflow',
      ...ADR_IDS,
    ]);
    expect(getKnowledgeSelectionRule('ARCHITECTURE').optional).toEqual([
      'knowledge:sequence-diagrams',
      'knowledge:prompt-builder-flow',
      'knowledge:agent-runner-flow',
      'knowledge:response-validator-flow',
      ...ADR_IDS,
    ]);
  });

  it('implements the approved QA and SECURITY matrices', () => {
    expect(getKnowledgeSelectionRule('QA')).toEqual({
      required: [
        'knowledge:workflow',
        'knowledge:artifacts',
        'knowledge:agents',
        'knowledge:qa-agent',
        'knowledge:testing',
        'knowledge:security',
      ],
      optional: [
        'knowledge:project-context',
        'knowledge:domain-model',
        'knowledge:coding-standards',
        'knowledge:glossary',
        'adr:002',
        'adr:003',
        'adr:004',
        'adr:005',
        'adr:010',
      ],
    });
    expect(getKnowledgeSelectionRule('SECURITY')).toEqual({
      required: ['knowledge:security'],
      optional: [
        'knowledge:agents',
        'knowledge:prompts',
        'knowledge:observability',
        'knowledge:system-design',
        'adr:003',
        'adr:004',
        'adr:010',
        'adr:013',
        'adr:014',
        'adr:015',
        'adr:016',
        'adr:017',
      ],
    });
  });

  it('rejects duplicate, overlapping and unknown document IDs', () => {
    const duplicatePolicy = {
      ...KNOWLEDGE_SELECTION_POLICY,
      contexts: {
        ...KNOWLEDGE_SELECTION_POLICY.contexts,
        GLOBAL: {
          ...KNOWLEDGE_SELECTION_POLICY.contexts.GLOBAL,
          required: [...KNOWLEDGE_SELECTION_POLICY.contexts.GLOBAL.required, 'knowledge:vision'],
        },
      },
    };

    expect(() => parseKnowledgeSelectionPolicy(duplicatePolicy)).toThrowError(
      expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST }),
    );

    const overlappingPolicy = {
      ...KNOWLEDGE_SELECTION_POLICY,
      contexts: {
        ...KNOWLEDGE_SELECTION_POLICY.contexts,
        GLOBAL: {
          ...KNOWLEDGE_SELECTION_POLICY.contexts.GLOBAL,
          optional: [...KNOWLEDGE_SELECTION_POLICY.contexts.GLOBAL.optional, 'knowledge:vision'],
        },
      },
    };

    expect(() => parseKnowledgeSelectionPolicy(overlappingPolicy)).toThrowError(
      expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST }),
    );

    const unknownPolicy = {
      ...KNOWLEDGE_SELECTION_POLICY,
      contexts: {
        ...KNOWLEDGE_SELECTION_POLICY.contexts,
        GLOBAL: {
          ...KNOWLEDGE_SELECTION_POLICY.contexts.GLOBAL,
          optional: [
            ...KNOWLEDGE_SELECTION_POLICY.contexts.GLOBAL.optional,
            'knowledge:not-manifested',
          ],
        },
      },
    };

    expect(() => parseKnowledgeSelectionPolicy(unknownPolicy, KNOWLEDGE_MANIFEST)).toThrowError(
      expect.objectContaining({
        code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST,
        documentId: 'knowledge:not-manifested',
      }),
    );
  });

  it('rejects unknown contexts with a canonical error', () => {
    expect(() => getKnowledgeSelectionRule('UNKNOWN')).toThrowError(
      expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.UNKNOWN_CONTEXT }),
    );
  });

  it('validates a manifest passed directly to the public policy parser', () => {
    const [firstDocument] = KNOWLEDGE_MANIFEST.documents;
    const invalidManifest = {
      ...KNOWLEDGE_MANIFEST,
      documents: KNOWLEDGE_MANIFEST.documents.map((document, index) => ({
        ...document,
        id: index === 1 ? firstDocument!.id : document.id,
      })),
    };

    expect(() =>
      parseKnowledgeSelectionPolicy(KNOWLEDGE_SELECTION_POLICY, invalidManifest),
    ).toThrowError(expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST }));
  });
});
