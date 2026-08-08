import type { AgentRunResult } from '@brq/agent-runner';
import type { KnowledgeContext } from '@brq/knowledge-loader';
import type { ValidationResult } from '@brq/response-validator';

import type {
  CodeGenerationRequest,
  CodeGeneratorAgentResult,
  CodeGeneratorBusinessValidationResult,
  GeneratedCodeBundle,
} from './contracts';
import { calculateTechnicalSpecificationHash } from './hashing';
import { deepFreeze } from './immutability';
import type { CodeGeneratorPromptAssets } from './prompt-assets';
import { codeGeneratorAgentResultSchema } from './schemas';

export interface CodeGeneratorResultContext {
  readonly request: CodeGenerationRequest;
  readonly assets: CodeGeneratorPromptAssets;
  readonly knowledge: KnowledgeContext;
  readonly run: AgentRunResult;
  readonly responseValidation: ValidationResult;
}

function projectAssets(assets: CodeGeneratorPromptAssets) {
  return {
    bundleHash: assets.hashes.bundleHash,
    manifest: {
      id: assets.manifest.id,
      version: assets.manifest.version,
      hash: assets.hashes.manifestHash,
    },
    template: {
      id: assets.template.id,
      version: assets.template.version,
      hash: assets.hashes.templateHash,
    },
    ruleSets: assets.ruleSets.map((ruleSet, index) => ({
      id: ruleSet.id,
      version: ruleSet.version,
      hash: assets.hashes.ruleSetHashes[index]!.hash,
    })),
    outputContract: {
      id: assets.outputContract.id,
      version: assets.outputContract.version,
      hash: assets.hashes.outputContractHash,
    },
    validationContract: {
      id: assets.validationContract.id,
      version: assets.validationContract.version,
      hash: assets.hashes.validationContractHash,
    },
  };
}

function projectKnowledge(knowledge: KnowledgeContext) {
  return {
    context: 'CODE_GENERATOR' as const,
    sourceId: knowledge.sourceId,
    manifestVersion: knowledge.manifestVersion,
    policyVersion: knowledge.policyVersion,
    contextHash: knowledge.contextHash,
    documents: knowledge.includedDocuments.map((document) => ({
      id: document.id,
      category: document.category,
      hash: document.hash,
    })),
    budget: knowledge.budget,
  };
}

function projectRun(run: AgentRunResult) {
  return {
    prompt: run.prompt,
    provider: run.provider,
    metrics: run.metrics,
    responseHash: run.output.responseHash,
    finishReason: run.output.finishReason,
  };
}

function projectResponseValidation(validation: ValidationResult) {
  return {
    valid: validation.valid,
    issues: validation.issues,
    metadata: validation.metadata,
  };
}

function commonMetadata(context: CodeGeneratorResultContext) {
  return {
    assets: projectAssets(context.assets),
    knowledge: projectKnowledge(context.knowledge),
    run: projectRun(context.run),
    technicalSpecificationHash: calculateTechnicalSpecificationHash(
      context.request.technicalSpecification,
    ),
    declaredTechnicalSpecificationHash: context.request.declaredTechnicalSpecificationHash,
    approval: context.request.approval,
  };
}

function parseResult(candidate: unknown): CodeGeneratorAgentResult {
  return deepFreeze(codeGeneratorAgentResultSchema.parse(candidate) as CodeGeneratorAgentResult);
}

export function createResponseRejectedResult(
  context: CodeGeneratorResultContext,
): CodeGeneratorAgentResult {
  return parseResult({
    outcome: 'VALIDATION_REJECTED',
    rejectedAt: 'RESPONSE_VALIDATION',
    context: context.request.context,
    bundle: null,
    validation: {
      response: projectResponseValidation(context.responseValidation),
      business: null,
    },
    metadata: { ...commonMetadata(context), generation: null },
  });
}

export function createBusinessRejectedResult(
  context: CodeGeneratorResultContext,
  businessValidation: CodeGeneratorBusinessValidationResult,
): CodeGeneratorAgentResult {
  return parseResult({
    outcome: 'VALIDATION_REJECTED',
    rejectedAt: 'BUSINESS_VALIDATION',
    context: context.request.context,
    bundle: null,
    validation: {
      response: projectResponseValidation(context.responseValidation),
      business: businessValidation,
    },
    metadata: { ...commonMetadata(context), generation: null },
  });
}

export function createGeneratedResult(
  context: CodeGeneratorResultContext,
  businessValidation: CodeGeneratorBusinessValidationResult,
  bundle: GeneratedCodeBundle,
): CodeGeneratorAgentResult {
  return parseResult({
    outcome: 'GENERATED',
    context: context.request.context,
    bundle,
    validation: {
      response: projectResponseValidation(context.responseValidation),
      business: businessValidation,
    },
    metadata: {
      ...commonMetadata(context),
      generation: {
        bundleVersion: bundle.bundleVersion,
        contractVersion: bundle.contractVersion,
        fileCount: bundle.manifest.fileCount,
        totalBytes: bundle.manifest.totalBytes,
        bundleContentHash: bundle.bundleContentHash,
        manifestHash: bundle.hashes.manifestHash,
        lineageHash: bundle.hashes.lineageHash,
        provenanceHash: bundle.hashes.provenanceHash,
        bundleHash: bundle.hashes.bundleHash,
        generationHash: bundle.hashes.generationHash,
      },
    },
  });
}
