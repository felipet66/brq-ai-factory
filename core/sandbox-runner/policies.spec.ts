import { describe, expect, it } from 'vitest';

import { SANDBOX_RUNNER_ERROR_CODES, SandboxRunnerError } from './errors';
import { calculateSandboxPolicyHash } from './hashing';
import { resolveSandboxPolicy, sandboxExecutionPolicySchema } from './policies';
import {
  createSandboxExecutionPolicyFixture,
  createSandboxRuntimeObservationFixture,
} from './testing/sandbox-runner-fixtures';

describe('sandbox execution policies', () => {
  it('resolves a registered policy as a deeply immutable trusted value', () => {
    const resolved = resolveSandboxPolicy(
      [createSandboxExecutionPolicyFixture()],
      'NODE_NONE_24_V1',
    );
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.steps)).toBe(true);
    expect(Object.isFrozen(resolved.steps.BUILD.args)).toBe(true);
  });

  it('rejects unknown and duplicate policy identifiers', () => {
    const policy = createSandboxExecutionPolicyFixture();
    expect(() => resolveSandboxPolicy([policy], 'UNKNOWN_V1')).toThrowError(
      expect.objectContaining({ code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR }),
    );
    expect(() => resolveSandboxPolicy([policy, policy], policy.policyId)).toThrowError(
      SandboxRunnerError,
    );
  });

  it('rejects sensitive environment and NPM without a pinned dependency snapshot', () => {
    const policy = createSandboxExecutionPolicyFixture();
    expect(
      sandboxExecutionPolicySchema.safeParse({
        ...policy,
        steps: {
          ...policy.steps,
          BUILD: { ...policy.steps.BUILD, environment: { API_TOKEN: 'secret' } },
        },
      }).success,
    ).toBe(false);
    expect(
      sandboxExecutionPolicySchema.safeParse({ ...policy, packageManager: 'NPM' }).success,
    ).toBe(false);
    expect(
      sandboxExecutionPolicySchema.safeParse({
        ...policy,
        steps: {
          ...policy.steps,
          TEST: { ...policy.steps.TEST, workingDirectory: '/host/project' },
        },
      }).success,
    ).toBe(false);
  });

  it('hashes canonical policy content and detects command drift', () => {
    const policy = createSandboxExecutionPolicyFixture();
    const runtime = createSandboxRuntimeObservationFixture();
    const reordered = {
      ...policy,
      runtime: { version: policy.runtime.version, name: policy.runtime.name },
    };
    expect(calculateSandboxPolicyHash(reordered, runtime)).toBe(
      calculateSandboxPolicyHash(policy, runtime),
    );
    expect(
      calculateSandboxPolicyHash(
        {
          ...policy,
          steps: {
            ...policy.steps,
            TEST: { ...policy.steps.TEST, args: [...policy.steps.TEST.args, '--changed'] },
          },
        },
        runtime,
      ),
    ).not.toBe(calculateSandboxPolicyHash(policy, runtime));
    expect(
      calculateSandboxPolicyHash(policy, { ...runtime, imageDigest: `sha256:${'a'.repeat(64)}` }),
    ).not.toBe(calculateSandboxPolicyHash(policy, runtime));
    const observationallyDifferentRuntime = {
      ...runtime,
      clientVersion: 'observed-client-change',
      serverVersion: 'observed-server-change',
    };
    expect(calculateSandboxPolicyHash(policy, observationallyDifferentRuntime)).toBe(
      calculateSandboxPolicyHash(policy, runtime),
    );
  });
});
