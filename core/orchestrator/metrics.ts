import type { WorkflowAgentResults, WorkflowMetrics } from './contracts';

export interface StageDurations {
  productOwner: number | null;
  developer: number | null;
  qa: number | null;
  finalization: number | null;
}

function add(total: number, value: number): number {
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new RangeError('Workflow metrics exceeded safe integers.');
  return next;
}

export function createWorkflowMetrics(
  totalDurationMs: number,
  stageDurationsMs: StageDurations,
  results: WorkflowAgentResults,
): WorkflowMetrics {
  const available = [results.productOwner, results.developer, results.qa].filter(
    (result) => result !== null,
  );
  const totals = available.reduce(
    (metrics, result) => ({
      artifactCount: add(metrics.artifactCount, result.artifacts.length),
      agentTotalDurationMs: add(
        metrics.agentTotalDurationMs,
        result.metadata.run.metrics.observed.totalDurationMs,
      ),
      promptBuilderDurationMs: add(
        metrics.promptBuilderDurationMs,
        result.metadata.run.metrics.observed.promptBuilderDurationMs,
      ),
      providerDurationMs: add(
        metrics.providerDurationMs,
        result.metadata.run.metrics.observed.providerDurationMs,
      ),
      bytesSent: add(metrics.bytesSent, result.metadata.run.metrics.observed.bytesSent),
      bytesReceived: add(metrics.bytesReceived, result.metadata.run.metrics.observed.bytesReceived),
      reportedDurationMs: add(
        metrics.reportedDurationMs,
        result.metadata.run.metrics.reported.durationMs,
      ),
      attempts: add(metrics.attempts, result.metadata.run.metrics.reported.attempts),
      inputTokens: add(metrics.inputTokens, result.metadata.run.metrics.reported.usage.inputTokens),
      outputTokens: add(
        metrics.outputTokens,
        result.metadata.run.metrics.reported.usage.outputTokens,
      ),
    }),
    {
      artifactCount: 0,
      agentTotalDurationMs: 0,
      promptBuilderDurationMs: 0,
      providerDurationMs: 0,
      bytesSent: 0,
      bytesReceived: 0,
      reportedDurationMs: 0,
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  );

  return {
    observed: {
      totalDurationMs,
      stageDurationsMs,
      agentsAttempted: Object.values(stageDurationsMs).filter(
        (value, index) => index < 3 && value !== null,
      ).length,
      agentsCompleted: available.length,
      agentsRejected: available.filter((result) => result.outcome === 'VALIDATION_REJECTED').length,
      artifactCount: totals.artifactCount,
      agentTotalDurationMs: totals.agentTotalDurationMs,
      promptBuilderDurationMs: totals.promptBuilderDurationMs,
      providerDurationMs: totals.providerDurationMs,
      bytesSent: totals.bytesSent,
      bytesReceived: totals.bytesReceived,
    },
    reported: {
      durationMs: totals.reportedDurationMs,
      attempts: totals.attempts,
      usage: { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens },
    },
  };
}
