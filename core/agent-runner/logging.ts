import type { Logger, LogContext } from '@brq/shared/logger/logger';

import type {
  AgentRunContext,
  AgentRunMetrics,
  PromptMetadata,
  ProviderMetadata,
} from './contracts';
import type { AgentRunError } from './errors';

export function correlationLogContext(context: AgentRunContext): LogContext {
  return {
    executionId: context.execution.executionId,
    agentExecutionId: context.execution.agentExecutionId,
    agent: context.execution.agent,
    attempt: context.execution.attempt,
    agentVersion: context.execution.agentVersion,
    requestId: context.requestId,
    traceId: context.traceId,
  };
}

export function promptLogContext(prompt: PromptMetadata): LogContext {
  return {
    promptId: prompt.metadata.promptId,
    promptVersion: prompt.metadata.version,
    schemaVersion: prompt.metadata.schemaVersion,
    templateHash: prompt.metadata.templateHash,
    promptHash: prompt.metadata.promptHash,
    instructionsHash: prompt.metadata.instructionsHash,
    inputHash: prompt.metadata.inputHash,
    outputContractHash: prompt.metadata.outputContractHash,
    promptBytes: prompt.budget.usedBytes,
  };
}

export function providerLogContext(provider: ProviderMetadata): LogContext {
  return {
    provider: provider.provider,
    requestedModel: provider.requestedModel,
    responseModel: provider.responseModel,
    responseId: provider.responseId,
  };
}

export function metricsLogContext(metrics: AgentRunMetrics): LogContext {
  return {
    totalDurationMs: metrics.observed.totalDurationMs,
    promptBuilderDurationMs: metrics.observed.promptBuilderDurationMs,
    providerDurationMs: metrics.observed.providerDurationMs,
    bytesSent: metrics.observed.bytesSent,
    bytesReceived: metrics.observed.bytesReceived,
    providerReportedDurationMs: metrics.reported.durationMs,
    providerAttempts: metrics.reported.attempts,
    usageInputCount: metrics.reported.usage.inputTokens,
    usageOutputCount: metrics.reported.usage.outputTokens,
  };
}

export function logRunError(
  logger: Logger,
  event: 'agent.run.failed' | 'agent.run.cancelled' | 'agent.run.timed_out',
  error: AgentRunError,
  context?: AgentRunContext,
): void {
  logger.error(event, {
    ...(context === undefined ? {} : correlationLogContext(context)),
    errorCode: error.code,
    errorStage: error.stage,
    sourceCode: error.sourceCode,
    provider: error.provider,
    providerRetryable: error.providerRetryable,
    durationMs: error.elapsedMs,
  });
}
