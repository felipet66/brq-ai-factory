import type { ExecutionResult } from '@brq/execution-engine';

import type { ExecutionStageMetrics, ObservableAgentStageId } from './contracts';

const STAGE_KEYS = {
  PRODUCT_OWNER: 'productOwner',
  DEVELOPER: 'developer',
  QA: 'qa',
} as const;

export function emptyStageMetrics(stageId: ObservableAgentStageId): ExecutionStageMetrics {
  return {
    stageId,
    durationMs: null,
    promptBytes: null,
    completionBytes: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    providerLatencyMs: null,
    validationDurationMs: null,
    artifactGenerationDurationMs: null,
  };
}

function safeTotal(inputTokens: number, outputTokens: number): number {
  const total = inputTokens + outputTokens;
  if (!Number.isSafeInteger(total)) throw new RangeError('Token total exceeds safe integer range.');
  return total;
}

export function stageMetricsFromResult(
  result: ExecutionResult,
  stageId: ObservableAgentStageId,
  observed: ExecutionStageMetrics,
): ExecutionStageMetrics {
  const workflow = result.workflowResult;
  if (workflow === null) return observed;
  const key = STAGE_KEYS[stageId];
  const agentResult = workflow.results[key];
  const durationMs = workflow.metrics.observed.stageDurationsMs[key];
  if (agentResult === null) return { ...observed, durationMs };

  const inputTokens = agentResult.metadata.run.metrics.reported.usage.inputTokens;
  const outputTokens = agentResult.metadata.run.metrics.reported.usage.outputTokens;
  return {
    stageId,
    durationMs,
    promptBytes: agentResult.metadata.run.prompt.budget.usedBytes,
    completionBytes: agentResult.metadata.run.metrics.observed.bytesReceived,
    inputTokens,
    outputTokens,
    totalTokens: safeTotal(inputTokens, outputTokens),
    providerLatencyMs: agentResult.metadata.run.metrics.observed.providerDurationMs,
    validationDurationMs: observed.validationDurationMs,
    artifactGenerationDurationMs: observed.artifactGenerationDurationMs,
  };
}
