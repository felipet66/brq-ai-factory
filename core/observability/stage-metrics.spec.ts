import type { ExecutionResult } from '@brq/execution-engine';
import { describe, expect, it } from 'vitest';

import { emptyStageMetrics, stageMetricsFromResult } from './stage-metrics';
import { createSuccessfulExecutionResult } from './testing/observability-fixtures';

describe('Stage metrics projection', () => {
  it('preserva null quando não existe workflow ou resultado do agente', async () => {
    const observed = emptyStageMetrics('QA');
    const withoutWorkflow = { workflowResult: null } as ExecutionResult;
    expect(stageMetricsFromResult(withoutWorkflow, 'QA', observed)).toBe(observed);

    const successful = await createSuccessfulExecutionResult();
    const partial = structuredClone(successful) as unknown as {
      workflowResult: {
        results: { qa: null };
        metrics: { observed: { stageDurationsMs: { qa: number } } };
      };
    };
    partial.workflowResult.results.qa = null;
    partial.workflowResult.metrics.observed.stageDurationsMs.qa = 17;

    expect(stageMetricsFromResult(partial as ExecutionResult, 'QA', observed)).toEqual({
      ...observed,
      durationMs: 17,
    });
  });

  it('projeta todos os valores públicos e preserva as durações observadas', async () => {
    const result = await createSuccessfulExecutionResult();
    const agentResult = result.workflowResult!.results.productOwner!;
    const observed = {
      ...emptyStageMetrics('PRODUCT_OWNER'),
      validationDurationMs: 4,
      artifactGenerationDurationMs: 3,
    };

    expect(stageMetricsFromResult(result, 'PRODUCT_OWNER', observed)).toEqual({
      stageId: 'PRODUCT_OWNER',
      durationMs: result.workflowResult!.metrics.observed.stageDurationsMs.productOwner,
      promptBytes: agentResult.metadata.run.prompt.budget.usedBytes,
      completionBytes: agentResult.metadata.run.metrics.observed.bytesReceived,
      inputTokens: agentResult.metadata.run.metrics.reported.usage.inputTokens,
      outputTokens: agentResult.metadata.run.metrics.reported.usage.outputTokens,
      totalTokens:
        agentResult.metadata.run.metrics.reported.usage.inputTokens +
        agentResult.metadata.run.metrics.reported.usage.outputTokens,
      providerLatencyMs: agentResult.metadata.run.metrics.observed.providerDurationMs,
      validationDurationMs: 4,
      artifactGenerationDurationMs: 3,
    });
  });

  it('rejeita overflow ao somar tokens reportados', async () => {
    const result = structuredClone(await createSuccessfulExecutionResult());
    const usage = result.workflowResult!.results.productOwner!.metadata.run.metrics.reported.usage;
    Object.assign(usage, { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 });

    expect(() =>
      stageMetricsFromResult(result, 'PRODUCT_OWNER', emptyStageMetrics('PRODUCT_OWNER')),
    ).toThrow(RangeError);
  });
});
