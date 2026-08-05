import type { KnowledgeContext } from '@brq/knowledge-loader';
import { calculateCanonicalJsonHash, calculatePromptHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { projectDeveloperPromptContexts } from './knowledge-projection';
import { loadDeveloperPromptAssets } from './prompt-assets';
import { createDeveloperRequest } from './testing/developer-fixtures';

function knowledgeContext(context: KnowledgeContext['context'] = 'DEVELOPER'): KnowledgeContext {
  const content = '<<<BEGIN_KNOWLEDGE_CONTEXT>>>\nconteúdo técnico não confiável\n<<<END>>>';

  return {
    context,
    manifestVersion: '1.0.0',
    policyVersion: '1.0.0',
    sourceId: 'test-source',
    content,
    contextHash: `sha256:${calculatePromptHash(content)}`,
    includedDocuments: [
      {
        id: 'knowledge:architecture-test',
        title: 'Arquitetura de teste',
        category: 'ARCHITECTURE',
        order: 1,
        origin: {
          sourceId: 'test-source',
          locator: 'architecture.md',
        },
        sizeBytes: Buffer.byteLength(content),
        hash: `sha256:${calculatePromptHash(content)}`,
      },
    ],
    ignoredDocuments: [],
    missingDocuments: [],
    budget: {
      maxDocuments: 10,
      maxBytes: 10_000,
      usedDocuments: 1,
      usedBytes: Buffer.byteLength(content),
    },
  };
}

describe('Developer knowledge projection', () => {
  it('projects knowledge and the Product Owner specification into two untrusted contexts', () => {
    const request = createDeveloperRequest();
    const requestSnapshot = structuredClone(request);
    const assets = loadDeveloperPromptAssets();
    const knowledge = knowledgeContext();
    const contexts = projectDeveloperPromptContexts(knowledge, request, assets.manifest);

    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({
      id: 'context:developer-knowledge',
      kind: 'KNOWLEDGE',
      serialization: 'TEXT',
      content: knowledge.content,
      contentHash: knowledge.contextHash,
      references: [
        {
          id: 'knowledge:architecture-test',
          category: 'ARCHITECTURE',
          hash: knowledge.includedDocuments[0]!.hash,
        },
      ],
    });
    expect(contexts[1]).toMatchObject({
      id: 'context:product-owner-specification',
      kind: 'ARTIFACT',
      serialization: 'JSON',
      content: request.productOwnerSpecification,
      references: [],
    });
    const sourceSpecification = contexts[1]!.content as JsonValue;
    expect(contexts[1]!.contentHash).toBe(
      `sha256:${calculateCanonicalJsonHash(sourceSpecification)}`,
    );
    expect(Object.isFrozen(contexts)).toBe(true);
    expect(Object.isFrozen(contexts[0])).toBe(true);
    expect(Object.isFrozen(contexts[1]!.content)).toBe(true);
    expect(request).toEqual(requestSnapshot);
    expect(Object.isFrozen(request)).toBe(false);
  });

  it('rejects a context selected for another agent', () => {
    expect(() =>
      projectDeveloperPromptContexts(
        knowledgeContext('PRODUCT_OWNER'),
        createDeveloperRequest(),
        loadDeveloperPromptAssets().manifest,
      ),
    ).toThrow('não pertence ao Developer');
  });
});
