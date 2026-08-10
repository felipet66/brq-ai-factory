import { createHash } from 'node:crypto';

import type { SandboxRunRequest, SandboxStepResult } from './contracts';
import { canonicalJson } from './canonical-json';
import type { SandboxLimits } from './limits';
import { SANDBOX_STEP_IDS } from './lifecycle';
import type { SandboxExecutionPolicy } from './policies';
import {
  SANDBOX_OUTPUT_SANITIZER_VERSION,
  SANDBOX_RUNNER_CONTRACT_VERSION,
  SANDBOX_RUNNER_VERSION,
} from './version';

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function domainHash(domain: string, value: unknown): string {
  return sha256(`${domain}\u0000${canonicalJson(value)}`);
}

export function calculateSandboxCommandPolicyHash(policy: SandboxExecutionPolicy): string {
  return domainHash('brq-sandbox-runner:commands:v1', {
    stepOrder: SANDBOX_STEP_IDS,
    steps: policy.steps,
  });
}

export interface SandboxRuntimePolicyIdentity {
  readonly adapter: string;
  readonly engineName: string;
  readonly imageReference: string;
  readonly imageDigest: string;
  readonly imageId: string;
  readonly platform: string;
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly toolchainVersions: Readonly<Record<string, string>>;
}

export function calculateSandboxPolicyHash(
  policy: SandboxExecutionPolicy,
  runtimeIdentity: SandboxRuntimePolicyIdentity,
): string {
  return domainHash('brq-sandbox-runner:policy:v1', {
    runnerVersion: SANDBOX_RUNNER_VERSION,
    contractVersion: SANDBOX_RUNNER_CONTRACT_VERSION,
    sanitizerVersion: SANDBOX_OUTPUT_SANITIZER_VERSION,
    stepOrder: SANDBOX_STEP_IDS,
    policy,
    runtimeIdentity: {
      adapter: runtimeIdentity.adapter,
      engineName: runtimeIdentity.engineName,
      imageReference: runtimeIdentity.imageReference,
      imageDigest: runtimeIdentity.imageDigest,
      imageId: runtimeIdentity.imageId,
      platform: runtimeIdentity.platform,
      runtimeName: runtimeIdentity.runtimeName,
      runtimeVersion: runtimeIdentity.runtimeVersion,
      toolchainVersions: runtimeIdentity.toolchainVersions,
    },
  });
}

export function calculateSandboxLimitsHash(limits: SandboxLimits): string {
  return domainHash('brq-sandbox-runner:limits:v1', limits);
}

export function calculateSandboxRequestHash(input: {
  readonly request: SandboxRunRequest;
  readonly effectiveLimits: SandboxLimits;
  readonly policyHash: string;
}): string {
  return domainHash('brq-sandbox-runner:request:v1', {
    contractVersion: SANDBOX_RUNNER_CONTRACT_VERSION,
    workspaceId: input.request.workspace.workspaceId,
    planHash: input.request.workspace.metadata.planHash,
    workspaceHash: input.request.workspace.metadata.workspaceHash,
    source: input.request.workspace.source,
    policyId: input.request.policyId,
    policyHash: input.policyHash,
    limits: input.effectiveLimits,
  });
}

export function deriveSandboxRunId(sandboxRequestHash: string): string {
  return `sandbox-${sandboxRequestHash.slice(0, 32)}`;
}

export function calculateSandboxOutputHash(summary: string): string {
  return domainHash('brq-sandbox-runner:output:v1', summary);
}

export interface SandboxResultHashInput {
  readonly sandboxRunId: string;
  readonly sandboxRequestHash: string;
  readonly status: string;
  readonly workspaceHash: string;
  readonly steps: readonly Pick<
    SandboxStepResult,
    | 'stepId'
    | 'status'
    | 'exitCode'
    | 'timeoutMs'
    | 'stdout'
    | 'stderr'
    | 'resourceOutcome'
    | 'failure'
  >[];
  readonly resourceOutcome: string;
  readonly failure: {
    readonly code: string;
    readonly stage: string;
    readonly sourceCode: string | null;
  } | null;
  readonly policyHash: string;
  readonly commandPolicyHash: string;
  readonly limitsHash: string;
  readonly runtimeIdentity: {
    readonly adapter: string;
    readonly engineName: string;
    readonly clientVersion: string;
    readonly serverVersion: string;
    readonly imageReference: string;
    readonly imageDigest: string;
    readonly imageId: string;
    readonly platform: string;
    readonly runtimeName: string;
    readonly runtimeVersion: string;
    readonly toolchainVersions: Readonly<Record<string, string>>;
  };
}

export function calculateSandboxResultHash(input: SandboxResultHashInput): string {
  return domainHash('brq-sandbox-runner:result:v1', {
    runnerVersion: SANDBOX_RUNNER_VERSION,
    contractVersion: SANDBOX_RUNNER_CONTRACT_VERSION,
    sandboxRunId: input.sandboxRunId,
    sandboxRequestHash: input.sandboxRequestHash,
    status: input.status,
    workspaceHash: input.workspaceHash,
    steps: input.steps.map((step) => ({
      stepId: step.stepId,
      status: step.status,
      exitCode: step.exitCode,
      timeoutMs: step.timeoutMs,
      stdoutHash: step.stdout?.summaryHash ?? null,
      stdoutObservedBytes: step.stdout?.observedBytes ?? null,
      stdoutObservedLines: step.stdout?.observedLines ?? null,
      stdoutTruncated: step.stdout?.truncated ?? null,
      stderrHash: step.stderr?.summaryHash ?? null,
      stderrObservedBytes: step.stderr?.observedBytes ?? null,
      stderrObservedLines: step.stderr?.observedLines ?? null,
      stderrTruncated: step.stderr?.truncated ?? null,
      resourceOutcome: step.resourceOutcome,
      failure:
        step.failure === null
          ? null
          : {
              code: step.failure.code,
              stage: step.failure.stage,
              sourceCode: step.failure.sourceCode,
            },
    })),
    resourceOutcome: input.resourceOutcome,
    failure: input.failure,
    policyHash: input.policyHash,
    commandPolicyHash: input.commandPolicyHash,
    limitsHash: input.limitsHash,
    runtimeIdentity: {
      adapter: input.runtimeIdentity.adapter,
      engineName: input.runtimeIdentity.engineName,
      imageReference: input.runtimeIdentity.imageReference,
      imageDigest: input.runtimeIdentity.imageDigest,
      imageId: input.runtimeIdentity.imageId,
      platform: input.runtimeIdentity.platform,
      runtimeName: input.runtimeIdentity.runtimeName,
      runtimeVersion: input.runtimeIdentity.runtimeVersion,
      toolchainVersions: input.runtimeIdentity.toolchainVersions,
    },
  });
}
