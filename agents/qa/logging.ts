import type { AgentRunResult } from '@brq/agent-runner';
import type { ArtifactGenerationResult } from '@brq/artifact-generator';
import type { KnowledgeContext } from '@brq/knowledge-loader';
import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { ValidationResult } from '@brq/response-validator';
import type { LogContext } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { QAAgentRequest, QABusinessValidationResult, QASpecification } from './contracts';
import type { QAAgentError } from './errors';
import type { QAPromptAssets } from './prompt-assets';

function canonicalHash(value: unknown): string {
  return `sha256:${calculateCanonicalJsonHash(value as JsonValue)}`;
}

export function productOwnerSpecificationHash(request: QAAgentRequest): string {
  return canonicalHash(request.productOwnerSpecification);
}

export function technicalSpecificationHash(request: QAAgentRequest): string {
  return canonicalHash(request.technicalSpecification);
}

export function requestLogContext(request: QAAgentRequest, assets: QAPromptAssets): LogContext {
  return {
    executionId: request.context.executionId,
    agentExecutionId: request.context.agentExecutionId,
    attempt: request.context.attempt,
    agentVersion: request.context.agentVersion,
    requestId: request.context.requestId,
    traceId: request.context.traceId,
    model: request.model,
    deliveryIntentVersion: request.deliveryIntent.version,
    deliveryMode: request.deliveryIntent.mode,
    productOwnerSpecificationHash: productOwnerSpecificationHash(request),
    technicalSpecificationHash: technicalSpecificationHash(request),
    productOwnerReadiness: request.productOwnerSpecification.readiness,
    technicalReadiness: request.technicalSpecification.readiness,
    sourceAcceptanceCriteriaCount: request.productOwnerSpecification.acceptanceCriteria.length,
    sourceBusinessRuleCount: request.productOwnerSpecification.businessRules.length,
    sourceDecisionCount: request.technicalSpecification.decisions.length,
    sourceDefinitionOfDoneCount: request.technicalSpecification.definitionOfDone.length,
    assetBundleId: assets.manifest.id,
    assetBundleVersion: assets.manifest.version,
    assetBundleHash: assets.hashes.bundleHash,
  };
}

export function knowledgeLogContext(knowledge: KnowledgeContext): LogContext {
  return {
    knowledgeContext: knowledge.context,
    knowledgeSourceId: knowledge.sourceId,
    knowledgeManifestVersion: knowledge.manifestVersion,
    knowledgePolicyVersion: knowledge.policyVersion,
    knowledgeContextHash: knowledge.contextHash,
    knowledgeDocumentCount: knowledge.includedDocuments.length,
    knowledgeUsedBytes: knowledge.budget.usedBytes,
  };
}

export function runLogContext(run: AgentRunResult): LogContext {
  return {
    promptId: run.prompt.metadata.promptId,
    promptVersion: run.prompt.metadata.version,
    promptHash: run.prompt.metadata.promptHash,
    outputContractHash: run.prompt.metadata.outputContractHash,
    responseHash: run.output.responseHash,
    finishReason: run.output.finishReason,
    provider: run.provider.provider,
    model: run.provider.responseModel,
    totalDurationMs: run.metrics.observed.totalDurationMs,
    promptBuilderDurationMs: run.metrics.observed.promptBuilderDurationMs,
    providerDurationMs: run.metrics.observed.providerDurationMs,
    bytesSent: run.metrics.observed.bytesSent,
    bytesReceived: run.metrics.observed.bytesReceived,
    providerAttempts: run.metrics.reported.attempts,
  };
}

export function responseValidationLogContext(validation: ValidationResult): LogContext {
  return {
    validationContractId: validation.metadata.contract.id,
    validationContractVersion: validation.metadata.contract.version,
    validationContractHash: validation.metadata.contract.contractHash,
    validationHash: validation.metadata.validationHash,
    validatedValueHash: validation.metadata.validatedValueHash,
    validationValid: validation.valid,
    validationIssueCodes: validation.issues.map((issue) => issue.code),
    validationIssueCount: validation.issues.length,
    validationIssuesTruncated: validation.metadata.issuesTruncated,
  };
}

export function businessValidationLogContext(validation: QABusinessValidationResult): LogContext {
  return {
    businessValidationValid: validation.valid,
    expectedReadiness: validation.expectedReadiness,
    businessValidationIssueCodes: validation.issues.map((issue) => issue.code),
    businessValidationIssueCount: validation.issues.length,
    businessValidationIssuesTruncated: validation.issuesTruncated,
  };
}

export function specificationLogContext(specification: QASpecification): LogContext {
  return {
    readiness: specification.readiness,
    positiveScenarioCount: specification.positiveScenarios.length,
    negativeScenarioCount: specification.negativeScenarios.length,
    edgeCaseCount: specification.edgeCases.length,
    blockingItemCount: specification.blockingItems.length,
    priorityTestCount: specification.priorityTests.length,
    acceptanceCriteriaCovered: specification.traceability.summary.acceptanceCriteria.covered,
    businessRulesCovered: specification.traceability.summary.businessRules.covered,
    technicalDecisionsCovered: specification.traceability.summary.technicalDecisions.covered,
    definitionOfDoneCovered: specification.traceability.summary.definitionOfDone.covered,
  };
}

export function generationLogContext(generation: ArtifactGenerationResult): LogContext {
  return {
    artifactSpecificationId: generation.metadata.specificationId,
    artifactSpecificationVersion: generation.metadata.specificationVersion,
    artifactSpecificationHash: generation.metadata.specificationHash,
    generationHash: generation.metadata.generationHash,
    artifactCount: generation.metadata.artifactCount,
    totalArtifactBytes: generation.metadata.totalBytes,
    artifactHashes: generation.artifacts.map((artifact) => artifact.metadata.draftHash),
  };
}

export function errorLogContext(error: QAAgentError): LogContext {
  return {
    executionId: error.executionId,
    agentExecutionId: error.agentExecutionId,
    requestId: error.requestId,
    traceId: error.traceId,
    stage: error.stage,
    errorCode: error.code,
    ...(error.sourceCode === undefined ? {} : { sourceCode: error.sourceCode }),
    durationMs: error.durationMs,
  };
}
