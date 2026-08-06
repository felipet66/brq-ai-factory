import { KNOWLEDGE_MANIFEST } from '@brq/knowledge-loader';
import { FilesystemKnowledgeSource } from '@brq/knowledge-loader/filesystem';
import { FakeKnowledgeSource } from '@brq/knowledge-loader/testing';
import { describe, expect, it } from 'vitest';

describe('@brq/knowledge-loader package exports', () => {
  it('exposes the abstract API and explicit adapter subpaths', () => {
    expect(KNOWLEDGE_MANIFEST.version).toBe('1.9.0');
    expect(FilesystemKnowledgeSource).toBeTypeOf('function');
    expect(new FakeKnowledgeSource().sourceId).toBe('fake-knowledge');
  });
});
