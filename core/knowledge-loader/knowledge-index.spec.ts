import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import type { KnowledgeManifest } from './contracts';
import { calculateKnowledgeHash } from './document-content';
import { KNOWLEDGE_ERROR_CODES } from './errors';
import { buildKnowledgeIndex } from './knowledge-index';
import { FakeKnowledgeSource } from './testing/fake-knowledge-source';

const MANIFEST: KnowledgeManifest = {
  version: '1.0.0',
  documents: [
    { id: 'doc:second', locator: 'second.md', category: 'SECURITY', order: 2 },
    { id: 'doc:first', locator: 'first.md', category: 'VISION', order: 1 },
    { id: 'doc:missing', locator: 'missing.md', category: 'FAQ', order: 3 },
  ],
};

describe('Knowledge index', () => {
  it('builds an immutable, ordered and traceable snapshot', async () => {
    const source = new FakeKnowledgeSource({
      documents: {
        'second.md': '# Second\nBody',
        'first.md': '# First\nBody',
        'not-manifested.md': '# Extra',
      },
    });

    const index = await buildKnowledgeIndex({
      source,
      manifest: MANIFEST,
      logger: createLogger({ sink: () => undefined }),
    });

    expect(index.availableDocuments.map(({ id }) => id)).toEqual(['doc:first', 'doc:second']);
    expect(index.availableDocuments[0]).toMatchObject({
      title: 'First',
      hash: calculateKnowledgeHash('# First\nBody'),
      sizeBytes: 12,
    });
    expect(index.missingDocuments.map(({ id }) => id)).toEqual(['doc:missing']);
    expect(index.unmanifestedLocators).toEqual(['not-manifested.md']);
    expect(source.readCalls).toEqual(['first.md', 'second.md']);
    expect(source.discoverCalls).toBe(1);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.availableDocuments)).toBe(true);
  });

  it('does not include document content in structured logs', async () => {
    const lines: string[] = [];
    const sensitiveContent = '# First\nUNIQUE-CONTENT-MUST-NOT-BE-LOGGED';

    await buildKnowledgeIndex({
      source: new FakeKnowledgeSource({ documents: { 'first.md': sensitiveContent } }),
      manifest: {
        version: '1.0.0',
        documents: [{ id: 'doc:first', locator: 'first.md', category: 'VISION', order: 1 }],
      },
      logger: createLogger({ sink: (line) => lines.push(line) }),
    });

    expect(lines.join('\n')).not.toContain('UNIQUE-CONTENT-MUST-NOT-BE-LOGGED');
    expect(lines.map((line) => JSON.parse(line).event)).toEqual([
      'knowledge.index.started',
      'knowledge.index.completed',
    ]);
  });

  it('validates a manifest passed directly to the public index builder', async () => {
    await expect(
      buildKnowledgeIndex({
        source: new FakeKnowledgeSource(),
        manifest: {
          version: '1.0.0',
          documents: [
            { id: 'doc:same', locator: 'first.md', category: 'VISION', order: 1 },
            { id: 'doc:same', locator: 'second.md', category: 'FAQ', order: 2 },
          ],
        },
        logger: createLogger({ sink: () => undefined }),
      }),
    ).rejects.toMatchObject({ code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST });
  });

  it('adds the stable document ID to source read errors', async () => {
    await expect(
      buildKnowledgeIndex({
        source: {
          sourceId: 'failing-source',
          discover: async () => [{ locator: 'first.md', kind: 'FILE', sizeBytes: 10 }],
          read: async () => {
            throw new Error('read failed');
          },
        },
        manifest: {
          version: '1.0.0',
          documents: [{ id: 'doc:first', locator: 'first.md', category: 'VISION', order: 1 }],
        },
        logger: createLogger({ sink: () => undefined }),
      }),
    ).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.READ_FAILED,
      documentId: 'doc:first',
    });
  });
});
