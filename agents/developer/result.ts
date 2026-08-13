import type { AgentRunResult } from '@brq/agent-runner';
import type { ArtifactGenerationResult } from '@brq/artifact-generator';
import type { KnowledgeContext } from '@brq/knowledge-loader';
import type { ValidationResult } from '@brq/response-validator';

import type {
  DeveloperAgentRequest,
  DeveloperAgentResult,
  DeveloperBusinessValidationResult,
  TechnicalSpecification,
} from './contracts';
import { deepFreeze } from './immutability';
import { calculateDeveloperSourcePromptContextHash } from './knowledge-projection';
import { sourceSpecificationHash } from './logging';
import type { DeveloperPromptAssets } from './prompt-assets';
import { developerAgentResultSchema } from './schemas';

interface DeveloperResultContext {
  readonly request: DeveloperAgentRequest;
  readonly assets: DeveloperPromptAssets;
  readonly knowledge: KnowledgeContext;
  readonly run: AgentRunResult;
  readonly responseValidation: ValidationResult;
}

function projectAssets(assets: DeveloperPromptAssets) {
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
    context: 'DEVELOPER' as const,
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

function commonMetadata(context: DeveloperResultContext) {
  return {
    assets: projectAssets(context.assets),
    knowledge: projectKnowledge(context.knowledge),
    run: projectRun(context.run),
    sourceSpecificationHash: sourceSpecificationHash(context.request),
    sourcePromptContextHash: calculateDeveloperSourcePromptContextHash(context.request),
    sourceReadiness: context.request.productOwnerSpecification.readiness,
  };
}

function parseResult(candidate: unknown): DeveloperAgentResult {
  return deepFreeze(developerAgentResultSchema.parse(candidate) as DeveloperAgentResult);
}

export function createResponseRejectedResult(
  context: DeveloperResultContext,
): DeveloperAgentResult {
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
  context: DeveloperResultContext,
  businessValidation: DeveloperBusinessValidationResult,
): DeveloperAgentResult {
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
  context: DeveloperResultContext,
  specification: TechnicalSpecification,
  businessValidation: DeveloperBusinessValidationResult,
  generation: ArtifactGenerationResult,
): DeveloperAgentResult {
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
