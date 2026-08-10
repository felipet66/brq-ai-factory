import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import { createWorkspacePlanRequestFixture } from '@brq/controlled-workspace/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { SandboxRunRequest } from './contracts';
import { canonicalJson } from './canonical-json';
import { resolveSandboxLimits } from './configuration';
import {
  calculateSandboxCommandPolicyHash,
  calculateSandboxPolicyHash,
  calculateSandboxRequestHash,
  calculateSandboxResultHash,
  deriveSandboxRunId,
} from './hashing';
import { SANDBOX_STEP_IDS } from './lifecycle';
import {
  createSandboxExecutionPolicyFixture,
  createSandboxRuntimeObservationFixture,
  createSandboxStepResultsFixture,
} from './testing';
import {
  SANDBOX_OUTPUT_SANITIZER_VERSION,
  SANDBOX_RUNNER_CONTRACT_VERSION,
  SANDBOX_RUNNER_VERSION,
} from './version';

const roots: string[] = [];

function expectedDomainHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`${domain}\u0000${canonicalJson(value)}`)
    .digest('hex');
}

async function requestFixture(requestId: string): Promise<SandboxRunRequest> {
  const root = await mkdtemp(path.join(tmpdir(), 'brq-sandbox-hashing-'));
  roots.push(root);
  const controlled = createFilesystemControlledWorkspace({ rootPath: root });
  const workspace = await controlled.materialize(
    controlled.plan(createWorkspacePlanRequestFixture()),
  );
  return {
    context: { executionId: 'execution-hash', requestId },
    workspace,
    policyId: 'NODE_NONE_24_V1',
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('sandbox hashing', () => {
  it('binds the canonical step order into command policy hashes', () => {
    const policy = createSandboxExecutionPolicyFixture();
    expect(calculateSandboxCommandPolicyHash(policy)).toBe(
      expectedDomainHash('brq-sandbox-runner:commands:v1', {
        stepOrder: SANDBOX_STEP_IDS,
        steps: policy.steps,
      }),
    );
  });

  it('binds step order and sanitizer version into policy hashes', () => {
    const policy = createSandboxExecutionPolicyFixture();
    const runtime = createSandboxRuntimeObservationFixture();
    expect(calculateSandboxPolicyHash(policy, runtime)).toBe(
      expectedDomainHash('brq-sandbox-runner:policy:v1', {
        runnerVersion: SANDBOX_RUNNER_VERSION,
        contractVersion: SANDBOX_RUNNER_CONTRACT_VERSION,
        sanitizerVersion: SANDBOX_OUTPUT_SANITIZER_VERSION,
        stepOrder: SANDBOX_STEP_IDS,
        policy,
        runtimeIdentity: {
          adapter: runtime.adapter,
          engineName: runtime.engineName,
          imageReference: runtime.imageReference,
          imageDigest: runtime.imageDigest,
          imageId: runtime.imageId,
          platform: runtime.platform,
          runtimeName: runtime.runtimeName,
          runtimeVersion: runtime.runtimeVersion,
          toolchainVersions: runtime.toolchainVersions,
        },
      }),
    );
  });

  it('excludes observational correlation from the deterministic request hash', async () => {
    const first = await requestFixture('request-one');
    const second = { ...first, context: { ...first.context, requestId: 'request-two' } };
    const limits = resolveSandboxLimits();
    const policyHash = calculateSandboxPolicyHash(
      createSandboxExecutionPolicyFixture(),
      createSandboxRuntimeObservationFixture(),
    );
    const firstHash = calculateSandboxRequestHash({
      request: first,
      effectiveLimits: limits,
      policyHash,
    });
    const secondHash = calculateSandboxRequestHash({
      request: second,
      effectiveLimits: limits,
      policyHash,
    });
    expect(secondHash).toBe(firstHash);
    expect(deriveSandboxRunId(firstHash)).toBe(`sandbox-${firstHash.slice(0, 32)}`);
  });

  it('changes when policy or effective limits change', async () => {
    const request = await requestFixture('request-hash');
    const policy = createSandboxExecutionPolicyFixture();
    const policyHash = calculateSandboxPolicyHash(policy, createSandboxRuntimeObservationFixture());
    const baseline = calculateSandboxRequestHash({
      request,
      effectiveLimits: resolveSandboxLimits(),
      policyHash,
    });
    expect(
      calculateSandboxRequestHash({
        request,
        effectiveLimits: resolveSandboxLimits({ cpus: 0.5 }),
        policyHash,
      }),
    ).not.toBe(baseline);
    expect(
      calculateSandboxRequestHash({
        request,
        effectiveLimits: resolveSandboxLimits(),
        policyHash: 'f'.repeat(64),
      }),
    ).not.toBe(baseline);
  });

  it('covers output counts and truncation flags in the result hash', () => {
    const step = createSandboxStepResultsFixture()[0]!;
    const input = {
      sandboxRunId: 'sandbox-' + 'a'.repeat(32),
      sandboxRequestHash: 'b'.repeat(64),
      status: 'SUCCESS',
      workspaceHash: 'c'.repeat(64),
      steps: [step],
      resourceOutcome: 'NONE',
      failure: null,
      policyHash: 'd'.repeat(64),
      commandPolicyHash: 'e'.repeat(64),
      limitsHash: 'f'.repeat(64),
      runtimeIdentity: {
        adapter: 'DOCKER',
        engineName: 'DOCKER',
        clientVersion: '1',
        serverVersion: '1',
        imageReference: 'image@sha256:' + '1'.repeat(64),
        imageDigest: 'sha256:' + '1'.repeat(64),
        imageId: 'sha256:' + '2'.repeat(64),
        platform: 'linux/arm64',
        runtimeName: 'NODE',
        runtimeVersion: '24',
        toolchainVersions: {},
      },
    } as const;
    const baseline = calculateSandboxResultHash(input);
    const changedStep = {
      ...step,
      stdout: step.stdout === null ? null : { ...step.stdout, truncated: true },
    };
    expect(calculateSandboxResultHash({ ...input, steps: [changedStep] })).not.toBe(baseline);
  });
});
