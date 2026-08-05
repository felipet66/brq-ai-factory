import { Buffer } from 'node:buffer';

import type { KnowledgeContextKind, KnowledgeDocumentMetadata } from './contracts';
import { calculateKnowledgeHash } from './document-content';

export interface LoadedKnowledgeDocument {
  content: string;
  metadata: KnowledgeDocumentMetadata;
}

export interface ComposeKnowledgeContextInput {
  context: KnowledgeContextKind;
  documents: readonly LoadedKnowledgeDocument[];
  manifestVersion: string;
  policyVersion: string;
  sourceId: string;
}

export interface ComposedKnowledgeContext {
  content: string;
  hash: string;
  sizeBytes: number;
}

function composeDocument(document: LoadedKnowledgeDocument): string {
  const { metadata } = document;
  const boundaryId = `${metadata.id}:${metadata.hash}`;

  return [
    `<<<BEGIN_KNOWLEDGE_DOCUMENT:${boundaryId}>>>`,
    `id: ${metadata.id}`,
    `title: ${metadata.title}`,
    `category: ${metadata.category}`,
    `hash: ${metadata.hash}`,
    `sourceId: ${metadata.origin.sourceId}`,
    `locator: ${metadata.origin.locator}`,
    `sizeBytes: ${metadata.sizeBytes}`,
    `<<<BEGIN_KNOWLEDGE_CONTENT:${boundaryId}>>>`,
    document.content,
    `<<<END_KNOWLEDGE_CONTENT:${boundaryId}>>>`,
    `<<<END_KNOWLEDGE_DOCUMENT:${boundaryId}>>>`,
  ].join('\n');
}

export function composeKnowledgeContext(
  input: ComposeKnowledgeContextInput,
): ComposedKnowledgeContext {
  const sections = input.documents.map(composeDocument);
  const boundaryHash = calculateKnowledgeHash(
    JSON.stringify({
      context: input.context,
      manifestVersion: input.manifestVersion,
      policyVersion: input.policyVersion,
      sourceId: input.sourceId,
      documents: input.documents.map(({ metadata }) => ({
        id: metadata.id,
        hash: metadata.hash,
      })),
    }),
  );
  const content = [
    `<<<BEGIN_KNOWLEDGE_CONTEXT:${boundaryHash}>>>`,
    `context: ${input.context}`,
    `manifestVersion: ${input.manifestVersion}`,
    `policyVersion: ${input.policyVersion}`,
    `sourceId: ${input.sourceId}`,
    `documentCount: ${input.documents.length}`,
    ...sections,
    `<<<END_KNOWLEDGE_CONTEXT:${boundaryHash}>>>`,
  ].join('\n');

  return {
    content,
    hash: calculateKnowledgeHash(content),
    sizeBytes: Buffer.byteLength(content, 'utf8'),
  };
}
