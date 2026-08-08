import { knowledgeContextSchema, type KnowledgeContext } from '@brq/knowledge-loader';
import {
  calculateCanonicalJsonHash,
  promptContextInputSchema,
  type PromptContextInput,
} from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { CodeGenerationRequest } from './contracts';
import { deepFreeze } from './immutability';
import type { CodeGeneratorPromptAssetManifest } from './prompt-assets';

function parsePromptContext(candidate: unknown): PromptContextInput {
  return deepFreeze(promptContextInputSchema.parse(candidate) as PromptContextInput);
}

export function projectCodeGeneratorPromptContexts(
  rawKnowledgeContext: KnowledgeContext,
  request: CodeGenerationRequest,
  manifest: CodeGeneratorPromptAssetManifest,
): readonly PromptContextInput[] {
  const knowledgeContext = knowledgeContextSchema.parse(rawKnowledgeContext) as KnowledgeContext;
  if (knowledgeContext.context !== 'CODE_GENERATOR') {
    throw new Error('O contexto carregado não pertence ao Code Generator.');
  }

  const technicalSpecification = request.technicalSpecification as unknown as JsonValue;
  return deepFreeze([
    parsePromptContext({
      id: manifest.contexts.knowledge,
      kind: 'KNOWLEDGE',
      serialization: 'TEXT',
      content: knowledgeContext.content,
      contentHash: knowledgeContext.contextHash,
      references: knowledgeContext.includedDocuments.map((document) => ({
        id: document.id,
        category: document.category,
        hash: document.hash,
      })),
    }),
    parsePromptContext({
      id: manifest.contexts.technicalSpecification,
      kind: 'ARTIFACT',
      serialization: 'JSON',
      content: technicalSpecification,
      contentHash: `sha256:${calculateCanonicalJsonHash(technicalSpecification)}`,
      references: [],
    }),
  ]);
}
