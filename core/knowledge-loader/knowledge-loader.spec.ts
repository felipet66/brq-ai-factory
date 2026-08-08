import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import type { KnowledgeManifest, KnowledgeSelectionPolicy } from './contracts';
import { KNOWLEDGE_ERROR_CODES } from './errors';
import {
  createKnowledgeLoader,
  DEFAULT_CONTEXT_MAX_BYTES,
  DEFAULT_CONTEXT_MAX_DOCUMENTS,
  type KnowledgeLoaderConfiguration,
} from './knowledge-loader';
import { knowledgeContextSchema } from './schemas';
import { FakeKnowledgeSource } from './testing/fake-knowledge-source';

const MANIFEST: KnowledgeManifest = {
  version: '1.0.0',
  documents: [
    { id: 'doc:required', locator: 'required.md', category: 'VISION', order: 1 },
    { id: 'doc:optional', locator: 'optional.md', category: 'SECURITY', order: 2 },
    { id: 'doc:unused', locator: 'unused.md', category: 'FAQ', order: 3 },
    { id: 'doc:missing', locator: 'missing.md', category: 'GLOSSARY', order: 4 },
  ],
};

function policy(
  required: string[] = ['doc:required'],
  optional: string[] = ['doc:optional', 'doc:missing'],
): KnowledgeSelectionPolicy {
  const rule = (): { required: string[]; optional: string[] } => ({
    required: [...required],
    optional: [...optional],
  });

  return {
    version: '1.0.0',
    contexts: {
      GLOBAL: rule(),
      PRODUCT_OWNER: rule(),
      DEVELOPER: rule(),
      QA: rule(),
      CODE_GENERATOR: rule(),
      SECURITY: rule(),
      ARCHITECTURE: rule(),
    },
  };
}

interface FixtureOptions {
  configuration?: KnowledgeLoaderConfiguration;
  documents?: Readonly<Record<string, string>>;
  lines?: string[];
  selectionPolicy?: KnowledgeSelectionPolicy;
}

async function fixture(options: FixtureOptions = {}) {
  const source = new FakeKnowledgeSource({
    documents: options.documents ?? {
      'required.md': '# Required\nOriginal required content.',
      'optional.md': '# Optional\nOptional content.',
      'unused.md': '# Unused\nUnused content.',
      'extra.md': '# Extra\nNot in the manifest.',
    },
  });
  const lines = options.lines ?? [];
  const loader = await createKnowledgeLoader({
    source,
    manifest: MANIFEST,
    policy: options.selectionPolicy ?? policy(),
    ...(options.configuration === undefined ? {} : { configuration: options.configuration }),
    logger: createLogger({ sink: (line) => lines.push(line) }),
  });

  return { lines, loader, source };
}

