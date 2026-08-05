import type { Logger } from '@brq/shared/logger/logger';
import { createLogger } from '@brq/shared/logger/logger';
import { z } from 'zod';

import { composeKnowledgeContext, type LoadedKnowledgeDocument } from './context-composer';
import type {
  KnowledgeContext,
  KnowledgeDocumentMetadata,
  KnowledgeIgnoredDocument,
  KnowledgeIndex,
  KnowledgeLoadRequest,
  KnowledgeManifest,
  KnowledgeSelectionPolicy,
} from './contracts';
import { decodeKnowledgeDocument } from './document-content';
import { KNOWLEDGE_ERROR_CODES, KnowledgeLoaderError } from './errors';
import { buildKnowledgeIndex } from './knowledge-index';
import type { KnowledgeSource } from './knowledge-source';
import { KNOWLEDGE_MANIFEST, parseKnowledgeManifest } from './manifest';
import {
  getKnowledgeSelectionRule,
  KNOWLEDGE_SELECTION_POLICY,
  parseKnowledgeSelectionPolicy,
} from './selection-policy';
import {
  knowledgeContextKindSchema,
  knowledgeContextSchema,
  knowledgeLoadRequestSchema,
} from './schemas';

export const DEFAULT_CONTEXT_MAX_DOCUMENTS = 24;
export const DEFAULT_CONTEXT_MAX_BYTES = 64 * 1024;

const knowledgeLoaderConfigurationSchema = z
  .object({
    maxDocuments: z.number().int().positive().default(DEFAULT_CONTEXT_MAX_DOCUMENTS),
    maxBytes: z.number().int().positive().default(DEFAULT_CONTEXT_MAX_BYTES),
  })
  .strict();

export interface KnowledgeLoaderConfiguration {
  maxBytes?: number;
  maxDocuments?: number;
}

export interface CreateKnowledgeLoaderOptions {
  configuration?: KnowledgeLoaderConfiguration;
  logger?: Logger;
  manifest?: KnowledgeManifest;
  now?: () => number;
  policy?: KnowledgeSelectionPolicy;
  source: KnowledgeSource;
}

export interface KnowledgeLoader {
  getIndex(): KnowledgeIndex;
  load(request: KnowledgeLoadRequest): Promise<KnowledgeContext>;
}

interface EffectiveBudget {
  maxBytes: number;
  maxDocuments: number;
}

function unexpectedLoaderError(error: unknown, sourceId: string): KnowledgeLoaderError {
  if (error instanceof KnowledgeLoaderError) {
    return error;
  }

  return new KnowledgeLoaderError('Não foi possível carregar o contexto de conhecimento.', {
    code: KNOWLEDGE_ERROR_CODES.READ_FAILED,
    sourceId,
    cause: error,
  });
}

function documentReadError(
  error: unknown,
  sourceId: string,
  documentId: string,
): KnowledgeLoaderError {
  if (error instanceof KnowledgeLoaderError) {
    return new KnowledgeLoaderError('Não foi possível reler um documento do índice.', {
      code: error.code,
      sourceId,
      documentId,
      cause: error,
    });
  }

  return new KnowledgeLoaderError('Não foi possível reler um documento do índice.', {
    code: KNOWLEDGE_ERROR_CODES.READ_FAILED,
    sourceId,
    documentId,
    cause: error,
  });
}

class IndexedKnowledgeLoader implements KnowledgeLoader {
  constructor(
    private readonly source: KnowledgeSource,
    private readonly manifest: KnowledgeManifest,
    private readonly policy: KnowledgeSelectionPolicy,
    private readonly index: KnowledgeIndex,
    private readonly configuration: EffectiveBudget,
    private readonly logger: Logger,
    private readonly now: () => number,
  ) {}

  getIndex(): KnowledgeIndex {
    return this.index;
  }

