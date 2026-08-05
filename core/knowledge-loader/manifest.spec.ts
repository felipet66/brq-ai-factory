import { describe, expect, it } from 'vitest';

import { KnowledgeLoaderError, KNOWLEDGE_ERROR_CODES } from './errors';
import { KNOWLEDGE_MANIFEST, parseKnowledgeManifest } from './manifest';

describe('Knowledge manifest', () => {
  it('loads the 27 canonical documents and ADRs 001 through 014', () => {
    expect(KNOWLEDGE_MANIFEST.version).toBe('1.0.0');
    expect(KNOWLEDGE_MANIFEST.documents).toHaveLength(41);
    expect(KNOWLEDGE_MANIFEST.documents.filter(({ category }) => category !== 'ADR')).toHaveLength(
      27,
    );
    expect(KNOWLEDGE_MANIFEST.documents.filter(({ category }) => category === 'ADR')).toHaveLength(
      14,
    );
    expect(KNOWLEDGE_MANIFEST.documents.at(-1)).toEqual({
      id: 'adr:014',
      locator: 'ADR/ADR-014-KNOWLEDGE-LOADER-BOUNDARY.md',
      category: 'ADR',
      order: 1014,
    });
    expect(Object.isFrozen(KNOWLEDGE_MANIFEST)).toBe(true);
    expect(Object.isFrozen(KNOWLEDGE_MANIFEST.documents)).toBe(true);
  });

  it('uses explicit stable IDs independently from physical filenames', () => {
    const vision = KNOWLEDGE_MANIFEST.documents.find(({ id }) => id === 'knowledge:vision');

    expect(vision).toMatchObject({ id: 'knowledge:vision', locator: '00-VISION.md' });
    expect(vision?.id).not.toContain('00-VISION');
  });

  it.each(['id', 'locator', 'order'] as const)('rejects duplicate %s', (field) => {
    const first = KNOWLEDGE_MANIFEST.documents[0];
    const second = KNOWLEDGE_MANIFEST.documents[1];

    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const duplicate = {
      ...second,
      [field]: first?.[field],
    };

    expect(() =>
      parseKnowledgeManifest({
        ...KNOWLEDGE_MANIFEST,
        documents: [first, duplicate],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST,
        sourceId: 'knowledge-manifest',
      }),
    );
  });

  it('translates invalid declarative data into a canonical local error', () => {
    try {
      parseKnowledgeManifest({ version: 'not-semver', documents: [] });
      expect.fail('Expected invalid manifest to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeLoaderError);
      expect(error).toMatchObject({
        code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST,
        sourceId: 'knowledge-manifest',
      });
      expect((error as Error).message).not.toContain('documents');
    }
  });

  it('classifies unknown document categories explicitly', () => {
    expect(() =>
      parseKnowledgeManifest({
        version: '1.0.0',
        documents: [
          {
            id: 'knowledge:unknown',
            locator: 'unknown.md',
            category: 'UNKNOWN',
            order: 1,
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: KNOWLEDGE_ERROR_CODES.UNKNOWN_CATEGORY,
        documentId: 'knowledge:unknown',
      }),
    );
  });
});
