import type { KnowledgeContext } from '@brq/knowledge-loader';
import { calculateCanonicalJsonHash, calculatePromptHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { projectCodeGeneratorPromptContexts } from './knowledge-projection';
import { loadCodeGeneratorPromptAssets } from './prompt-assets';
import { createCodeGenerationRequest } from './testing/code-generator-fixtures';

function knowledgeContext(
  context: KnowledgeContext['context'] = 'CODE_GENERATOR',
): KnowledgeContext {
  const content = '<<<BEGIN_KNOWLEDGE_CONTEXT>>>\ntrusted boundary guidance\n<<<END>>>';
  return {
    context,
    manifestVersion: '1.0.0',
    policyVersion: '1.0.0',
    sourceId: 'test-source',
    content,
    contextHash: `sha256:${calculatePromptHash(content)}`,
    includedDocuments: [
      {
        id: 'knowledge:code-generator-test',
        title: 'Code Generator test',
        category: 'ENGINEERING',
        order: 1,
        origin: { sourceId: 'test-source', locator: 'code-generator.md' },
        sizeBytes: Buffer.byteLength(content),
        hash: `sha256:${calculatePromptHash(content)}`,
      },
    ],
    ignoredDocuments: [],
    missingDocuments: [],
    budget: {
      maxDocuments: 4,
      maxBytes: 48 * 1024,
      usedDocuments: 1,
      usedBytes: Buffer.byteLength(content),
    },
  };
}

describe('Code Generator knowledge projection', () => {
  it('projects exactly Knowledge and TechnicalSpecification as untrusted inputs', () => {
    const request = createCodeGenerationRequest();
    const snapshot = structuredClone(request);
    const knowledge = knowledgeContext();
    const contexts = projectCodeGeneratorPromptContexts(
      knowledge,
      request,
      loadCodeGeneratorPromptAssets().manifest,
    );

    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({
      id: 'context:code-generator-knowledge',
      kind: 'KNOWLEDGE',
      serialization: 'TEXT',
      content: knowledge.content,
      contentHash: knowledge.contextHash,
    });
    expect(contexts[1]).toMatchObject({
      id: 'context:code-generator-technical-specification',
      kind: 'ARTIFACT',
      serialization: 'JSON',
      content: request.technicalSpecification,
      references: [],
    });
    expect(contexts[1]!.contentHash).toBe(
      `sha256:${calculateCanonicalJsonHash(contexts[1]!.content as JsonValue)}`,
    );
    expect(contexts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ content: request.approval })]),
    );
    expect(Object.isFrozen(contexts)).toBe(true);
    expect(Object.isFrozen(contexts[1]!.content)).toBe(true);
    expect(request).toEqual(snapshot);
    expect(Object.isFrozen(request)).toBe(false);
  });

  it('rejects Knowledge selected for another agent', () => {
    expect(() =>
      projectCodeGeneratorPromptContexts(
        knowledgeContext('DEVELOPER'),
        createCodeGenerationRequest(),
        loadCodeGeneratorPromptAssets().manifest,
      ),
    ).toThrow('não pertence ao Code Generator');
  });
});
