export const KNOWLEDGE_ERROR_CODES = {
  INVALID_ROOT: 'KNOWLEDGE_INVALID_ROOT',
  DOCUMENT_NOT_FOUND: 'KNOWLEDGE_DOCUMENT_NOT_FOUND',
  DOCUMENT_NOT_AUTHORIZED: 'KNOWLEDGE_DOCUMENT_NOT_AUTHORIZED',
  PATH_TRAVERSAL: 'KNOWLEDGE_PATH_TRAVERSAL',
  SYMLINK_NOT_ALLOWED: 'KNOWLEDGE_SYMLINK_NOT_ALLOWED',
  INVALID_MANIFEST: 'KNOWLEDGE_INVALID_MANIFEST',
  UNKNOWN_CATEGORY: 'KNOWLEDGE_UNKNOWN_CATEGORY',
  UNKNOWN_CONTEXT: 'KNOWLEDGE_UNKNOWN_CONTEXT',
  BUDGET_EXCEEDED: 'KNOWLEDGE_BUDGET_EXCEEDED',
  READ_FAILED: 'KNOWLEDGE_READ_FAILED',
  HASH_MISMATCH: 'KNOWLEDGE_HASH_MISMATCH',
  INVALID_ENCODING: 'KNOWLEDGE_INVALID_ENCODING',
  INVALID_DOCUMENT: 'KNOWLEDGE_INVALID_DOCUMENT',
  EMPTY_DOCUMENT: 'KNOWLEDGE_EMPTY_DOCUMENT',
} as const;

export type KnowledgeLoaderErrorCode =
  (typeof KNOWLEDGE_ERROR_CODES)[keyof typeof KNOWLEDGE_ERROR_CODES];

export interface KnowledgeLoaderErrorOptions {
  code: KnowledgeLoaderErrorCode;
  sourceId: string;
  documentId?: string;
  cause?: unknown;
}

export class KnowledgeLoaderError extends Error {
  readonly code: KnowledgeLoaderErrorCode;
  readonly sourceId: string;
  readonly documentId: string | undefined;

  constructor(message: string, options: KnowledgeLoaderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'KnowledgeLoaderError';
    this.code = options.code;
    this.sourceId = options.sourceId;
    this.documentId = options.documentId;
  }
}
