import type { Logger, LogContext } from '@brq/shared/logger/logger';

import type { ArtifactGenerationRequest, ArtifactGenerationResult } from './contracts';
import type { ArtifactGeneratorError } from './errors';

export function requestLogContext(
  request: ArtifactGenerationRequest,
  specificationHash?: string,
): LogContext {
  const source = request.validation.metadata.source;
  return {
    executionId: source.executionId,
    agentExecutionId: source.agentExecutionId,
    requestId: source.requestId,
    traceId: source.traceId,
    specificationId: request.specification.id,
    specificationVersion: request.specification.version,
    ...(specificationHash === undefined ? {} : { specificationHash }),
    sourceContractId: request.specification.sourceContract.id,
    sourceContractVersion: request.specification.sourceContract.version,
    sourceContractFormat: request.specification.sourceContract.format,
    sourceContractHash: request.specification.sourceContract.contractHash,
    sourceValidationHash: request.validation.metadata.validationHash,
    sourceValidatedValueHash: request.validation.metadata.validatedValueHash,
    templateCount: request.specification.templates.length,
  };
}

export function resultLogContext(result: ArtifactGenerationResult, durationMs: number): LogContext {
  const source = result.metadata.source;
  return {
    executionId: source.executionId,
    agentExecutionId: source.agentExecutionId,
    requestId: source.requestId,
    traceId: source.traceId,
    specificationId: result.metadata.specificationId,
    specificationVersion: result.metadata.specificationVersion,
    specificationHash: result.metadata.specificationHash,
    sourceValidationHash: source.validationHash,
    sourceValidatedValueHash: source.validatedValueHash,
    generationHash: result.metadata.generationHash,
    artifactCount: result.metadata.artifactCount,
    totalBytes: result.metadata.totalBytes,
    artifacts: result.artifacts.map(({ metadata }) => ({
      templateId: metadata.templateId,
      format: metadata.format,
      mediaType: metadata.mediaType,
      templateHash: metadata.templateHash,
      contentHash: metadata.contentHash,
      draftHash: metadata.draftHash,
      byteLength: metadata.byteLength,
    })),
    durationMs,
  };
}

export function logGenerationError(
  logger: Logger,
  error: ArtifactGeneratorError,
  context: LogContext = {},
): void {
  logger.error('artifact.generation.failed', {
    ...context,
    executionId: error.executionId ?? context.executionId,
    agentExecutionId: error.agentExecutionId ?? context.agentExecutionId,
    requestId: error.requestId ?? context.requestId,
    traceId: error.traceId ?? context.traceId,
    errorCode: error.code,
    errorClassification: error.classification,
    errorStage: error.stage,
    specificationId: error.specificationId ?? context.specificationId,
    templateId: error.templateId,
    durationMs: error.durationMs,
  });
}
