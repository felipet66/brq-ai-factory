import type { AgentRunResult } from '@brq/agent-runner';
import type { ArtifactGenerationResult } from '@brq/artifact-generator';
import type { KnowledgeContext } from '@brq/knowledge-loader';
import type { ValidationResult } from '@brq/response-validator';

import type {
  ProductOwnerAgentRequest,
  ProductOwnerAgentResult,
  ProductOwnerBusinessValidationResult,
  ProductOwnerSpecification,
} from './contracts';
import { deepFreeze } from './immutability';
import type { ProductOwnerPromptAssets } from './prompt-assets';
import { productOwnerAgentResultSchema } from './schemas';

interface ProductOwnerResultContext {
  readonly request: ProductOwnerAgentRequest;
  readonly assets: ProductOwnerPromptAssets;
  readonly knowledge: KnowledgeContext;
  readonly run: AgentRunResult;
  readonly responseValidation: ValidationResult;
}

function projectAssets(assets: ProductOwnerPromptAssets) {
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
    context: 'PRODUCT_OWNER' as const,
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

function commonMetadata(context: ProductOwnerResultContext) {
  return {
    assets: projectAssets(context.assets),
    knowledge: projectKnowledge(context.knowledge),
    run: projectRun(context.run),
  };
}

function parseResult(candidate: unknown): ProductOwnerAgentResult {
  return deepFreeze(productOwnerAgentResultSchema.parse(candidate) as ProductOwnerAgentResult);
}

export function createResponseRejectedResult(
  context: ProductOwnerResultContext,
): ProductOwnerAgentResult {
  return parseResult({
    outcome: 'VALIDATION_REJECTED',
    rejectedAt: 'RESPONSE_VALIDATION',
    context: context.request.context,
    readiness: null,
    specification: null,
    artifacts: [],
    validation: {
      response: projectResponseValidation(context.responseValidation),
      business: null,
    },
    metadata: {
      ...commonMetadata(context),
      generation: null,
    },
  });
}

export function createBusinessRejectedResult(
  context: ProductOwnerResultContext,
  businessValidation: ProductOwnerBusinessValidationResult,
): ProductOwnerAgentResult {
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
    metadata: {
      ...commonMetadata(context),
      generation: null,
    },
  });
}

export function createGeneratedResult(
  context: ProductOwnerResultContext,
  specification: ProductOwnerSpecification,
  businessValidation: ProductOwnerBusinessValidationResult,
  generation: ArtifactGenerationResult,
): ProductOwnerAgentResult {
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
    metadata: {
      ...commonMetadata(context),
      generation: generation.metadata,
    },
  });
}
