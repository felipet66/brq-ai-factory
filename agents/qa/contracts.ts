import type { AgentRunner } from '@brq/agent-runner';
import type { ArtifactGenerator } from '@brq/artifact-generator';
import type { KnowledgeLoader } from '@brq/knowledge-loader';
import type { PromptBuilder } from '@brq/prompt-builder';
import type { ResponseValidator } from '@brq/response-validator';
import type { Logger } from '@brq/shared/logger/logger';
import type { TechnicalSpecification } from '@brq/developer-agent';
import type { ProductOwnerSpecification } from '@brq/product-owner-agent';
import type { z } from 'zod';

import type { QAPromptAssets } from './prompt-assets';
import type {
  qaAgentContextSchema,
  qaAgentLimitsSchema,
  qaAgentOutcomeSchema,
  qaAgentRequestSchema,
  qaAgentResultSchema,
  qaApprovalCriterionSchema,
  qaAssetsMetadataSchema,
  qaAssumptionSchema,
  qaAutomationRecommendationSchema,
  qaBlockingItemSchema,
  qaBusinessValidationIssueSchema,
  qaBusinessValidationResultSchema,
  qaCoverageSummarySchema,
  qaEdgeCaseSchema,
  qaFunctionalCoverageItemSchema,
  qaKnowledgeMetadataSchema,
  qaNegativeScenarioSchema,
  qaOpenQuestionSchema,
  qaOutOfScopeItemSchema,
  qaPositiveScenarioSchema,
  qaPriorityTestSchema,
  qaReadinessSchema,
  qaResponseValidationSummarySchema,
  qaRiskSchema,
  qaRunMetadataSchema,
  qaSpecificationSchema,
  qaTechnicalCoverageItemSchema,
  qaTestStrategySchema,
  qaTraceabilityRowSchema,
  qaTraceabilitySchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type QAReadiness = DeepReadonly<z.infer<typeof qaReadinessSchema>>;
export type QAAgentOutcome = DeepReadonly<z.infer<typeof qaAgentOutcomeSchema>>;
export type QAAgentContext = DeepReadonly<z.infer<typeof qaAgentContextSchema>>;
export type QAAgentLimits = DeepReadonly<z.infer<typeof qaAgentLimitsSchema>>;
export type QAAgentRequest = DeepReadonly<z.infer<typeof qaAgentRequestSchema>>;
export type QATestStrategy = DeepReadonly<z.infer<typeof qaTestStrategySchema>>;
export type QAPositiveScenario = DeepReadonly<z.infer<typeof qaPositiveScenarioSchema>>;
export type QANegativeScenario = DeepReadonly<z.infer<typeof qaNegativeScenarioSchema>>;
export type QAEdgeCase = DeepReadonly<z.infer<typeof qaEdgeCaseSchema>>;
export type QACoverageSummary = DeepReadonly<z.infer<typeof qaCoverageSummarySchema>>;
export type QAFunctionalCoverageItem = DeepReadonly<z.infer<typeof qaFunctionalCoverageItemSchema>>;
export type QATechnicalCoverageItem = DeepReadonly<z.infer<typeof qaTechnicalCoverageItemSchema>>;
export type QATraceabilityRow = DeepReadonly<z.infer<typeof qaTraceabilityRowSchema>>;
export type QATraceability = DeepReadonly<z.infer<typeof qaTraceabilitySchema>>;
export type QARisk = DeepReadonly<z.infer<typeof qaRiskSchema>>;
export type QAApprovalCriterion = DeepReadonly<z.infer<typeof qaApprovalCriterionSchema>>;
export type QABlockingItem = DeepReadonly<z.infer<typeof qaBlockingItemSchema>>;
export type QAPriorityTest = DeepReadonly<z.infer<typeof qaPriorityTestSchema>>;
export type QAAutomationRecommendation = DeepReadonly<
  z.infer<typeof qaAutomationRecommendationSchema>
>;
export type QAAssumption = DeepReadonly<z.infer<typeof qaAssumptionSchema>>;
export type QAOpenQuestion = DeepReadonly<z.infer<typeof qaOpenQuestionSchema>>;
export type QAOutOfScopeItem = DeepReadonly<z.infer<typeof qaOutOfScopeItemSchema>>;
export type QASpecification = DeepReadonly<z.infer<typeof qaSpecificationSchema>>;
export type QABusinessValidationIssue = DeepReadonly<
  z.infer<typeof qaBusinessValidationIssueSchema>
>;
export type QABusinessValidationResult = DeepReadonly<
  z.infer<typeof qaBusinessValidationResultSchema>
>;
export type QAAssetsMetadata = DeepReadonly<z.infer<typeof qaAssetsMetadataSchema>>;
export type QAKnowledgeMetadata = DeepReadonly<z.infer<typeof qaKnowledgeMetadataSchema>>;
export type QARunMetadata = DeepReadonly<z.infer<typeof qaRunMetadataSchema>>;
export type QAResponseValidationSummary = DeepReadonly<
  z.infer<typeof qaResponseValidationSummarySchema>
>;
export type QAAgentResult = DeepReadonly<z.infer<typeof qaAgentResultSchema>>;

export interface QAAgentRunOptions {
  readonly signal?: AbortSignal;
  readonly cacheMode?: 'READ_WRITE' | 'REQUIRE_HIT';
  readonly sourceExecutionId?: string;
}

export interface CreateQAAgentOptions {
  readonly knowledgeLoader: KnowledgeLoader;
  readonly agentRunner: AgentRunner;
  readonly responseValidator: ResponseValidator;
  readonly artifactGenerator: ArtifactGenerator;
  readonly promptAssets: QAPromptAssets;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface CanonicalQACompilationInput {
  readonly productOwnerSpecification: ProductOwnerSpecification;
  readonly technicalSpecification: TechnicalSpecification;
}

export interface CreateDeterministicQAAgentRunnerOptions {
  readonly promptBuilder: PromptBuilder;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface CreateDeterministicQAAgentOptions extends Omit<
  CreateQAAgentOptions,
  'agentRunner'
> {
  readonly promptBuilder: PromptBuilder;
}

export interface QAAgent {
  execute(request: QAAgentRequest, options?: QAAgentRunOptions): Promise<QAAgentResult>;
}
