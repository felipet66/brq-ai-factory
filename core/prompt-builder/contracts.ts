import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  promptBlockKindSchema,
  promptBuilderConfigurationSchema,
  promptBuildInputSchema,
  promptBuildOptionsSchema,
  promptChannelSchema,
  promptConstraintSchema,
  promptContextInputSchema,
  promptContextProvenanceSchema,
  promptContextReferenceSchema,
  promptOutputContractSchema,
  promptRenderedOutputSchema,
  promptResultSchema,
  promptRuleSchema,
  promptRuleSetProvenanceSchema,
  promptRuleSetSchema,
  promptSectionKindSchema,
  promptSerializationSchema,
  promptTemplateBlockSchema,
  promptTemplateFragmentSchema,
  promptTemplateSchema,
  promptTemplateSectionSchema,
  promptTrustSchema,
  promptVariableSchema,
  resolvedPromptBlockSchema,
  resolvedPromptDocumentSchema,
  resolvedPromptFragmentSchema,
  resolvedPromptSectionSchema,
} from './schemas';

export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type PromptChannel = DeepReadonly<z.infer<typeof promptChannelSchema>>;
export type PromptTrust = DeepReadonly<z.infer<typeof promptTrustSchema>>;
export type PromptSerialization = DeepReadonly<z.infer<typeof promptSerializationSchema>>;
export type PromptSectionKind = DeepReadonly<z.infer<typeof promptSectionKindSchema>>;
export type PromptBlockKind = DeepReadonly<z.infer<typeof promptBlockKindSchema>>;
export type PromptTemplateFragment = DeepReadonly<z.infer<typeof promptTemplateFragmentSchema>>;
export type PromptTemplateBlock = DeepReadonly<z.infer<typeof promptTemplateBlockSchema>>;
export type PromptTemplateSection = DeepReadonly<z.infer<typeof promptTemplateSectionSchema>>;
export type PromptTemplate = DeepReadonly<z.infer<typeof promptTemplateSchema>>;
export type PromptRule = DeepReadonly<z.infer<typeof promptRuleSchema>>;
export type PromptRuleSet = DeepReadonly<z.infer<typeof promptRuleSetSchema>>;
export type PromptRuleSetProvenance = DeepReadonly<z.infer<typeof promptRuleSetProvenanceSchema>>;
export type PromptVariable = DeepReadonly<z.infer<typeof promptVariableSchema>>;
export type PromptContextReference = DeepReadonly<z.infer<typeof promptContextReferenceSchema>>;
export type PromptContextInput = DeepReadonly<z.infer<typeof promptContextInputSchema>>;
export type PromptContextProvenance = DeepReadonly<z.infer<typeof promptContextProvenanceSchema>>;
export type PromptConstraint = DeepReadonly<z.infer<typeof promptConstraintSchema>>;
export type PromptOutputContract = DeepReadonly<z.infer<typeof promptOutputContractSchema>>;
export type PromptBuildInput = DeepReadonly<z.infer<typeof promptBuildInputSchema>>;
export type PromptBuildOptions = DeepReadonly<z.infer<typeof promptBuildOptionsSchema>>;
export type PromptBuilderConfiguration = DeepReadonly<
  z.infer<typeof promptBuilderConfigurationSchema>
>;
export type ResolvedPromptFragment = DeepReadonly<z.infer<typeof resolvedPromptFragmentSchema>>;
export type ResolvedPromptBlock = DeepReadonly<z.infer<typeof resolvedPromptBlockSchema>>;
export type ResolvedPromptSection = DeepReadonly<z.infer<typeof resolvedPromptSectionSchema>>;
export type ResolvedPromptDocument = DeepReadonly<z.infer<typeof resolvedPromptDocumentSchema>>;
export type PromptRenderedOutput = DeepReadonly<z.infer<typeof promptRenderedOutputSchema>>;
export type PromptResult = DeepReadonly<z.infer<typeof promptResultSchema>>;

export interface CreatePromptBuilderOptions {
  readonly configuration?: Partial<PromptBuilderConfiguration>;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface PromptBuilder {
  build(input: PromptBuildInput, options?: PromptBuildOptions): PromptResult;
}
