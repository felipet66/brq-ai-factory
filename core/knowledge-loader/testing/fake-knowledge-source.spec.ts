import { describe, expect, it } from 'vitest';

import { KNOWLEDGE_ERROR_CODES } from '../errors';
import { FakeKnowledgeSource } from './fake-knowledge-source';
import { defineKnowledgeSourceContract } from './knowledge-source-contract';

defineKnowledgeSourceContract('FakeKnowledgeSource', async () => ({
  source: new FakeKnowledgeSource({ documents: { 'document.md': '# Document\nBody' } }),
  locator: 'document.md',
  content: '# Document\nBody',
}));

describe('FakeKnowledgeSource', () => {
  it('supports deterministic content changes for hash mismatch tests', async () => {
    const source = new FakeKnowledgeSource({ documents: { 'document.md': '# Before' } });

    source.setDocument('document.md', '# After');

    await expect(source.read('document.md')).resolves.toEqual(new TextEncoder().encode('# After'));
    expect(source.readCalls).toEqual(['document.md']);
  });

  it('translates missing documents into the local canonical error', async () => {
    const source = new FakeKnowledgeSource();

    await expect(source.read('missing.md')).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND,
      sourceId: 'fake-knowledge',
    });
  });
});
