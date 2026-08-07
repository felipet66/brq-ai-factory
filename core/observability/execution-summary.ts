import type { ExecutionResult } from '@brq/execution-engine';

import type {
  ExecutionObservabilitySummary,
  ExecutionStage,
  ExecutionStageMetrics,
  ExecutionTimelineStageId,
} from './contracts';

const SUMMARY_STAGES = ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const;

function totalTokens(metrics: readonly ExecutionStageMetrics[]): number {
  return metrics.reduce((total, stage) => {
    const next = total + (stage.totalTokens ?? 0);
    if (!Number.isSafeInteger(next))
      throw new RangeError('Token total exceeds safe integer range.');
    return next;
  }, 0);
}

function finalReadiness(result: ExecutionResult): string | null {
  const results = result.workflowResult?.results;
  return (
    results?.qa?.readiness ??
    results?.developer?.readiness ??
    results?.productOwner?.readiness ??
    null
  );
}

export function createExecutionObservabilitySummary(
  result: ExecutionResult,
  stages: readonly ExecutionStage[],
  metrics: readonly ExecutionStageMetrics[],
): ExecutionObservabilitySummary {
  const byId = new Map(stages.map((stage) => [stage.stageId, stage]));
  const executedStages: ExecutionTimelineStageId[] = [];
  const skippedStages: ExecutionTimelineStageId[] = [];
  for (const stageId of SUMMARY_STAGES) {
    const status = byId.get(stageId)?.status;
    if (status === 'SKIPPED' || status === 'PENDING') skippedStages.push(stageId);
    else executedStages.push(stageId);
  }
  return {
    executionId: result.executionId,
    workflowStatus: result.status,
    readinessFinal: finalReadiness(result),
    totalDurationMs: result.metrics.observed.totalDurationMs,
    totalTokens: totalTokens(metrics),
    totalCostEstimate: null,
    executedStages,
    skippedStages,
    hashes: result.hashes,
  };
}
