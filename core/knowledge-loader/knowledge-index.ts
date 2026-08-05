import type { Logger } from '@brq/shared/logger/logger';
import { createLogger } from '@brq/shared/logger/logger';

import type {
  KnowledgeDocumentMetadata,
  KnowledgeIndex,
  KnowledgeManifest,
  KnowledgeManifestDocument,
} from './contracts';
import { decodeKnowledgeDocument } from './document-content';
import { KNOWLEDGE_ERROR_CODES, KnowledgeLoaderError } from './errors';
import { deepFreeze } from './immutability';
import type { KnowledgeSource } from './knowledge-source';
import { parseKnowledgeManifest } from './manifest';
import { knowledgeIndexSchema, knowledgeSourceEntrySchema } from './schemas';

export interface BuildKnowledgeIndexOptions {
  logger?: Logger;
  manifest: KnowledgeManifest;
  now?: () => number;
  source: KnowledgeSource;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortManifestDocuments(
  documents: readonly KnowledgeManifestDocument[],
): KnowledgeManifestDocument[] {
  return [...documents].sort(
    (left, right) => left.order - right.order || compareText(left.id, right.id),
  );
}

function asKnowledgeError(error: unknown, sourceId: string): KnowledgeLoaderError {
  if (error instanceof KnowledgeLoaderError) {
    return error;
  }

  return new KnowledgeLoaderError('Não foi possível construir o índice de conhecimento.', {
    code: KNOWLEDGE_ERROR_CODES.READ_FAILED,
    sourceId,
    cause: error,
  });
}

function asDocumentReadError(
  error: unknown,
  sourceId: string,
  documentId: string,
): KnowledgeLoaderError {
  if (error instanceof KnowledgeLoaderError) {
    return new KnowledgeLoaderError('Não foi possível ler um documento do manifesto.', {
      code: error.code,
      sourceId,
      documentId,
      cause: error,
    });
  }

  return new KnowledgeLoaderError('Não foi possível ler um documento do manifesto.', {
    code: KNOWLEDGE_ERROR_CODES.READ_FAILED,
    sourceId,
    documentId,
    cause: error,
  });
}

export async function buildKnowledgeIndex(
  options: BuildKnowledgeIndexOptions,
): Promise<KnowledgeIndex> {
  const logger = options.logger ?? createLogger();
  const now = options.now ?? Date.now;
  const startedAt = now();
  const manifest = parseKnowledgeManifest(options.manifest);

  logger.info('knowledge.index.started', {
    sourceId: options.source.sourceId,
    manifestVersion: manifest.version,
  });

  try {
    const discoveredResult = knowledgeSourceEntrySchema
      .array()
      .safeParse(await options.source.discover());

    if (!discoveredResult.success) {
      throw new KnowledgeLoaderError('A origem retornou entradas de conhecimento inválidas.', {
        code: KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
        sourceId: options.source.sourceId,
        cause: discoveredResult.error,
      });
    }

    const discoveredByLocator = new Map(
      discoveredResult.data.map((entry) => [entry.locator, entry]),
    );

    if (discoveredByLocator.size !== discoveredResult.data.length) {
      throw new KnowledgeLoaderError('A origem retornou documentos duplicados.', {
        code: KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
        sourceId: options.source.sourceId,
      });
    }

    const manifestDocuments = sortManifestDocuments(manifest.documents);
    const manifestLocators = new Set(manifestDocuments.map((document) => document.locator));
    const availableDocuments: KnowledgeDocumentMetadata[] = [];
    const missingDocuments: KnowledgeManifestDocument[] = [];

    for (const document of manifestDocuments) {
      if (!discoveredByLocator.has(document.locator)) {
        missingDocuments.push(document);
        continue;
      }

      let decoded: ReturnType<typeof decodeKnowledgeDocument>;

      try {
        decoded = decodeKnowledgeDocument(await options.source.read(document.locator), {
          documentId: document.id,
          sourceId: options.source.sourceId,
        });
      } catch (error) {
        throw asDocumentReadError(error, options.source.sourceId, document.id);
      }

      availableDocuments.push({
        id: document.id,
        title: decoded.title,
        origin: {
          sourceId: options.source.sourceId,
          locator: document.locator,
        },
        category: document.category,
        order: document.order,
        hash: decoded.hash,
        sizeBytes: decoded.sizeBytes,
      });
    }

    const indexResult = knowledgeIndexSchema.safeParse({
      manifestVersion: manifest.version,
      sourceId: options.source.sourceId,
      availableDocuments,
      missingDocuments,
      unmanifestedLocators: discoveredResult.data
        .map((entry) => entry.locator)
        .filter((locator) => !manifestLocators.has(locator))
        .sort(compareText),
    });

    if (!indexResult.success) {
      throw new KnowledgeLoaderError('O índice de conhecimento gerado é inválido.', {
        code: KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
        sourceId: options.source.sourceId,
        cause: indexResult.error,
      });
    }

    const index = deepFreeze(indexResult.data);
    logger.info('knowledge.index.completed', {
      sourceId: index.sourceId,
      manifestVersion: index.manifestVersion,
      documentCount: index.availableDocuments.length,
      missingDocumentCount: index.missingDocuments.length,
      unmanifestedDocumentCount: index.unmanifestedLocators.length,
      hashes: index.availableDocuments.map((document) => document.hash),
      durationMs: Math.max(0, Math.round(now() - startedAt)),
    });

    return index;
  } catch (error) {
    const knowledgeError = asKnowledgeError(error, options.source.sourceId);
    logger.error('knowledge.index.failed', {
      sourceId: options.source.sourceId,
      manifestVersion: manifest.version,
      errorCode: knowledgeError.code,
      documentId: knowledgeError.documentId,
      durationMs: Math.max(0, Math.round(now() - startedAt)),
    });
    throw knowledgeError;
  }
}
