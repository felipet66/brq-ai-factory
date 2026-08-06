import type { AgentRunResult } from '@brq/agent-runner';
import type { ArtifactGenerationResult } from '@brq/artifact-generator';
import type { KnowledgeContext } from '@brq/knowledge-loader';
import type { ValidationResult } from '@brq/response-validator';

import type {
  QAAgentRequest,
  QAAgentResult,
  QABusinessValidationResult,
  QASpecification,
} from './contracts';
import { deepFreeze } from './immutability';
import { productOwnerSpecificationHash, technicalSpecificationHash } from './logging';
import type { QAPromptAssets } from './prompt-assets';
import { qaAgentResultSchema } from './schemas';

interface QAResultContext {
  readonly request: QAAgentRequest;
  readonly assets: QAPromptAssets;
  readonly knowledge: KnowledgeContext;
  readonly run: AgentRunResult;
  readonly responseValidation: ValidationResult;
}

function projectAssets(assets: QAPromptAssets) {
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
    artifactSpecification: {
      id: assets.artifactSpecification.id,
      version: assets.artifactSpecification.version,
      hash: assets.hashes.artifactSpecificationHash,
    },
  };
}

function projectKnowledge(knowledge: KnowledgeContext) {
  return {
    context: 'QA' as const,
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
  return { valid: validation.valid, issues: validation.issues, metadata: validation.metadata };
}

function commonMetadata(context: QAResultContext) {
  return {
    assets: projectAssets(context.assets),
    knowledge: projectKnowledge(context.knowledge),
    run: projectRun(context.run),
    productOwnerSpecificationHash: productOwnerSpecificationHash(context.request),
    technicalSpecificationHash: technicalSpecificationHash(context.request),
    productOwnerReadiness: context.request.productOwnerSpecification.readiness,
    technicalReadiness: context.request.technicalSpecification.readiness,
  };
}

function parseResult(candidate: unknown): QAAgentResult {
  return deepFreeze(qaAgentResultSchema.parse(candidate) as QAAgentResult);
}

export function createResponseRejectedResult(context: QAResultContext): QAAgentResult {
  return parseResult({
    outcome: 'VALIDATION_REJECTED',
    rejectedAt: 'RESPONSE_VALIDATION',
    context: context.request.context,
    readiness: null,
    specification: null,
    artifacts: [],
    validation: { response: projectResponseValidation(context.responseValidation), business: null },
    metadata: { ...commonMetadata(context), generation: null },
  });
}

export function createBusinessRejectedResult(
  context: QAResultContext,
  businessValidation: QABusinessValidationResult,
): QAAgentResult {
  return parseResult({
    outcome: 'VALIDATION_REJECTED',
    rejectedAt: 'BUSINESS_VALIDATION',
    context: context.request.context,
    readiness: null,
    specification: null,
    artifacts: [],
    validation: {
      response: projectResponseValidation(context.responseValidation),
      business: businessValidation,
    },
    metadata: { ...commonMetadata(context), generation: null },
  });
}

export function createGeneratedResult(
  context: QAResultContext,
  specification: QASpecification,
  businessValidation: QABusinessValidationResult,
  generation: ArtifactGenerationResult,
): QAAgentResult {
  return parseResult({
    outcome: 'GENERATED',
    context: context.request.context,
    readiness: specification.readiness,
    specification,
    artifacts: generation.artifacts,
    validation: {
      response: projectResponseValidation(context.responseValidation),
      business: businessValidation,
    },
    metadata: { ...commonMetadata(context), generation: generation.metadata },
  });
}
