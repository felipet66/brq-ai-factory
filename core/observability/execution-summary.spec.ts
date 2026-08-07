import type { ExecutionResult } from '@brq/execution-engine';
import { describe, expect, it } from 'vitest';

import type { ExecutionStage, ExecutionStageMetrics } from './contracts';
import { createExecutionObservabilitySummary } from './execution-summary';
import { emptyStageMetrics } from './stage-metrics';
import { createSuccessfulExecutionResult } from './testing/observability-fixtures';

const EXECUTION_ID = `execution-${'a'.repeat(32)}`;

function stages(statuses: readonly ExecutionStage['status'][]): ExecutionStage[] {
  const identities = [
    ['KNOWLEDGE', 'Knowledge'],
    ['PRODUCT_OWNER', 'Product Owner'],
    ['DEVELOPER', 'Developer'],
    ['QA', 'QA'],
  ] as const;
  return identities.map(([stageId, stageName], index) => ({
    stageId,
    stageName,
    status: statuses[index]!,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    requestId: null,
    executionId: EXECUTION_ID,
  }));
}

describe('Execution observability summary', () => {
  it('consolida readiness, tokens, etapas e os mesmos hashes públicos', async () => {
    const result = await createSuccessfulExecutionResult();
    const metrics: ExecutionStageMetrics[] = [
      { ...emptyStageMetrics('PRODUCT_OWNER'), totalTokens: 10 },
      { ...emptyStageMetrics('DEVELOPER'), totalTokens: 20 },
      { ...emptyStageMetrics('QA'), totalTokens: 30 },
    ];
    const projectedStages = stages(['SUCCESS', 'SUCCESS', 'FAILED', 'SKIPPED']).map((stage) => ({
      ...stage,
      executionId: result.executionId,
    }));

    expect(createExecutionObservabilitySummary(result, projectedStages, metrics)).toEqual({
      executionId: result.executionId,
      workflowStatus: 'SUCCESS',
      readinessFinal: result.workflowResult!.results.qa!.readiness,
      totalDurationMs: result.metrics.observed.totalDurationMs,
      totalTokens: 60,
      totalCostEstimate: null,
      executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER'],
      skippedStages: ['QA'],
      hashes: result.hashes,
    });
  });

  it('mantém readiness e tokens ausentes honestamente', async () => {
    const result = structuredClone(await createSuccessfulExecutionResult()) as unknown as {
      status: 'CANCELLED';
      workflowResult: null;
    };
    result.status = 'CANCELLED';
    result.workflowResult = null;
    const metrics = [
      emptyStageMetrics('PRODUCT_OWNER'),
      emptyStageMetrics('DEVELOPER'),
      emptyStageMetrics('QA'),
    ];

    expect(
      createExecutionObservabilitySummary(
        result as ExecutionResult,
        stages(['SKIPPED', 'SKIPPED', 'SKIPPED', 'SKIPPED']),
        metrics,
      ),
    ).toMatchObject({
      workflowStatus: 'CANCELLED',
      readinessFinal: null,
      totalTokens: 0,
      executedStages: [],
      skippedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
    });
  });

  it('rejeita overflow no total de tokens', async () => {
    const result = await createSuccessfulExecutionResult();
    const metrics = [
      { ...emptyStageMetrics('PRODUCT_OWNER'), totalTokens: Number.MAX_SAFE_INTEGER },
      { ...emptyStageMetrics('DEVELOPER'), totalTokens: 1 },
      emptyStageMetrics('QA'),
    ];

    expect(() =>
      createExecutionObservabilitySummary(
        result,
        stages(['SUCCESS', 'SUCCESS', 'SUCCESS', 'SUCCESS']),
        metrics,
      ),
    ).toThrow(RangeError);
  });
});
