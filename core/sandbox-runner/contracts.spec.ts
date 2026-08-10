import { describe, expect, it } from 'vitest';

import type { SandboxRunRequest, SandboxRunResult } from './contracts';
import type { SandboxExecutionPolicy } from './policies';
import { createSandboxExecutionPolicyFixture } from './testing';

function assertReadonly(request: SandboxRunRequest, result: SandboxRunResult): void {
  // @ts-expect-error -- Public sandbox requests are deeply readonly.
  request.context.executionId = 'mutated';
  // @ts-expect-error -- Controlled workspace files remain readonly through the port.
  request.workspace.files.push(request.workspace.files[0]);
  // @ts-expect-error -- Public result steps are deeply readonly.
  result.steps[0].status = 'FAILED';
  // @ts-expect-error -- Toolchain provenance remains immutable.
  result.provenance.runtime.toolchainVersions.NODE = 'mutated';
}

void assertReadonly;

function assertPolicyReadonly(policy: SandboxExecutionPolicy): void {
  // @ts-expect-error -- Command arguments exposed by a policy are deeply readonly.
  policy.steps.BUILD.args.push('--mutated');
  // @ts-expect-error -- Nested command environments are deeply readonly.
  policy.steps.BUILD.environment.CI = '1';
  // @ts-expect-error -- Runtime identity is deeply readonly.
  policy.runtime.version = 'mutated';
}

void assertPolicyReadonly;

describe('sandbox runner public contracts', () => {
  it('keeps trusted policy fixtures detached from mutable caller values', () => {
    const policy = createSandboxExecutionPolicyFixture();
    expect(policy.policyId).toBe('NODE_NONE_24_V1');
    expect(policy.steps.PREPARE.executable).toBe('/usr/local/bin/node');
  });
});