  async load(request: KnowledgeLoadRequest): Promise<KnowledgeContext> {
    const startedAt = this.now();
    const parsedRequest = knowledgeLoadRequestSchema.safeParse(request);

    if (!parsedRequest.success) {
      const rawContext =
        typeof request === 'object' && request !== null && 'context' in request
          ? request.context
          : undefined;
      const parsedContext = knowledgeContextKindSchema.safeParse(rawContext);

      const knowledgeError = new KnowledgeLoaderError('Solicitação da Knowledge Layer inválida.', {
        code: parsedContext.success
          ? KNOWLEDGE_ERROR_CODES.BUDGET_EXCEEDED
          : KNOWLEDGE_ERROR_CODES.UNKNOWN_CONTEXT,
        sourceId: this.source.sourceId,
        cause: parsedRequest.error,
      });

      this.logger.error('knowledge.context.failed', {
        sourceId: this.source.sourceId,
        context: parsedContext.success ? parsedContext.data : undefined,
        manifestVersion: this.manifest.version,
        policyVersion: this.policy.version,
        errorCode: knowledgeError.code,
        durationMs: Math.max(0, Math.round(this.now() - startedAt)),
      });
      throw knowledgeError;
    }

    const validRequest = parsedRequest.data;

    try {
      const budget = this.resolveBudget(validRequest);
      const selection = getKnowledgeSelectionRule(validRequest.context, this.policy);

      this.logger.info('knowledge.context.started', {
        sourceId: this.source.sourceId,
        context: validRequest.context,
        manifestVersion: this.manifest.version,
        policyVersion: this.policy.version,
        maxDocuments: budget.maxDocuments,
        maxBytes: budget.maxBytes,
      });

      const availableById = new Map(
        this.index.availableDocuments.map((document) => [document.id, document]),
      );
      const missingById = new Map(
        this.index.missingDocuments.map((document) => [document.id, document]),
      );

      for (const documentId of selection.required) {
        if (missingById.has(documentId) || !availableById.has(documentId)) {
          throw new KnowledgeLoaderError('Um documento obrigatório não foi encontrado.', {
            code: KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND,
            sourceId: this.source.sourceId,
            documentId,
          });
        }
      }

      if (selection.required.length > budget.maxDocuments) {
        throw this.budgetExceeded();
      }

      const included: LoadedKnowledgeDocument[] = [];

      for (const documentId of selection.required) {
        const metadata = availableById.get(documentId);

        if (metadata === undefined) {
          throw new KnowledgeLoaderError('Um documento obrigatório não foi encontrado.', {
            code: KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND,
            sourceId: this.source.sourceId,
            documentId,
          });
        }

        included.push(await this.loadIndexedDocument(metadata));
      }

      let composed = this.compose(validRequest.context, included);

      if (composed.sizeBytes > budget.maxBytes) {
        throw this.budgetExceeded();
      }

      const budgetExcluded = new Set<string>();

      for (const documentId of selection.optional) {
        const metadata = availableById.get(documentId);
        if (metadata === undefined) {
          continue;
        }

        if (included.length >= budget.maxDocuments) {
          budgetExcluded.add(documentId);
          continue;
        }

        const candidate = await this.loadIndexedDocument(metadata);
        const candidateDocuments = [...included, candidate];
        const candidateContext = this.compose(validRequest.context, candidateDocuments);

        if (candidateContext.sizeBytes > budget.maxBytes) {
          budgetExcluded.add(documentId);
          continue;
        }

        included.push(candidate);
        composed = candidateContext;
      }

      const includedIds = new Set(included.map((document) => document.metadata.id));
      const ignoredDocuments: KnowledgeIgnoredDocument[] = this.index.availableDocuments
        .filter((document) => !includedIds.has(document.id))
        .map((document) => ({
          id: document.id,
          locator: document.origin.locator,
          reason: budgetExcluded.has(document.id) ? 'BUDGET_EXCEEDED' : 'NOT_SELECTED',
        }));

      ignoredDocuments.push(
        ...this.index.unmanifestedLocators.map((locator) => ({
          id: null,
          locator,
          reason: 'NOT_IN_MANIFEST' as const,
        })),
      );

      const contextResult = knowledgeContextSchema.safeParse({
        context: validRequest.context,
        manifestVersion: this.manifest.version,
        policyVersion: this.policy.version,
        sourceId: this.source.sourceId,
        content: composed.content,
        contextHash: composed.hash,
        includedDocuments: included.map((document) => document.metadata),
        ignoredDocuments,
        missingDocuments: this.index.missingDocuments.map((document) => ({
          id: document.id,
          locator: document.locator,
          required: selection.required.includes(document.id),
        })),
        budget: {
          maxDocuments: budget.maxDocuments,
          maxBytes: budget.maxBytes,
          usedDocuments: included.length,
          usedBytes: composed.sizeBytes,
        },
      });

      if (!contextResult.success) {
        throw new KnowledgeLoaderError('O contexto de conhecimento gerado é inválido.', {
          code: KNOWLEDGE_ERROR_CODES.INVALID_DOCUMENT,
          sourceId: this.source.sourceId,
          cause: contextResult.error,
        });
      }

      this.logger.info('knowledge.context.completed', {
        sourceId: this.source.sourceId,
        context: validRequest.context,
        manifestVersion: this.manifest.version,
        policyVersion: this.policy.version,
        documentIds: contextResult.data.includedDocuments.map((document) => document.id),
        hashes: contextResult.data.includedDocuments.map((document) => document.hash),
        documentCount: contextResult.data.budget.usedDocuments,
        sizeBytes: contextResult.data.budget.usedBytes,
        contextHash: contextResult.data.contextHash,
        durationMs: Math.max(0, Math.round(this.now() - startedAt)),
      });

      return contextResult.data;
    } catch (error) {
      const knowledgeError = unexpectedLoaderError(error, this.source.sourceId);
      this.logger.error('knowledge.context.failed', {
        sourceId: this.source.sourceId,
        context: validRequest.context,
        manifestVersion: this.manifest.version,
        policyVersion: this.policy.version,
        errorCode: knowledgeError.code,
        documentId: knowledgeError.documentId,
        durationMs: Math.max(0, Math.round(this.now() - startedAt)),
      });
      throw knowledgeError;
    }
  }

