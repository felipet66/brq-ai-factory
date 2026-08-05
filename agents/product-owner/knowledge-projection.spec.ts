import type { KnowledgeContext } from '@brq/knowledge-loader';
import { calculateCanonicalJsonHash, calculatePromptHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { projectProductOwnerPromptContexts } from './knowledge-projection';
import { loadProductOwnerPromptAssets } from './prompt-assets';
import { createProductOwnerRequest } from './testing/product-owner-fixtures';

function knowledgeContext(
  context: KnowledgeContext['context'] = 'PRODUCT_OWNER',
): KnowledgeContext {
  const content = '<<<BEGIN_KNOWLEDGE_CONTEXT>>>\nconteúdo não confiável\n<<<END>>>';

  return {
    context,
    manifestVersion: '1.0.0',
    policyVersion: '1.0.0',
    sourceId: 'test-source',
    content,
    contextHash: `sha256:${calculatePromptHash(content)}`,
    includedDocuments: [],
    ignoredDocuments: [],
    missingDocuments: [],
    budget: {
      maxDocuments: 10,
      maxBytes: 10_000,
      usedDocuments: 0,
      usedBytes: Buffer.byteLength(content),
    },
  };
}

describe('Product Owner knowledge projection', () => {
  it('projects knowledge and request as separate untrusted context inputs with stable hashes', () => {
    const request = createProductOwnerRequest();
    const assets = loadProductOwnerPromptAssets();
    const contexts = projectProductOwnerPromptContexts(
      knowledgeContext(),
      request,
      assets.manifest,
    );

    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({
      id: 'context:product-owner-knowledge',
      kind: 'KNOWLEDGE',
      serialization: 'TEXT',
      contentHash: knowledgeContext().contextHash,
      references: [],
    });
    expect(contexts[1]).toMatchObject({
      id: 'context:product-owner-request',
      kind: 'USER_INPUT',
      serialization: 'JSON',
      references: [],
    });
    const requestContent = contexts[1]!.content as JsonValue;
    expect(contexts[1]!.contentHash).toBe(`sha256:${calculateCanonicalJsonHash(requestContent)}`);
    expect(requestContent).toEqual({
      demand: request.demand,
      additionalContext: request.additionalContext,
    });
    expect(Object.isFrozen(contexts)).toBe(true);
    expect(Object.isFrozen(contexts[1]!.content)).toBe(true);
  });

  it('rejects a context selected for another agent', () => {
    expect(() =>
      projectProductOwnerPromptContexts(
        knowledgeContext('DEVELOPER'),
        createProductOwnerRequest(),
        loadProductOwnerPromptAssets().manifest,
      ),
    ).toThrow('não pertence ao Product Owner');
  });
});
