import type { Logger, LogContext } from '@brq/shared/logger/logger';

import type { ValidationRequest, ValidationResult } from './contracts';
import type { ResponseValidatorError } from './errors';

export function requestLogContext(request: ValidationRequest): LogContext {
  return {
    executionId: request.runResult.context.execution.executionId,
    agentExecutionId: request.runResult.context.execution.agentExecutionId,
    requestId: request.runResult.context.requestId,
    traceId: request.runResult.context.traceId,
    provider: request.runResult.provider.provider,
    model: request.runResult.provider.responseModel,
    contractId: request.contract.id,
    contractVersion: request.contract.version,
    contractFormat: request.contract.format,
    promptHash: request.runResult.prompt.metadata.promptHash,
    outputContractHash: request.runResult.prompt.metadata.outputContractHash,
    responseHash: request.runResult.output.responseHash,
    finishReason: request.runResult.output.finishReason,
  };
}

export function resultLogContext(result: ValidationResult, durationMs: number): LogContext {
  return {
    executionId: result.metadata.source.executionId,
    agentExecutionId: result.metadata.source.agentExecutionId,
    requestId: result.metadata.source.requestId,
    traceId: result.metadata.source.traceId,
    provider: result.metadata.source.provider,
    model: result.metadata.source.model,
    contractId: result.metadata.contract.id,
    contractVersion: result.metadata.contract.version,
    contractFormat: result.metadata.contract.format,
    contractHash: result.metadata.contract.contractHash,
    promptHash: result.metadata.source.promptHash,
    outputContractHash: result.metadata.source.outputContractHash,
    responseHash: result.metadata.source.responseHash,
    contentHash: result.metadata.contentHash,
    schemaHash: result.metadata.schemaHash,
    validatedValueHash: result.metadata.validatedValueHash,
    validationHash: result.metadata.validationHash,
    finishReason: result.metadata.source.finishReason,
    valid: result.valid,
    issueCount: result.issues.length,
    issueCodes: result.issues.map((issue) => issue.code),
    issuesTruncated: result.metadata.issuesTruncated,
    durationMs,
  };
}

export function logValidationError(
  logger: Logger,
  error: ResponseValidatorError,
  request?: ValidationRequest,
): void {
  logger.error('response.validation.failed', {
    ...(request === undefined ? {} : requestLogContext(request)),
    errorCode: error.code,
    errorStage: error.stage,
    durationMs: error.durationMs,
  });
}
