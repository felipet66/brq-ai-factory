import type { z } from 'zod';

import type {
  knowledgeCategorySchema,
  knowledgeContextBudgetSchema,
  knowledgeContextKindSchema,
  knowledgeContextSchema,
  knowledgeDocumentMetadataSchema,
  knowledgeDocumentOriginSchema,
  knowledgeIgnoredDocumentSchema,
  knowledgeIgnoredReasonSchema,
  knowledgeIndexSchema,
  knowledgeLoadRequestSchema,
  knowledgeManifestDocumentSchema,
  knowledgeManifestSchema,
  knowledgeMissingDocumentSchema,
  knowledgeSelectionPolicySchema,
  knowledgeSelectionRuleSchema,
  knowledgeSourceEntryKindSchema,
  knowledgeSourceEntrySchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type KnowledgeCategory = DeepReadonly<z.infer<typeof knowledgeCategorySchema>>;
export type KnowledgeContextKind = DeepReadonly<z.infer<typeof knowledgeContextKindSchema>>;
export type KnowledgeManifestDocument = DeepReadonly<
  z.infer<typeof knowledgeManifestDocumentSchema>
>;
export type KnowledgeManifest = DeepReadonly<z.infer<typeof knowledgeManifestSchema>>;
export type KnowledgeSelectionRule = DeepReadonly<z.infer<typeof knowledgeSelectionRuleSchema>>;
export type KnowledgeSelectionPolicy = DeepReadonly<z.infer<typeof knowledgeSelectionPolicySchema>>;
export type KnowledgeSourceEntryKind = DeepReadonly<z.infer<typeof knowledgeSourceEntryKindSchema>>;
export type KnowledgeSourceEntry = DeepReadonly<z.infer<typeof knowledgeSourceEntrySchema>>;
export type KnowledgeDocumentOrigin = DeepReadonly<z.infer<typeof knowledgeDocumentOriginSchema>>;
export type KnowledgeDocumentMetadata = DeepReadonly<
  z.infer<typeof knowledgeDocumentMetadataSchema>
>;
export type KnowledgeIndex = DeepReadonly<z.infer<typeof knowledgeIndexSchema>>;
export type KnowledgeLoadRequest = DeepReadonly<z.infer<typeof knowledgeLoadRequestSchema>>;
export type KnowledgeIgnoredReason = DeepReadonly<z.infer<typeof knowledgeIgnoredReasonSchema>>;
export type KnowledgeIgnoredDocument = DeepReadonly<z.infer<typeof knowledgeIgnoredDocumentSchema>>;
export type KnowledgeMissingDocument = DeepReadonly<z.infer<typeof knowledgeMissingDocumentSchema>>;
export type KnowledgeContextBudget = DeepReadonly<z.infer<typeof knowledgeContextBudgetSchema>>;
export type KnowledgeContext = DeepReadonly<z.infer<typeof knowledgeContextSchema>>;
