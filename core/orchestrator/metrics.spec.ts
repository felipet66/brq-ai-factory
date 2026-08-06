import type { ProductOwnerAgentResult } from '@brq/product-owner-agent';
import { describe, expect, it } from 'vitest';

import { createWorkflowMetrics } from './metrics';

function resultWithMetrics(outcome: 'GENERATED' | 'VALIDATION_REJECTED') {
  return {
    outcome,
    artifacts: outcome === 'GENERATED' ? [{}, {}, {}] : [],
    metadata: {
      run: {
        metrics: {
          observed: {
            totalDurationMs: 10,
            promptBuilderDurationMs: 2,
            providerDurationMs: 5,
            bytesSent: 100,
            bytesReceived: 200,
          },
          reported: {
            durationMs: 4,
            attempts: 1,
            usage: { inputTokens: 20, outputTokens: 30 },
          },
        },
      },
    },
  } as unknown as ProductOwnerAgentResult;
}

describe('Workflow metrics', () => {
  it('consolida métricas observadas e reportadas sem misturá-las', () => {
    const metrics = createWorkflowMetrics(
      50,
      { productOwner: 12, developer: 13, qa: null, finalization: null },
      {
        productOwner: resultWithMetrics('GENERATED'),
        developer: resultWithMetrics('VALIDATION_REJECTED') as never,
        qa: null,
      },
    );
    expect(metrics.observed).toMatchObject({
      totalDurationMs: 50,
      agentsAttempted: 2,
      agentsCompleted: 2,
      agentsRejected: 1,
      artifactCount: 3,
      bytesSent: 200,
      bytesReceived: 400,
    });
    expect(metrics.reported).toEqual({
      durationMs: 8,
      attempts: 2,
      usage: { inputTokens: 40, outputTokens: 60 },
    });
  });

  it('não fabrica métricas quando nenhum agente retornou resultado', () => {
    const metrics = createWorkflowMetrics(
      1,
      { productOwner: null, developer: null, qa: null, finalization: null },
      { productOwner: null, developer: null, qa: null },
    );
    expect(metrics.observed.agentsCompleted).toBe(0);
    expect(metrics.reported.attempts).toBe(0);
  });
});
