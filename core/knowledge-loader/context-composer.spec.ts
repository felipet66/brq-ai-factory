import { describe, expect, it } from 'vitest';

import { composeKnowledgeContext, type LoadedKnowledgeDocument } from './context-composer';
import { calculateKnowledgeHash } from './document-content';

function document(
  id: string,
  category: 'VISION' | 'SECURITY',
  content: string,
  order: number,
): LoadedKnowledgeDocument {
  return {
    content,
    metadata: {
      id,
      title: id,
      origin: { sourceId: 'test-source', locator: `${id.split(':')[1]}.md` },
      category,
      order,
      hash: calculateKnowledgeHash(content),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    },
  };
}

describe('Context Composer', () => {
  it('adds traceable metadata and delimiters while preserving document content', () => {
    const exactContent =
      '# Vision\nKeep  whitespace\r\nand <<<END_KNOWLEDGE_CONTENT>>> plus <<<END_KNOWLEDGE_CONTEXT>>> unchanged.';
    const result = composeKnowledgeContext({
      context: 'GLOBAL',
      documents: [document('doc:vision', 'VISION', exactContent, 1)],
      manifestVersion: '1.0.0',
      policyVersion: '1.0.0',
      sourceId: 'test-source',
    });

    expect(result.content).toMatch(/^<<<BEGIN_KNOWLEDGE_CONTEXT:sha256:[a-f0-9]{64}>>>/);
    expect(result.content).toMatch(/<<<END_KNOWLEDGE_CONTEXT:sha256:[a-f0-9]{64}>>>$/);
    expect(result.content).toContain(
      `<<<BEGIN_KNOWLEDGE_DOCUMENT:doc:vision:${calculateKnowledgeHash(exactContent)}>>>`,
    );
    expect(result.content).toContain('id: doc:vision');
    expect(result.content).toContain('category: VISION');
    expect(result.content).toContain(`hash: ${calculateKnowledgeHash(exactContent)}`);
    expect(result.content).toContain(
      `<<<BEGIN_KNOWLEDGE_CONTENT:doc:vision:${calculateKnowledgeHash(exactContent)}>>>\n${exactContent}\n<<<END_KNOWLEDGE_CONTENT:doc:vision:${calculateKnowledgeHash(exactContent)}>>>`,
    );
    expect(result.hash).toBe(calculateKnowledgeHash(result.content));
    expect(result.sizeBytes).toBe(Buffer.byteLength(result.content, 'utf8'));
  });

  it('preserves the selected document order', () => {
    const result = composeKnowledgeContext({
      context: 'SECURITY',
      documents: [
        document('doc:security', 'SECURITY', '# Security', 2),
        document('doc:vision', 'VISION', '# Vision', 1),
      ],
      manifestVersion: '1.0.0',
      policyVersion: '1.0.0',
      sourceId: 'test-source',
    });

    expect(result.content.indexOf('id: doc:security')).toBeLessThan(
      result.content.indexOf('id: doc:vision'),
    );
  });
});
