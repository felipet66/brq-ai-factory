import { describe, expect, it } from 'vitest';

import { calculateKnowledgeHash } from './document-content';
import {
  knowledgeCategorySchema,
  knowledgeContextKindSchema,
  knowledgeContextSchema,
  knowledgeDocumentMetadataSchema,
  knowledgeLoadRequestSchema,
  knowledgeLocatorSchema,
  knowledgeSourceEntrySchema,
} from './schemas';

const HASH = `sha256:${'a'.repeat(64)}`;

const metadata = {
  id: 'knowledge:vision',
  title: 'Visão',
  origin: { sourceId: 'test-source', locator: '00-VISION.md' },
  category: 'VISION',
  order: 0,
  hash: HASH,
  sizeBytes: 120,
};

describe('Knowledge Loader schemas', () => {
  it('accepts only canonical categories and contexts', () => {
    expect(knowledgeCategorySchema.safeParse('ADR').success).toBe(true);
    expect(knowledgeCategorySchema.safeParse('UNKNOWN').success).toBe(false);
    expect(knowledgeContextKindSchema.safeParse('PRODUCT_OWNER').success).toBe(true);
    expect(knowledgeContextKindSchema.safeParse('PRODUCT-OWNER').success).toBe(false);
  });

  it.each([
    '/absolute.md',
    'C:\\absolute.md',
    'C:drive-relative.md',
    '../outside.md',
    'ADR/../outside.md',
    '.hidden.md',
    'ADR/.hidden.md',
    'folder\\document.md',
    'document.txt',
    'ADR//document.md',
    'document.md\u0000',
    'document.md\nforged',
    ' document.md',
    'document.md ',
  ])('rejects unsafe document locator %j', (locator) => {
    expect(knowledgeLocatorSchema.safeParse(locator).success).toBe(false);
  });

  it('rejects source IDs with external whitespace or control characters', () => {
    expect(knowledgeDocumentMetadataSchema.safeParse(metadata).success).toBe(true);
    expect(
      knowledgeDocumentMetadataSchema.safeParse({
        ...metadata,
        origin: { ...metadata.origin, sourceId: 'test-source\n' },
      }).success,
    ).toBe(false);
  });

  it('accepts a relative POSIX Markdown locator', () => {
    expect(knowledgeLocatorSchema.parse('ADR/ADR-014-KNOWLEDGE-LOADER-BOUNDARY.md')).toBe(
      'ADR/ADR-014-KNOWLEDGE-LOADER-BOUNDARY.md',
    );
  });

  it('validates source entries and document metadata', () => {
    expect(
      knowledgeSourceEntrySchema.safeParse({
        locator: '00-VISION.md',
        kind: 'FILE',
        sizeBytes: 120,
      }).success,
    ).toBe(true);
    expect(knowledgeDocumentMetadataSchema.safeParse(metadata).success).toBe(true);
    expect(
      knowledgeDocumentMetadataSchema.safeParse({ ...metadata, hash: 'not-a-sha256' }).success,
    ).toBe(false);
  });

  it('validates a context request without embedding trusted instance configuration', () => {
    expect(
      knowledgeLoadRequestSchema.safeParse({
        context: 'DEVELOPER',
        maxDocuments: 12,
        maxBytes: 32_768,
      }).success,
    ).toBe(true);
    expect(
      knowledgeLoadRequestSchema.safeParse({ context: 'DEVELOPER', maxDocuments: 0 }).success,
    ).toBe(false);
  });

  it('keeps context budget usage coherent with included documents', () => {
    const content = '<knowledge_document>content</knowledge_document>';
    const validContext = {
      context: 'GLOBAL',
      manifestVersion: '1.0.0',
      policyVersion: '1.0.0',
      sourceId: 'test-source',
      content,
      contextHash: calculateKnowledgeHash(content),
      includedDocuments: [metadata],
      ignoredDocuments: [],
      missingDocuments: [],
      budget: {
        maxDocuments: 2,
        maxBytes: 1_024,
        usedDocuments: 1,
        usedBytes: Buffer.byteLength(content, 'utf8'),
      },
    };

    expect(knowledgeContextSchema.safeParse(validContext).success).toBe(true);
    expect(
      knowledgeContextSchema.safeParse({
        ...validContext,
        budget: { ...validContext.budget, usedDocuments: 0 },
      }).success,
    ).toBe(false);
    expect(
      knowledgeContextSchema.safeParse({
        ...validContext,
        budget: { ...validContext.budget, usedBytes: 1_025 },
      }).success,
    ).toBe(false);
    expect(knowledgeContextSchema.safeParse({ ...validContext, contextHash: HASH }).success).toBe(
      false,
    );
  });
});
