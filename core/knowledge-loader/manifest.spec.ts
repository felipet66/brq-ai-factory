import { describe, expect, it } from 'vitest';

import { KnowledgeLoaderError, KNOWLEDGE_ERROR_CODES } from './errors';
import { KNOWLEDGE_MANIFEST, parseKnowledgeManifest } from './manifest';

describe('Knowledge manifest', () => {
  it('loads the 36 canonical documents and ADRs 001 through 021', () => {
    expect(KNOWLEDGE_MANIFEST.version).toBe('1.8.0');
    expect(KNOWLEDGE_MANIFEST.documents).toHaveLength(57);
    expect(KNOWLEDGE_MANIFEST.documents.filter(({ category }) => category !== 'ADR')).toHaveLength(
      36,
    );
    expect(KNOWLEDGE_MANIFEST.documents.filter(({ category }) => category === 'ADR')).toHaveLength(
      21,
    );
    expect(KNOWLEDGE_MANIFEST.documents.at(-1)).toEqual({
      id: 'adr:021',
      locator: 'ADR/ADR-021-QA-AGENT-BOUNDARY.md',
      category: 'ADR',
      order: 1021,
    });
    expect(
      KNOWLEDGE_MANIFEST.documents.find(({ id }) => id === 'knowledge:prompt-builder-flow'),
    ).toEqual({
      id: 'knowledge:prompt-builder-flow',
      locator: '27-PROMPT_BUILDER_FLOW.md',
      category: 'ARCHITECTURE',
      order: 27,
    });
    expect(
      KNOWLEDGE_MANIFEST.documents.find(({ id }) => id === 'knowledge:agent-runner-flow'),
    ).toEqual({
      id: 'knowledge:agent-runner-flow',
      locator: '28-AGENT_RUNNER_FLOW.md',
      category: 'ARCHITECTURE',
      order: 28,
    });
    expect(
      KNOWLEDGE_MANIFEST.documents.find(({ id }) => id === 'knowledge:response-validator-flow'),
    ).toEqual({
      id: 'knowledge:response-validator-flow',
      locator: '29-RESPONSE_VALIDATOR_FLOW.md',
      category: 'ARCHITECTURE',
      order: 29,
    });
    expect(
      KNOWLEDGE_MANIFEST.documents.find(({ id }) => id === 'knowledge:artifact-generator-flow'),
    ).toEqual({
      id: 'knowledge:artifact-generator-flow',
      locator: '30-ARTIFACT_GENERATOR_FLOW.md',
      category: 'ARCHITECTURE',
      order: 30,
    });
    expect(
      KNOWLEDGE_MANIFEST.documents.find(({ id }) => id === 'knowledge:artifact-lifecycle'),
    ).toEqual({
      id: 'knowledge:artifact-lifecycle',
      locator: '31-ARTIFACT_LIFECYCLE.md',
      category: 'ARCHITECTURE',
      order: 31,
    });
    expect(
      KNOWLEDGE_MANIFEST.documents.find(({ id }) => id === 'knowledge:product-owner-agent-flow'),
    ).toEqual({
      id: 'knowledge:product-owner-agent-flow',
      locator: '32-PRODUCT_OWNER_AGENT_FLOW.md',
      category: 'ARCHITECTURE',
      order: 32,
    });
    expect(
      KNOWLEDGE_MANIFEST.documents.find(({ id }) => id === 'knowledge:pipeline-overview'),
    ).toEqual({
      id: 'knowledge:pipeline-overview',
      locator: '33-PIPELINE_OVERVIEW.md',
      category: 'ARCHITECTURE',
      order: 33,
    });
    expect(KNOWLEDGE_MANIFEST.documents.find(({ id }) => id === 'knowledge:qa-agent-flow')).toEqual(
      {
        id: 'knowledge:qa-agent-flow',
        locator: '35-QA_AGENT_FLOW.md',
        category: 'ARCHITECTURE',
        order: 35,
      },
    );
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
