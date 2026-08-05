import { createHash } from 'node:crypto';

import { KNOWLEDGE_ERROR_CODES, KnowledgeLoaderError } from './errors';

export interface KnowledgeDocumentContent {
  content: string;
  hash: string;
  sizeBytes: number;
  title: string;
}

interface DocumentContext {
  documentId: string;
  sourceId: string;
}

export function calculateKnowledgeHash(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function decodeKnowledgeDocument(
  bytes: Uint8Array,
  context: DocumentContext,
): KnowledgeDocumentContent {
  let content: string;

  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new KnowledgeLoaderError('O documento não possui encoding UTF-8 válido.', {
      code: KNOWLEDGE_ERROR_CODES.INVALID_ENCODING,
      sourceId: context.sourceId,
      documentId: context.documentId,
      cause: error,
    });
  }

  if (content.trim().length === 0) {
    throw new KnowledgeLoaderError('O documento de conhecimento está vazio.', {
      code: KNOWLEDGE_ERROR_CODES.EMPTY_DOCUMENT,
      sourceId: context.sourceId,
      documentId: context.documentId,
    });
  }

  const firstContentLine = content.split(/\r?\n/).find((line) => line.trim().length > 0);
  const titleMatch =
    firstContentLine === undefined ? null : /^#\s+(.+?)\s*$/.exec(firstContentLine);
  const title = titleMatch?.[1]?.trim();

  if (title === undefined || title.length === 0 || title.length > 512) {
    throw new KnowledgeLoaderError('O documento deve possuir um título H1 válido.', {
      code: KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
      sourceId: context.sourceId,
      documentId: context.documentId,
    });
  }

  return {
    content,
    hash: calculateKnowledgeHash(bytes),
    sizeBytes: bytes.byteLength,
    title,
  };
}
