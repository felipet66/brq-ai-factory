import type { AgentRunner } from '@brq/agent-runner';
import type { ArtifactGenerator } from '@brq/artifact-generator';
import type { KnowledgeLoader } from '@brq/knowledge-loader';
import type { ResponseValidator } from '@brq/response-validator';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type { DeveloperPromptAssets } from './prompt-assets';
import type {
  developerAgentContextSchema,
  developerAgentLimitsSchema,
  developerAgentOutcomeSchema,
  developerAgentRequestSchema,
  developerAgentResultSchema,
  developerApiSchema,
  developerArchitectureSchema,
  developerAssetsMetadataSchema,
  developerAssumptionSchema,
  developerBusinessValidationIssueSchema,
  developerBusinessValidationResultSchema,
  developerComponentSchema,
  developerContractSchema,
  developerDataModelSchema,
  developerDecisionSchema,
  developerDecisionTradeOffSchema,
  developerDefinitionOfDoneItemSchema,
  developerEntityFieldSchema,
  developerEntityRelationSchema,
  developerEntitySchema,
  developerEventSchema,
  developerExternalDependencySchema,
  developerFlowSchema,
  developerFlowStepSchema,
  developerImplementationPhaseSchema,
  developerImplementationPlanItemSchema,
  developerInternalDependencySchema,
  developerKnowledgeMetadataSchema,
  developerModuleSchema,
  developerOpenQuestionSchema,
  developerOutOfScopeItemSchema,
  developerReadinessSchema,
  developerResponseValidationSummarySchema,
  developerRiskSchema,
  developerRunMetadataSchema,
  developerTechnicalBacklogItemSchema,
  developerTraceabilityItemSchema,
  technicalSpecificationSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type DeveloperReadiness = DeepReadonly<z.infer<typeof developerReadinessSchema>>;
export type DeveloperAgentOutcome = DeepReadonly<z.infer<typeof developerAgentOutcomeSchema>>;
export type DeveloperAgentContext = DeepReadonly<z.infer<typeof developerAgentContextSchema>>;
export type DeveloperAgentLimits = DeepReadonly<z.infer<typeof developerAgentLimitsSchema>>;
export type DeveloperAgentRequest = DeepReadonly<z.infer<typeof developerAgentRequestSchema>>;
export type DeveloperArchitecture = DeepReadonly<z.infer<typeof developerArchitectureSchema>>;
export type DeveloperComponent = DeepReadonly<z.infer<typeof developerComponentSchema>>;
export type DeveloperModule = DeepReadonly<z.infer<typeof developerModuleSchema>>;
export type DeveloperFlowStep = DeepReadonly<z.infer<typeof developerFlowStepSchema>>;
export type DeveloperFlow = DeepReadonly<z.infer<typeof developerFlowSchema>>;
export type DeveloperContract = DeepReadonly<z.infer<typeof developerContractSchema>>;
export type DeveloperApi = DeepReadonly<z.infer<typeof developerApiSchema>>;
export type DeveloperEvent = DeepReadonly<z.infer<typeof developerEventSchema>>;
export type DeveloperEntityField = DeepReadonly<z.infer<typeof developerEntityFieldSchema>>;
export type DeveloperEntity = DeepReadonly<z.infer<typeof developerEntitySchema>>;
export type DeveloperEntityRelation = DeepReadonly<z.infer<typeof developerEntityRelationSchema>>;
export type DeveloperDataModel = DeepReadonly<z.infer<typeof developerDataModelSchema>>;
export type DeveloperInternalDependency = DeepReadonly<
  z.infer<typeof developerInternalDependencySchema>
>;
export type DeveloperExternalDependency = DeepReadonly<
  z.infer<typeof developerExternalDependencySchema>
>;
export type DeveloperRisk = DeepReadonly<z.infer<typeof developerRiskSchema>>;
export type DeveloperImplementationPhase = DeepReadonly<
  z.infer<typeof developerImplementationPhaseSchema>
>;
export type DeveloperImplementationPlanItem = DeepReadonly<
  z.infer<typeof developerImplementationPlanItemSchema>
>;
export type DeveloperTechnicalBacklogItem = DeepReadonly<
  z.infer<typeof developerTechnicalBacklogItemSchema>
>;
export type DeveloperDefinitionOfDoneItem = DeepReadonly<
  z.infer<typeof developerDefinitionOfDoneItemSchema>
>;
export type DeveloperDecisionTradeOff = DeepReadonly<
  z.infer<typeof developerDecisionTradeOffSchema>
>;
export type DeveloperDecision = DeepReadonly<z.infer<typeof developerDecisionSchema>>;
export type DeveloperTraceabilityItem = DeepReadonly<
  z.infer<typeof developerTraceabilityItemSchema>
>;
export type DeveloperAssumption = DeepReadonly<z.infer<typeof developerAssumptionSchema>>;
export type DeveloperOpenQuestion = DeepReadonly<z.infer<typeof developerOpenQuestionSchema>>;
export type DeveloperOutOfScopeItem = DeepReadonly<z.infer<typeof developerOutOfScopeItemSchema>>;
export type TechnicalSpecification = DeepReadonly<z.infer<typeof technicalSpecificationSchema>>;
export type DeveloperBusinessValidationIssue = DeepReadonly<
  z.infer<typeof developerBusinessValidationIssueSchema>
>;
export type DeveloperBusinessValidationResult = DeepReadonly<
  z.infer<typeof developerBusinessValidationResultSchema>
>;
export type DeveloperAssetsMetadata = DeepReadonly<z.infer<typeof developerAssetsMetadataSchema>>;
export type DeveloperKnowledgeMetadata = DeepReadonly<
  z.infer<typeof developerKnowledgeMetadataSchema>
>;
export type DeveloperRunMetadata = DeepReadonly<z.infer<typeof developerRunMetadataSchema>>;
export type DeveloperResponseValidationSummary = DeepReadonly<
  z.infer<typeof developerResponseValidationSummarySchema>
>;
export type DeveloperAgentResult = DeepReadonly<z.infer<typeof developerAgentResultSchema>>;

export interface DeveloperAgentRunOptions {
  readonly signal?: AbortSignal;
  readonly cacheMode?: 'READ_WRITE' | 'REQUIRE_HIT';
  readonly sourceExecutionId?: string;
}

export interface CreateDeveloperAgentOptions {
  readonly knowledgeLoader: KnowledgeLoader;
  readonly agentRunner: AgentRunner;
  readonly responseValidator: ResponseValidator;
  readonly artifactGenerator: ArtifactGenerator;
  readonly promptAssets: DeveloperPromptAssets;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface DeveloperAgent {
  execute(
    request: DeveloperAgentRequest,
    options?: DeveloperAgentRunOptions,
  ): Promise<DeveloperAgentResult>;
}