describe('Knowledge Loader', () => {
  it('loads only selected documents per request and returns complete traceability', async () => {
    const { loader, source } = await fixture();
    source.readCalls.length = 0;

    const result = await loader.load({ context: 'GLOBAL' });

    expect(knowledgeContextSchema.safeParse(result).success).toBe(true);
    expect(result.includedDocuments.map(({ id }) => id)).toEqual(['doc:required', 'doc:optional']);
    expect(source.readCalls).toEqual(['required.md', 'optional.md']);
    expect(result.content).toContain('# Required\nOriginal required content.');
    expect(result.ignoredDocuments).toEqual([
      { id: 'doc:unused', locator: 'unused.md', reason: 'NOT_SELECTED' },
      { id: null, locator: 'extra.md', reason: 'NOT_IN_MANIFEST' },
    ]);
    expect(result.missingDocuments).toEqual([
      { id: 'doc:missing', locator: 'missing.md', required: false },
    ]);
    expect(result.budget).toMatchObject({
      maxDocuments: DEFAULT_CONTEXT_MAX_DOCUMENTS,
      maxBytes: DEFAULT_CONTEXT_MAX_BYTES,
      usedDocuments: 2,
    });
  });

  it('returns the same context for the same index, policy and content', async () => {
    const { loader } = await fixture();

    await expect(loader.load({ context: 'GLOBAL' })).resolves.toEqual(
      await loader.load({ context: 'GLOBAL' }),
    );
  });

  it('drops optional documents by document budget without truncation', async () => {
    const { loader } = await fixture();

    const result = await loader.load({ context: 'GLOBAL', maxDocuments: 1 });

    expect(result.includedDocuments.map(({ id }) => id)).toEqual(['doc:required']);
    expect(result.ignoredDocuments).toContainEqual({
      id: 'doc:optional',
      locator: 'optional.md',
      reason: 'BUDGET_EXCEEDED',
    });
    expect(result.content).not.toContain('Optional content.');
    expect(result.content).toContain('Original required content.');
  });

  it('drops optional documents by exact byte budget', async () => {
    const { loader } = await fixture();
    const requiredOnly = await loader.load({ context: 'GLOBAL', maxDocuments: 1 });

    const result = await loader.load({
      context: 'GLOBAL',
      maxBytes: requiredOnly.budget.usedBytes,
    });

    expect(result.budget.usedBytes).toBe(requiredOnly.budget.usedBytes);
    expect(result.includedDocuments.map(({ id }) => id)).toEqual(['doc:required']);
    expect(result.ignoredDocuments).toContainEqual(
      expect.objectContaining({ id: 'doc:optional', reason: 'BUDGET_EXCEEDED' }),
    );
  });

  it('fails explicitly when required documents exceed the byte budget', async () => {
    const { loader } = await fixture();

    await expect(loader.load({ context: 'GLOBAL', maxBytes: 1 })).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.BUDGET_EXCEEDED,
    });
  });

  it('fails explicitly when required documents exceed the document budget', async () => {
    const { loader } = await fixture({
      selectionPolicy: policy(['doc:required', 'doc:optional'], []),
    });

    await expect(loader.load({ context: 'GLOBAL', maxDocuments: 1 })).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.BUDGET_EXCEEDED,
    });
  });

  it('does not allow a request to increase the trusted instance budget', async () => {
    const { loader } = await fixture({ configuration: { maxDocuments: 2, maxBytes: 4_096 } });

    await expect(loader.load({ context: 'GLOBAL', maxDocuments: 3 })).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.BUDGET_EXCEEDED,
    });
    await expect(loader.load({ context: 'GLOBAL', maxBytes: 4_097 })).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.BUDGET_EXCEEDED,
    });
  });

  it('fails when a required manifest document is absent', async () => {
    const { loader } = await fixture({
      documents: { 'optional.md': '# Optional\nBody' },
    });

    await expect(loader.load({ context: 'GLOBAL' })).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND,
      documentId: 'doc:required',
    });
  });

  it('detects content changes after the immutable index was built', async () => {
    const { loader, source } = await fixture();
    source.setDocument('required.md', '# Required\nChanged after indexing.');

    await expect(loader.load({ context: 'GLOBAL' })).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.HASH_MISMATCH,
      documentId: 'doc:required',
    });
  });

  it('adds the stable document ID when a selected indexed document disappears', async () => {
    const { loader, source } = await fixture();
    source.removeDocument('required.md');

    await expect(loader.load({ context: 'GLOBAL' })).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND,
      documentId: 'doc:required',
    });
  });

  it('rejects unknown contexts with a module-specific error', async () => {
    const { loader } = await fixture();

    await expect(loader.load({ context: 'UNKNOWN_CONTEXT' } as never)).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.UNKNOWN_CONTEXT,
    });
    await expect(loader.load(null as never)).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.UNKNOWN_CONTEXT,
    });
  });

  it('never logs complete document content', async () => {
    const lines: string[] = [];
    const marker = 'UNIQUE-PRIVATE-DOCUMENT-CONTENT';
    const { loader } = await fixture({
      documents: {
        'required.md': `# Required\n${marker}`,
        'optional.md': '# Optional\nBody',
      },
      lines,
    });

    await loader.load({ context: 'GLOBAL' });

    expect(lines.join('\n')).not.toContain(marker);
    expect(lines.map((line) => JSON.parse(line).event)).toEqual([
      'knowledge.index.started',
      'knowledge.index.completed',
      'knowledge.context.started',
      'knowledge.context.completed',
    ]);
  });

  it('logs invalid requests as sanitized technical failures', async () => {
    const lines: string[] = [];
    const { loader } = await fixture({ lines });
    lines.length = 0;

    await expect(loader.load(null as never)).rejects.toMatchObject({
      code: KNOWLEDGE_ERROR_CODES.UNKNOWN_CONTEXT,
    });

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: 'knowledge.context.failed',
        errorCode: KNOWLEDGE_ERROR_CODES.UNKNOWN_CONTEXT,
      }),
    ]);
  });
});
