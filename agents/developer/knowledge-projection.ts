import { knowledgeContextSchema, type KnowledgeContext } from '@brq/knowledge-loader';
import {
  calculateCanonicalJsonHash,
  promptContextInputSchema,
  type PromptContextInput,
} from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { DeveloperAgentRequest } from './contracts';
import { deepFreeze } from './immutability';
import type { DeveloperPromptAssetManifest } from './prompt-assets';

function parsePromptContext(candidate: unknown): PromptContextInput {
  return deepFreeze(promptContextInputSchema.parse(candidate) as PromptContextInput);
}

export function projectDeveloperPromptContexts(
  rawKnowledgeContext: KnowledgeContext,
  request: DeveloperAgentRequest,
  manifest: DeveloperPromptAssetManifest,
): readonly PromptContextInput[] {
  const knowledgeContext = knowledgeContextSchema.parse(rawKnowledgeContext) as KnowledgeContext;

  if (knowledgeContext.context !== 'DEVELOPER') {
    throw new Error('O contexto carregado não pertence ao Developer Agent.');
  }

  const productOwnerSpecification = request.productOwnerSpecification as unknown as JsonValue;
  const knowledgePromptContext = parsePromptContext({
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
  });
  const productOwnerSpecificationContext = parsePromptContext({
    id: manifest.contexts.productOwnerSpecification,
    kind: 'ARTIFACT',
    serialization: 'JSON',
    content: productOwnerSpecification,
    contentHash: `sha256:${calculateCanonicalJsonHash(productOwnerSpecification)}`,
    references: [],
  });

  return deepFreeze([knowledgePromptContext, productOwnerSpecificationContext]);
}
