import { knowledgeContextSchema, type KnowledgeContext } from '@brq/knowledge-loader';
import {
  calculateCanonicalJsonHash,
  promptContextInputSchema,
  type PromptContextInput,
} from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { ProductOwnerAgentRequest } from './contracts';
import { deepFreeze } from './immutability';
import type { ProductOwnerPromptAssetManifest } from './prompt-assets';

interface ProductOwnerRequestContext {
  readonly demand: ProductOwnerAgentRequest['demand'];
  readonly additionalContext: string | null;
}

function parsePromptContext(candidate: unknown): PromptContextInput {
  return deepFreeze(promptContextInputSchema.parse(candidate) as PromptContextInput);
}

export function projectProductOwnerPromptContexts(
  rawKnowledgeContext: KnowledgeContext,
  request: ProductOwnerAgentRequest,
  manifest: ProductOwnerPromptAssetManifest,
): readonly PromptContextInput[] {
  const knowledgeContext = knowledgeContextSchema.parse(rawKnowledgeContext) as KnowledgeContext;

  if (knowledgeContext.context !== 'PRODUCT_OWNER') {
    throw new Error('O contexto carregado não pertence ao Product Owner Agent.');
  }

  const requestContent: ProductOwnerRequestContext = {
    demand: request.demand,
    additionalContext: request.additionalContext ?? null,
  };
  const requestJson = requestContent as unknown as JsonValue;

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
  const requestPromptContext = parsePromptContext({
    id: manifest.contexts.request,
    kind: 'USER_INPUT',
    serialization: 'JSON',
    content: requestJson,
    contentHash: `sha256:${calculateCanonicalJsonHash(requestJson)}`,
    references: [],
  });

  return deepFreeze([knowledgePromptContext, requestPromptContext]);
}
