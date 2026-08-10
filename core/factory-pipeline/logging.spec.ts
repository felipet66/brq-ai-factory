import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { factoryPipelineLogContext, logFactoryPipelineEvent } from './logging';

describe('Factory Pipeline logging', () => {
  it('emits only identifiers, status, durations, hashes and sanitized error codes', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const context = factoryPipelineLogContext({
      executionId: 'execution-001',
      workflowId: 'workflow-001',
      stage: 'CODE_GENERATOR',
      status: 'FAILED',
      durationMs: 12,
      outputHash: null,
      failure: {
        code: 'FACTORY_PIPELINE_CODE_GENERATION_FAILED',
        stage: 'CODE_GENERATOR',
        sourceCode: 'PROVIDER_ERROR',
        message: 'Mensagem pública sanitizada.',
      },
    });
    logFactoryPipelineEvent(logger, 'error', 'factory.stage.failed', context);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('FACTORY_PIPELINE_CODE_GENERATION_FAILED');
    expect(lines[0]).not.toContain('Mensagem pública sanitizada');
    expect(lines[0]).not.toMatch(/prompt|specification|artifact|content/iu);
  });

  it('does not let a failing logger change the lifecycle', () => {
    const logger = createLogger({
      sink: () => {
        throw new Error('sink failed');
      },
    });
    expect(() =>
      logFactoryPipelineEvent(logger, 'info', 'factory.pipeline.started', {
        executionId: 'execution-001',
      }),
    ).not.toThrow();
  });
});
