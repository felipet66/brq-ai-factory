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
        reasonCode: null,
        profileRuleId: null,
        diagnosticSummary: null,
        message: 'Mensagem pública sanitizada.',
      },
    });
    logFactoryPipelineEvent(logger, 'error', 'factory.stage.failed', context);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('FACTORY_PIPELINE_CODE_GENERATION_FAILED');
    expect(lines[0]).not.toContain('Mensagem pública sanitizada');
    expect(lines[0]).not.toMatch(/prompt|specification|artifact|content/iu);
  });

  it('logs only the structured allowlisted profile rule identifier', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const context = factoryPipelineLogContext({
      executionId: 'execution-001',
      workflowId: 'workflow-001',
      stage: 'CODE_PROFILE_VALIDATION',
      status: 'FAILED',
      failure: {
        code: 'FACTORY_PIPELINE_CODE_PROFILE_VALIDATION_FAILED',
        stage: 'CODE_PROFILE_VALIDATION',
        sourceCode: null,
        reasonCode: 'EXTERNAL_OR_UNSAFE_REFERENCE',
        profileRuleId: 'content.javascript.relative-references',
        diagnosticSummary: null,
        message: 'private ../literal must not cross',
      },
    });

    logFactoryPipelineEvent(logger, 'error', 'factory.stage.failed', context);

    expect(lines[0]).toContain('"profileRuleId":"content.javascript.relative-references"');
    expect(lines[0]).not.toContain('../literal');
  });

  it('logs only the bounded diagnostic summary for stage and terminal failures', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const context = factoryPipelineLogContext({
      executionId: 'execution-001',
      workflowId: 'workflow-001',
      stage: 'SANDBOX_TYPECHECK',
      status: 'FAILED',
      failure: {
        code: 'SANDBOX_STEP_FAILED',
        stage: 'SANDBOX_TYPECHECK',
        sourceCode: 'EXIT_2',
        reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
        profileRuleId: null,
        diagnosticSummary: {
          diagnosticCount: 3,
          diagnosticCodes: [2307, 2322],
          truncated: false,
        },
        message: '/private/workspace/src/index.ts contains private source',
      },
    });

    logFactoryPipelineEvent(logger, 'error', 'factory.stage.failed', context);
    logFactoryPipelineEvent(logger, 'error', 'factory.pipeline.failed', context);

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain(
        '"diagnosticSummary":{"diagnosticCount":3,"diagnosticCodes":[2307,2322],"truncated":false}',
      );
      expect(line).not.toMatch(/private workspace|private source|index\.ts/iu);
    }
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