  private resolveBudget(request: KnowledgeLoadRequest): EffectiveBudget {
    const maxDocuments = request.maxDocuments ?? this.configuration.maxDocuments;
    const maxBytes = request.maxBytes ?? this.configuration.maxBytes;

    if (maxDocuments > this.configuration.maxDocuments || maxBytes > this.configuration.maxBytes) {
      throw this.budgetExceeded();
    }

    return { maxDocuments, maxBytes };
  }

  private budgetExceeded(): KnowledgeLoaderError {
    return new KnowledgeLoaderError('O orçamento do contexto de conhecimento foi excedido.', {
      code: KNOWLEDGE_ERROR_CODES.BUDGET_EXCEEDED,
      sourceId: this.source.sourceId,
    });
  }

  private async loadIndexedDocument(
    metadata: KnowledgeDocumentMetadata,
  ): Promise<LoadedKnowledgeDocument> {
    let decoded: ReturnType<typeof decodeKnowledgeDocument>;

    try {
      decoded = decodeKnowledgeDocument(await this.source.read(metadata.origin.locator), {
        documentId: metadata.id,
        sourceId: this.source.sourceId,
      });
    } catch (error) {
      throw documentReadError(error, this.source.sourceId, metadata.id);
    }

    if (decoded.hash !== metadata.hash) {
      throw new KnowledgeLoaderError('O documento mudou após a construção do índice.', {
        code: KNOWLEDGE_ERROR_CODES.HASH_MISMATCH,
        sourceId: this.source.sourceId,
        documentId: metadata.id,
      });
    }

    return { content: decoded.content, metadata };
  }

  private compose(
    context: KnowledgeContext['context'],
    documents: readonly LoadedKnowledgeDocument[],
  ) {
    return composeKnowledgeContext({
      context,
      documents,
      manifestVersion: this.manifest.version,
      policyVersion: this.policy.version,
      sourceId: this.source.sourceId,
    });
  }
}

export async function createKnowledgeLoader(
  options: CreateKnowledgeLoaderOptions,
): Promise<KnowledgeLoader> {
  const manifest = parseKnowledgeManifest(options.manifest ?? KNOWLEDGE_MANIFEST);
  const policy = parseKnowledgeSelectionPolicy(
    options.policy ?? KNOWLEDGE_SELECTION_POLICY,
    manifest,
  );
  const configurationResult = knowledgeLoaderConfigurationSchema.safeParse(
    options.configuration ?? {},
  );

  if (!configurationResult.success) {
    throw new KnowledgeLoaderError('A configuração do Knowledge Loader é inválida.', {
      code: KNOWLEDGE_ERROR_CODES.BUDGET_EXCEEDED,
      sourceId: options.source.sourceId,
      cause: configurationResult.error,
    });
  }

  const logger = options.logger ?? createLogger();
  const now = options.now ?? Date.now;
  const index = await buildKnowledgeIndex({
    source: options.source,
    manifest,
    logger,
    now,
  });

  return new IndexedKnowledgeLoader(
    options.source,
    manifest,
    policy,
    index,
    configurationResult.data,
    logger,
    now,
  );
}
