import { describe, expect, it } from 'vitest';

import { decodeKnowledgeDocument, calculateKnowledgeHash } from './document-content';
import { KNOWLEDGE_ERROR_CODES } from './errors';

const CONTEXT = { sourceId: 'test-source', documentId: 'doc:test' };

describe('document content', () => {
  it('calculates a deterministic SHA-256 hash from exact bytes', () => {
    expect(calculateKnowledgeHash('abc')).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('preserves content and extracts the first H1 deterministically', () => {
    const content = '# Canonical title\r\n\r\nBody with  ç and trailing spaces  ';
    const result = decodeKnowledgeDocument(new TextEncoder().encode(content), CONTEXT);

    expect(result.content).toBe(content);
    expect(result.title).toBe('Canonical title');
    expect(result.sizeBytes).toBe(Buffer.byteLength(content, 'utf8'));
  });

  it('rejects malformed UTF-8', () => {
    expect(() => decodeKnowledgeDocument(Uint8Array.from([0xc3, 0x28]), CONTEXT)).toThrowError(
      expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.INVALID_ENCODING }),
    );
  });

  it('rejects empty documents', () => {
    expect(() => decodeKnowledgeDocument(new TextEncoder().encode('  \n'), CONTEXT)).toThrowError(
      expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.EMPTY_DOCUMENT }),
    );
  });

  it('rejects documents without a valid H1 title', () => {
    expect(() =>
      decodeKnowledgeDocument(new TextEncoder().encode('## Secondary\nBody'), CONTEXT),
    ).toThrowError(expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT }));
  });

  it('does not treat a later heading as the canonical document title', () => {
    expect(() =>
      decodeKnowledgeDocument(
        new TextEncoder().encode('Introductory text\n# Late heading'),
        CONTEXT,
      ),
    ).toThrowError(expect.objectContaining({ code: KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT }));
  });
});
