import type { AgentRunResult } from '@brq/agent-runner';
import type { KnowledgeContext } from '@brq/knowledge-loader';
import type { ValidationResult } from '@brq/response-validator';
import type { LogContext } from '@brq/shared/logger/logger';

import type {
  CodeGenerationRequest,
  CodeGeneratorBusinessValidationResult,
  GeneratedCodeBundle,
} from './contracts';
import type { CodeGeneratorAgentError } from './errors';
import { calculateTechnicalSpecificationHash } from './hashing';
import type { CodeGeneratorPromptAssets } from './prompt-assets';

export function requestLogContext(
  request: CodeGenerationRequest,
  assets: CodeGeneratorPromptAssets,
): LogContext {
  return {
    executionId: request.context.executionId,
    agentExecutionId: request.context.agentExecutionId,
    attempt: request.context.attempt,
    agentVersion: request.context.agentVersion,
    requestId: request.context.requestId,
    traceId: request.context.traceId,
    workflowId: request.approval.workflowId,
    model: request.model,
    technicalSpecificationHash: calculateTechnicalSpecificationHash(request.technicalSpecification),
    qaSpecificationHash: request.approval.qaSpecificationHash,
    executionHash: request.approval.executionHash,
    workflowHash: request.approval.workflowHash,
    lineageHash: request.approval.lineageHash,
    provenanceHash: request.approval.provenanceHash,
    sourceModuleCount: request.technicalSpecification.modules.length,
    sourcePlanItemCount: request.technicalSpecification.implementationPlan.length,
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

export function businessValidationLogContext(
  validation: CodeGeneratorBusinessValidationResult,
): LogContext {
  return {
    businessValidationValid: validation.valid,
    businessValidationIssueCodes: validation.issues.map((issue) => issue.code),
    businessValidationIssueCount: validation.issues.length,
    businessValidationIssuesTruncated: validation.issuesTruncated,
  };
}

export function bundleLogContext(bundle: GeneratedCodeBundle): LogContext {
  return {
    bundleVersion: bundle.bundleVersion,
    contractVersion: bundle.contractVersion,
    fileCount: bundle.manifest.fileCount,
    entrypointCount: bundle.entrypoints.length,
    totalBytes: bundle.manifest.totalBytes,
    bundleContentHash: bundle.bundleContentHash,
    manifestHash: bundle.hashes.manifestHash,
    bundleHash: bundle.hashes.bundleHash,
    generationHash: bundle.hashes.generationHash,
  };
}

export function errorLogContext(error: CodeGeneratorAgentError): LogContext {
  return {
    executionId: error.executionId,
    agentExecutionId: error.agentExecutionId,
    requestId: error.requestId,
    traceId: error.traceId,
    stage: error.stage,
    errorCode: error.code,
    ...(error.sourceCode === undefined ? {} : { sourceCode: error.sourceCode }),
    ...(error.reasonCode === undefined ? {} : { reasonCode: error.reasonCode }),
    durationMs: error.durationMs,
  };
}
