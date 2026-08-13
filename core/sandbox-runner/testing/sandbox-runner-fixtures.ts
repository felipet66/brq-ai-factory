import type {
  SandboxExecutionPolicy,
  SandboxOutputSummary,
  SandboxRuntimeObservation,
  SandboxStepResult,
} from '../index';
import { calculateSandboxOutputHash } from '../hashing';
import { SANDBOX_STEP_IDS } from '../lifecycle';

export function createSandboxExecutionPolicyFixture(
  overrides: Partial<SandboxExecutionPolicy> = {},
): SandboxExecutionPolicy {
  const command = (step: string, timeoutMs: number) => ({
    executable: '/usr/local/bin/node',
    args: [`/opt/brq/runner/${step.toLowerCase()}.mjs`, '--workspace', '/workspace/project'],
    workingDirectory: '/workspace/project' as const,
    environment: { CI: '1' as const, NO_COLOR: '1' as const },
    requiredFiles: step === 'PREPARE' ? ['package.json'] : [],
    timeoutMs,
  });
  return {
    policyId: 'NODE_NONE_24_V1',
    version: '1.0.0',
    packageManager: 'NONE',
    runtime: { name: 'NODE', version: '24.19.0' },
    helperAbiVersion: '1.1.0',
    dependencySnapshotHash: null,
    steps: {
      PREPARE: command('PREPARE', 30_000),
      TYPECHECK: command('TYPECHECK', 90_000),
      BUILD: command('BUILD', 120_000),
      TEST: command('TEST', 90_000),
    },
    ...overrides,
  };
}

export function createSandboxOutputSummaryFixture(summary = ''): SandboxOutputSummary {
  return {
    summary,
    observedBytes: Buffer.byteLength(summary, 'utf8'),
    observedLines: summary.length === 0 ? 0 : summary.split('\n').length,
    truncated: false,
    summaryHash: calculateSandboxOutputHash(summary),
  };
}

export function createSandboxRuntimeObservationFixture(): SandboxRuntimeObservation {
  return {
    adapter: 'DOCKER',
    engineName: 'DOCKER',
    clientVersion: '28.0.0',
    serverVersion: '28.0.0',
    imageReference: `registry.example/brq/sandbox@sha256:${'d'.repeat(64)}`,
    imageDigest: `sha256:${'d'.repeat(64)}`,
    imageId: `sha256:${'e'.repeat(64)}`,
    platform: 'linux/arm64',
    runtimeName: 'NODE',
    runtimeVersion: '24.19.0',
    toolchainVersions: { TYPESCRIPT: '5.9.3' },
  };
}

export function createSandboxStepResultsFixture(): readonly SandboxStepResult[] {
  const output = createSandboxOutputSummaryFixture();
  return SANDBOX_STEP_IDS.map((stepId, index) => ({
    stepId,
    status: 'SUCCESS',
    startedAt: `2026-08-10T00:00:0${index}.000Z`,
    finishedAt: `2026-08-10T00:00:0${index}.010Z`,
    durationMs: 10,
    exitCode: 0,
    timeoutMs: [30_000, 90_000, 120_000, 90_000][index]!,
    stdout: output,
    stderr: output,
    resourceOutcome: 'NONE',
    failure: null,
  }));
}
