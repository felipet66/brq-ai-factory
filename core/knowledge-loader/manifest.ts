import rawKnowledgeManifest from './knowledge-manifest.json' with { type: 'json' };
import type { KnowledgeManifest } from './contracts';
import { KnowledgeLoaderError, KNOWLEDGE_ERROR_CODES } from './errors';
import { deepFreeze } from './immutability';
import { knowledgeCategorySchema, knowledgeManifestSchema } from './schemas';

const MANIFEST_SOURCE_ID = 'knowledge-manifest';

export function parseKnowledgeManifest(input: unknown): KnowledgeManifest {
  if (typeof input === 'object' && input !== null && 'documents' in input) {
    const documents = (input as { documents?: unknown }).documents;

    if (Array.isArray(documents)) {
      const unknownCategoryDocument = documents.find(
        (document) =>
          typeof document === 'object' &&
          document !== null &&
          'category' in document &&
          !knowledgeCategorySchema.safeParse((document as { category?: unknown }).category).success,
      ) as { id?: unknown } | undefined;

      if (unknownCategoryDocument !== undefined) {
        throw new KnowledgeLoaderError('O manifesto possui uma classificação desconhecida.', {
          code: KNOWLEDGE_ERROR_CODES.UNKNOWN_CATEGORY,
          sourceId: MANIFEST_SOURCE_ID,
          ...(typeof unknownCategoryDocument.id === 'string'
            ? { documentId: unknownCategoryDocument.id }
            : {}),
        });
      }
    }
  }

  const result = knowledgeManifestSchema.safeParse(input);

  if (!result.success) {
    throw new KnowledgeLoaderError('Manifesto da Knowledge Layer inválido.', {
      code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST,
      sourceId: MANIFEST_SOURCE_ID,
      cause: result.error,
    });
  }

  return deepFreeze(result.data);
}

export const KNOWLEDGE_MANIFEST = parseKnowledgeManifest(rawKnowledgeManifest);
