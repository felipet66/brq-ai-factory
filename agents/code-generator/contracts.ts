import type { AgentRunner } from '@brq/agent-runner';
import type { TechnicalSpecification } from '@brq/developer-agent';
import type { KnowledgeLoader } from '@brq/knowledge-loader';
import type { ResponseValidator } from '@brq/response-validator';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type { CodeGeneratorPromptAssets } from './prompt-assets';
import type {
  codeGenerationApprovalSchema,
  codeGenerationConstraintSchema,
  codeGenerationLineageSchema,
  codeGenerationMetadataSchema,
  codeGenerationProvenanceSchema,
  codeGenerationRequestSchema,
  codeGeneratorAgentContextSchema,
  codeGeneratorAgentLimitsSchema,
  codeGeneratorAgentOutcomeSchema,
  codeGeneratorAgentResultSchema,
  codeGeneratorAssetsMetadataSchema,
  codeGeneratorBusinessValidationIssueSchema,
  codeGeneratorBusinessValidationResultSchema,
  codeGeneratorKnowledgeMetadataSchema,
  codeGeneratorResponseValidationSummarySchema,
  codeGeneratorRunMetadataSchema,
  generatedCodeBundleHashesSchema,
  generatedCodeBundleSchema,
  generatedCodeEncodingSchema,
  generatedCodeFilePurposeSchema,
  generatedCodeFileSchema,
  generatedCodeManifestFileSchema,
  generatedCodeManifestSchema,
  generatedCodeMediaTypeSchema,
  generatedCodeProposalSchema,
  rawGeneratedCodeFileSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type CodeGeneratorAgentOutcome = DeepReadonly<
  z.infer<typeof codeGeneratorAgentOutcomeSchema>
>;
export type CodeGeneratorAgentContext = DeepReadonly<
  z.infer<typeof codeGeneratorAgentContextSchema>
>;
export type CodeGeneratorAgentLimits = DeepReadonly<z.infer<typeof codeGeneratorAgentLimitsSchema>>;
export type CodeGenerationApproval = DeepReadonly<z.infer<typeof codeGenerationApprovalSchema>>;
export type CodeGenerationConstraint = DeepReadonly<z.infer<typeof codeGenerationConstraintSchema>>;
export type CodeGenerationRequest = DeepReadonly<z.infer<typeof codeGenerationRequestSchema>>;
export type GeneratedCodeEncoding = DeepReadonly<z.infer<typeof generatedCodeEncodingSchema>>;
export type GeneratedCodeMediaType = DeepReadonly<z.infer<typeof generatedCodeMediaTypeSchema>>;
export type GeneratedCodeFilePurpose = DeepReadonly<z.infer<typeof generatedCodeFilePurposeSchema>>;
export type RawGeneratedCodeFile = DeepReadonly<z.infer<typeof rawGeneratedCodeFileSchema>>;
export type GeneratedCodeProposal = DeepReadonly<z.infer<typeof generatedCodeProposalSchema>>;
export type CodeGeneratorBusinessValidationIssue = DeepReadonly<
  z.infer<typeof codeGeneratorBusinessValidationIssueSchema>
>;
export type CodeGeneratorBusinessValidationResult = DeepReadonly<
  z.infer<typeof codeGeneratorBusinessValidationResultSchema>
>;
export type GeneratedCodeFile = DeepReadonly<z.infer<typeof generatedCodeFileSchema>>;
export type GeneratedCodeManifestFile = DeepReadonly<
  z.infer<typeof generatedCodeManifestFileSchema>
>;
export type GeneratedCodeManifest = DeepReadonly<z.infer<typeof generatedCodeManifestSchema>>;
export type CodeGenerationLineage = DeepReadonly<z.infer<typeof codeGenerationLineageSchema>>;
export type CodeGenerationProvenance = DeepReadonly<z.infer<typeof codeGenerationProvenanceSchema>>;
export type GeneratedCodeBundleHashes = DeepReadonly<
  z.infer<typeof generatedCodeBundleHashesSchema>
>;
export type GeneratedCodeBundle = DeepReadonly<z.infer<typeof generatedCodeBundleSchema>>;
export type CodeGeneratorAssetsMetadata = DeepReadonly<
  z.infer<typeof codeGeneratorAssetsMetadataSchema>
>;
export type CodeGeneratorKnowledgeMetadata = DeepReadonly<
  z.infer<typeof codeGeneratorKnowledgeMetadataSchema>
>;
export type CodeGeneratorRunMetadata = DeepReadonly<z.infer<typeof codeGeneratorRunMetadataSchema>>;
export type CodeGeneratorResponseValidationSummary = DeepReadonly<
  z.infer<typeof codeGeneratorResponseValidationSummarySchema>
>;
export type CodeGenerationMetadata = DeepReadonly<z.infer<typeof codeGenerationMetadataSchema>>;
export type CodeGeneratorAgentResult = DeepReadonly<z.infer<typeof codeGeneratorAgentResultSchema>>;

export type { TechnicalSpecification };

export interface CodeGeneratorAgentRunOptions {
  readonly signal?: AbortSignal;
  readonly cacheMode?: 'READ_WRITE' | 'REQUIRE_HIT';
  readonly sourceExecutionId?: string;
}

export interface CreateCodeGeneratorAgentOptions {
  readonly knowledgeLoader: KnowledgeLoader;
  readonly agentRunner: AgentRunner;
  readonly responseValidator: ResponseValidator;
  readonly promptAssets: CodeGeneratorPromptAssets;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface CodeGeneratorAgent {
  execute(
    request: CodeGenerationRequest,
    options?: CodeGeneratorAgentRunOptions,
  ): Promise<CodeGeneratorAgentResult>;
}
