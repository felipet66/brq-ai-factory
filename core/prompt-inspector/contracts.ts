import type {
  KnowledgeContext,
  KnowledgeContextKind,
  KnowledgeLoader,
} from '@brq/knowledge-loader';
import type { PromptBuildInput, PromptBuilder } from '@brq/prompt-builder';
import type { ResponseValidator, ValidationContract } from '@brq/response-validator';
import type { Logger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';
import type { z } from 'zod';

import type {
  promptInspectionAgentSchema,
  promptInspectionBuiltPreviewSchema,
  promptInspectionCatalogAgentSchema,
  promptInspectionCatalogSchema,
  promptInspectionExampleSchema,
  promptInspectionInputKindSchema,
  promptInspectionIssueSchema,
  promptInspectionNodeStatusSchema,
  promptInspectionOutputContractSchema,
  promptInspectionPipelineNodeSchema,
  promptInspectionPreviewRequestSchema,
  promptInspectionPreviewResultSchema,
  promptInspectionRejectedPreviewSchema,
  promptInspectionRetentionSchema,
  promptInspectionSectionSchema,
  promptInspectionStageSchema,
  promptInspectionValidateRequestSchema,
  promptInspectionValidationResultSchema,
  promptInspectionVersionsSchema,
  promptValidationStageNameSchema,
  promptValidationStageSchema,
  promptValidationStageStatusSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type PromptInspectionAgent = DeepReadonly<z.infer<typeof promptInspectionAgentSchema>>;
export type PromptInspectionInputKind = DeepReadonly<
  z.infer<typeof promptInspectionInputKindSchema>
>;
export type PromptInspectionRetention = DeepReadonly<
  z.infer<typeof promptInspectionRetentionSchema>
>;
export type PromptInspectionStage = DeepReadonly<z.infer<typeof promptInspectionStageSchema>>;
export type PromptInspectionNodeStatus = DeepReadonly<
  z.infer<typeof promptInspectionNodeStatusSchema>
>;
export type PromptValidationStageName = DeepReadonly<
  z.infer<typeof promptValidationStageNameSchema>
>;
export type PromptValidationStageStatus = DeepReadonly<
  z.infer<typeof promptValidationStageStatusSchema>
>;
export type PromptInspectionVersions = DeepReadonly<z.infer<typeof promptInspectionVersionsSchema>>;
export type PromptInspectionExample = DeepReadonly<z.infer<typeof promptInspectionExampleSchema>>;
export type PromptInspectionPipelineNode = DeepReadonly<
  z.infer<typeof promptInspectionPipelineNodeSchema>
>;
export type PromptInspectionCatalogAgent = DeepReadonly<
  z.infer<typeof promptInspectionCatalogAgentSchema>
>;
export type PromptInspectionCatalog = DeepReadonly<z.infer<typeof promptInspectionCatalogSchema>>;
export type PromptInspectionPreviewRequest = DeepReadonly<
  z.infer<typeof promptInspectionPreviewRequestSchema>
>;
export type PromptInspectionValidateRequest = DeepReadonly<
  z.infer<typeof promptInspectionValidateRequestSchema>
>;
export type PromptInspectionSection = DeepReadonly<z.infer<typeof promptInspectionSectionSchema>>;
export type PromptInspectionOutputContract = DeepReadonly<
  z.infer<typeof promptInspectionOutputContractSchema>
>;
export type PromptInspectionBuiltPreview = DeepReadonly<
  z.infer<typeof promptInspectionBuiltPreviewSchema>
>;
export type PromptInspectionRejectedPreview = DeepReadonly<
  z.infer<typeof promptInspectionRejectedPreviewSchema>
>;
export type PromptInspectionPreviewResult = DeepReadonly<
  z.infer<typeof promptInspectionPreviewResultSchema>
>;
export type PromptInspectionIssue = DeepReadonly<z.infer<typeof promptInspectionIssueSchema>>;
export type PromptValidationStage = DeepReadonly<z.infer<typeof promptValidationStageSchema>>;
export type PromptInspectionValidationResult = DeepReadonly<
  z.infer<typeof promptInspectionValidationResultSchema>
>;

export interface PromptInspectionBusinessIssue {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export interface PromptInspectionBusinessValidationResult {
  readonly valid: boolean;
  readonly issues: readonly PromptInspectionBusinessIssue[];
  readonly issuesTruncated?: boolean;
}

export interface PromptInspectorAgentAdapter {
  readonly agent: PromptInspectionAgent;
  readonly label: string;
  readonly description: string;
  readonly inputKind: PromptInspectionInputKind;
  readonly versions: Omit<PromptInspectionVersions, 'inspectorVersion' | 'contractVersion'>;
  readonly activeBundleHash: string;
  readonly examples: readonly PromptInspectionExample[];
  readonly knowledgeContext: Extract<KnowledgeContextKind, 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA'>;
  readonly validationContract: ValidationContract;
  readonly inputSchema: z.ZodType;
  readonly agentContractSchema: z.ZodType;
  buildPromptInput(input: unknown, knowledgeContext: KnowledgeContext): PromptBuildInput;
  validateBusiness(candidate: JsonValue, input: unknown): PromptInspectionBusinessValidationResult;
}

export interface CreatePromptInspectorOptions {
  readonly knowledgeLoader: KnowledgeLoader;
  readonly promptBuilder: PromptBuilder;
  readonly responseValidator: ResponseValidator;
  readonly adapters: readonly PromptInspectorAgentAdapter[];
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface PromptInspectionOperationOptions {
  readonly signal?: AbortSignal;
}

export interface PromptInspector {
  catalog(): PromptInspectionCatalog;
  preview(
    request: PromptInspectionPreviewRequest,
    options?: PromptInspectionOperationOptions,
  ): Promise<PromptInspectionPreviewResult>;
  validate(
    request: PromptInspectionValidateRequest,
    options?: PromptInspectionOperationOptions,
  ): Promise<PromptInspectionValidationResult>;
}
