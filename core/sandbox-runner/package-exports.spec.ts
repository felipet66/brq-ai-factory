import {
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_STEP_IDS,
  resolveSandboxLimits,
  sandboxRunRequestSchema,
  sandboxRunResultSchema,
  sandboxTechnicalContextIdSchema,
  type SandboxRunRequest,
  type SandboxRunResult,
  type SandboxRunner,
} from '@brq/sandbox-runner';
import { createDockerSandboxRunner } from '@brq/sandbox-runner/docker';
import { describe, expect, it } from 'vitest';

describe('@brq/sandbox-runner package exports', () => {
  it('exposes the provider-neutral port, schemas, lifecycle and stable errors', () => {
    const request: SandboxRunRequest | undefined = undefined;
    const result: SandboxRunResult | undefined = undefined;
    const runner: SandboxRunner | undefined = undefined;
    expect(request).toBeUndefined();
    expect(result).toBeUndefined();
    expect(runner).toBeUndefined();
    expect(sandboxRunRequestSchema).toBeDefined();
    expect(sandboxRunResultSchema).toBeDefined();
    expect(sandboxTechnicalContextIdSchema).toBeDefined();
    expect(resolveSandboxLimits()).toBeDefined();
    expect(SANDBOX_STEP_IDS).toEqual(['PREPARE', 'TYPECHECK', 'BUILD', 'TEST']);
    expect(SANDBOX_RUNNER_ERROR_CODES.CANCELLED).toBe('SANDBOX_CANCELLED');
    expect(createDockerSandboxRunner).toBeTypeOf('function');
  });
});
