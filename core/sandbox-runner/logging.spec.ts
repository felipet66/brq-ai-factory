import { describe, expect, it, vi } from 'vitest';

import type { SandboxFailure } from './contracts';
import { SANDBOX_RUNNER_ERROR_CODES } from './errors';
import { logSandboxEvent, sandboxLogContext } from './logging';

describe('sandbox logging', () => {
  it('projects only allowlisted metadata and a sanitized failure code', () => {
    const failure: SandboxFailure = {
      code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
      stage: 'BUILD',
      message: 'must never be logged: sensitive output',
      sourceCode: 'EXIT_NONZERO',
      reasonCode: 'BUILD_EMIT',
      diagnosticSummary: null,
    };
    const context = sandboxLogContext({
      sandboxRunId: 'sandbox-' + 'a'.repeat(32),
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      policyId: 'NODE_NONE_24_V1',
      stepId: 'BUILD',
      failure,
    });
    expect(context).toMatchObject({
      stepId: 'BUILD',
      error: {
        code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
        sourceCode: 'EXIT_NONZERO',
        reasonCode: 'BUILD_EMIT',
      },
    });
    expect(JSON.stringify(context)).not.toContain('sensitive output');
  });

  it('logs only the bounded TypeScript diagnostic summary without source details', () => {
    const failure: SandboxFailure = {
      code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
      stage: 'TYPECHECK',
      message: 'must never be logged: /workspace/project/private.ts:7 secret source',
      sourceCode: 'EXIT_1',
      reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
      diagnosticSummary: {
        diagnosticCount: 3,
        diagnosticCodes: [2304, 7006],
        truncated: false,
      },
    };

    const context = sandboxLogContext({
      sandboxRunId: 'sandbox-' + 'a'.repeat(32),
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      policyId: 'NODE_WEB_PREVIEW_24_V1',
      stepId: 'TYPECHECK',
      failure,
    });

    expect(context).toMatchObject({
      error: {
        code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
        reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
        diagnosticSummary: {
          diagnosticCount: 3,
          diagnosticCodes: [2304, 7006],
          truncated: false,
        },
      },
    });
    expect(JSON.stringify(context)).not.toMatch(/\/workspace\/project|private\.ts|secret source/u);
  });

  it('emits through the supplied logger without changing the context', () => {
    const info = vi.fn();
    const logger = { debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() };
    logSandboxEvent(logger, 'info', 'sandbox.run.started', { sandboxRunId: 'sandbox-1' });
    expect(info).toHaveBeenCalledWith('sandbox.run.started', { sandboxRunId: 'sandbox-1' });
    expect(() => logSandboxEvent(undefined, 'info', 'event', {})).not.toThrow();
    expect(() =>
      logSandboxEvent(
        {
          ...logger,
          error: () => {
            throw new Error('sink unavailable');
          },
        },
        'error',
        'sandbox.run.failed',
        {},
      ),
    ).not.toThrow();
  });
});
