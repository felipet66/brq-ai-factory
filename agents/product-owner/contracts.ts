import type { AgentRunner } from '@brq/agent-runner';
import type { ArtifactGenerator } from '@brq/artifact-generator';
import type { KnowledgeLoader } from '@brq/knowledge-loader';
import type { ResponseValidator } from '@brq/response-validator';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type { ProductOwnerPromptAssets } from './prompt-assets';
import type {
  productOwnerAcceptanceCriterionSchema,
  productOwnerAgentContextSchema,
  productOwnerAgentLimitsSchema,
  productOwnerAgentOutcomeSchema,
  productOwnerAgentRequestSchema,
  productOwnerAgentResultSchema,
  productOwnerAssetsMetadataSchema,
  productOwnerAssumptionSchema,
  productOwnerBacklogItemSchema,
  productOwnerBusinessRuleSchema,
  productOwnerBusinessValidationIssueSchema,
  productOwnerBusinessValidationResultSchema,
  productOwnerDefinitionOfReadyItemSchema,
  productOwnerDemandSchema,
  productOwnerDependencySchema,
  productOwnerKnowledgeMetadataSchema,
  productOwnerOpenQuestionSchema,
  productOwnerOutOfScopeItemSchema,
  productOwnerReadinessSchema,
  productOwnerResponseValidationSummarySchema,
  productOwnerRiskSchema,
  productOwnerRunMetadataSchema,
  productOwnerScenarioSchema,
  productOwnerSpecificationSchema,
  productOwnerUserStorySchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ProductOwnerReadiness = DeepReadonly<z.infer<typeof productOwnerReadinessSchema>>;
export type ProductOwnerAgentOutcome = DeepReadonly<z.infer<typeof productOwnerAgentOutcomeSchema>>;
export type ProductOwnerAgentContext = DeepReadonly<z.infer<typeof productOwnerAgentContextSchema>>;
export type ProductOwnerDemand = DeepReadonly<z.infer<typeof productOwnerDemandSchema>>;
export type ProductOwnerAgentLimits = DeepReadonly<z.infer<typeof productOwnerAgentLimitsSchema>>;
export type ProductOwnerAgentRequest = DeepReadonly<z.infer<typeof productOwnerAgentRequestSchema>>;
export type ProductOwnerUserStory = DeepReadonly<z.infer<typeof productOwnerUserStorySchema>>;
export type ProductOwnerAcceptanceCriterion = DeepReadonly<
  z.infer<typeof productOwnerAcceptanceCriterionSchema>
>;
export type ProductOwnerBusinessRule = DeepReadonly<z.infer<typeof productOwnerBusinessRuleSchema>>;
export type ProductOwnerScenario = DeepReadonly<z.infer<typeof productOwnerScenarioSchema>>;
export type ProductOwnerAssumption = DeepReadonly<z.infer<typeof productOwnerAssumptionSchema>>;
export type ProductOwnerDependency = DeepReadonly<z.infer<typeof productOwnerDependencySchema>>;
export type ProductOwnerRisk = DeepReadonly<z.infer<typeof productOwnerRiskSchema>>;
export type ProductOwnerOpenQuestion = DeepReadonly<z.infer<typeof productOwnerOpenQuestionSchema>>;
export type ProductOwnerOutOfScopeItem = DeepReadonly<
  z.infer<typeof productOwnerOutOfScopeItemSchema>
>;
export type ProductOwnerDefinitionOfReadyItem = DeepReadonly<
  z.infer<typeof productOwnerDefinitionOfReadyItemSchema>
>;
export type ProductOwnerBacklogItem = DeepReadonly<z.infer<typeof productOwnerBacklogItemSchema>>;
export type ProductOwnerSpecification = DeepReadonly<
  z.infer<typeof productOwnerSpecificationSchema>
>;
export type ProductOwnerBusinessValidationIssue = DeepReadonly<
  z.infer<typeof productOwnerBusinessValidationIssueSchema>
>;
export type ProductOwnerBusinessValidationResult = DeepReadonly<
  z.infer<typeof productOwnerBusinessValidationResultSchema>
>;
export type ProductOwnerAssetsMetadata = DeepReadonly<
  z.infer<typeof productOwnerAssetsMetadataSchema>
>;
export type ProductOwnerKnowledgeMetadata = DeepReadonly<
  z.infer<typeof productOwnerKnowledgeMetadataSchema>
>;
export type ProductOwnerRunMetadata = DeepReadonly<z.infer<typeof productOwnerRunMetadataSchema>>;
export type ProductOwnerResponseValidationSummary = DeepReadonly<
  z.infer<typeof productOwnerResponseValidationSummarySchema>
>;
export type ProductOwnerAgentResult = DeepReadonly<z.infer<typeof productOwnerAgentResultSchema>>;

export interface ProductOwnerAgentRunOptions {
  readonly signal?: AbortSignal;
  readonly cacheMode?: 'READ_WRITE' | 'REQUIRE_HIT';
  readonly sourceExecutionId?: string;
}

export interface CreateProductOwnerAgentOptions {
  readonly knowledgeLoader: KnowledgeLoader;
  readonly agentRunner: AgentRunner;
  readonly responseValidator: ResponseValidator;
  readonly artifactGenerator: ArtifactGenerator;
  readonly promptAssets: ProductOwnerPromptAssets;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface ProductOwnerAgent {
  execute(
    request: ProductOwnerAgentRequest,
    options?: ProductOwnerAgentRunOptions,
  ): Promise<ProductOwnerAgentResult>;
}
