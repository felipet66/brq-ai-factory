import { Buffer } from 'node:buffer';

import type { AgentRunResult } from '@brq/agent-runner';
import type { KnowledgeContext } from '@brq/knowledge-loader';
import type { ValidationResult } from '@brq/response-validator';

import type {
  CodeGenerationRequest,
  GeneratedCodeBundle,
  GeneratedCodeFile,
  GeneratedCodeProposal,
} from './contracts';
import {
  calculateBundleContentHash,
  calculateCodeGenerationHash,
  calculateCodeGenerationLineageHash,
  calculateCodeGenerationProvenanceHash,
  calculateGeneratedBundleHash,
  calculateGeneratedContentHash,
  calculateGeneratedFileHash,
  calculateGeneratedManifestHash,
  calculateTechnicalSpecificationHash,
  compareCodeUnits,
  projectGeneratedManifestFile,
} from './hashing';
import { deepFreeze } from './immutability';
import { CODE_GENERATOR_BUNDLE_VERSION, CODE_GENERATOR_CONTRACT_VERSION } from './limits';
import type { CodeGeneratorPromptAssets } from './prompt-assets';
import { generatedCodeBundleSchema } from './schemas';

function createFile(file: GeneratedCodeProposal['files'][number]): GeneratedCodeFile {
  const byteLength = Buffer.byteLength(file.content, 'utf8');
  const contentHash = calculateGeneratedContentHash(file.content);
  const fileHash = calculateGeneratedFileHash(file);
  return {
    ...file,
    byteLength,
    contentHash,
    fileHash,
  };
}

export interface AssembleGeneratedCodeBundleInput {
  readonly request: CodeGenerationRequest;
  readonly proposal: GeneratedCodeProposal;
  readonly assets: CodeGeneratorPromptAssets;
  readonly knowledge: KnowledgeContext;
  readonly run: AgentRunResult;
  readonly responseValidation: ValidationResult;
}

export function assembleGeneratedCodeBundle(
  input: AssembleGeneratedCodeBundleInput,
): GeneratedCodeBundle {
  const files = [...input.proposal.files]
    .sort((left, right) => compareCodeUnits(left.path, right.path))
    .map(createFile);
  const entrypoints = [...input.proposal.entrypoints].sort((left, right) =>
    compareCodeUnits(left, right),
  );
  const totalBytes = files.reduce((total, file) => total + file.byteLength, 0);
  const bundleContentHash = calculateBundleContentHash(files);
  const manifestFiles = files.map(projectGeneratedManifestFile);
  const manifestProjection = {
    bundleVersion: CODE_GENERATOR_BUNDLE_VERSION,
    contractVersion: CODE_GENERATOR_CONTRACT_VERSION,
    fileCount: files.length,
    totalBytes,
    entrypoints,
    files: manifestFiles,
    bundleContentHash,
  };
  const manifestHash = calculateGeneratedManifestHash(manifestProjection);
  const manifest = { ...manifestProjection, manifestHash };
  const technicalSpecificationHash = calculateTechnicalSpecificationHash(
    input.request.technicalSpecification,
  );
  const lineage = {
    technicalSpecificationHash,
    declaredTechnicalSpecificationHash: input.request.declaredTechnicalSpecificationHash,
    qaSpecificationHash: input.request.approval.qaSpecificationHash,
    technicalHandoffVerified: true as const,
    files: files.map((file) => ({
      path: file.path,
      fileHash: file.fileHash,
      sourceModuleIds: file.sourceModuleIds,
      sourcePlanItemIds: file.sourcePlanItemIds,
    })),
  };
  const provenance = {
    agent: 'CODE_GENERATOR' as const,
    agentVersion: input.request.context.agentVersion,
    approval: input.request.approval,
    assetBundleHash: input.assets.hashes.bundleHash,
    knowledgeContextHash: input.knowledge.contextHash,
    promptHash: input.run.prompt.metadata.promptHash,
    responseHash: input.run.output.responseHash,
    validationHash: input.responseValidation.metadata.validationHash,
    provider: input.run.provider.provider,
    model: input.run.provider.responseModel,
  };
  const lineageHash = calculateCodeGenerationLineageHash(lineage);
  const provenanceHash = calculateCodeGenerationProvenanceHash(provenance);
  const bundleHash = calculateGeneratedBundleHash({
    bundleVersion: CODE_GENERATOR_BUNDLE_VERSION,
    contractVersion: CODE_GENERATOR_CONTRACT_VERSION,
    technicalSpecificationHash,
    bundleContentHash,
    manifestHash,
    lineageHash,
    provenanceHash,
  });
  const generationHash = calculateCodeGenerationHash({
    bundleVersion: CODE_GENERATOR_BUNDLE_VERSION,
    contractVersion: CODE_GENERATOR_CONTRACT_VERSION,
    bundleHash,
    bundleContentHash,
    promptHash: input.run.prompt.metadata.promptHash,
    responseHash: input.run.output.responseHash,
    validationHash: input.responseValidation.metadata.validationHash,
    assetBundleHash: input.assets.hashes.bundleHash,
  });

  const result = generatedCodeBundleSchema.parse({
    bundleVersion: CODE_GENERATOR_BUNDLE_VERSION,
    contractVersion: CODE_GENERATOR_CONTRACT_VERSION,
    technicalSpecificationHash,
    bundleContentHash,
    files,
    entrypoints,
    manifest,
    lineage,
    provenance,
    hashes: {
      bundleContentHash,
      manifestHash,
      lineageHash,
      provenanceHash,
      bundleHash,
      generationHash,
    },
  });
  return deepFreeze(result as GeneratedCodeBundle);
}
