import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import { createWorkspacePlanRequestFixture } from '@brq/controlled-workspace/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { SandboxFailure, SandboxRunRequest, SandboxStepResult } from './contracts';
import { resolveSandboxLimits } from './configuration';
import { SANDBOX_RUNNER_ERROR_CODES } from './errors';
import { finalizeSandboxRunResult } from './result-projector';
import {
  sandboxOutputSummarySchema,
  sandboxRunRequestSchema,
  sandboxRunResultSchema,
  sandboxStepResultSchema,
  sandboxTechnicalContextIdSchema,
} from './schemas';
import {
  createSandboxExecutionPolicyFixture,
  createSandboxOutputSummaryFixture,
  createSandboxStepResultsFixture,
} from './testing/sandbox-runner-fixtures';

const roots: string[] = [];

async function requestFixture(): Promise<SandboxRunRequest> {
  const root = await mkdtemp(path.join(tmpdir(), 'brq-sandbox-contract-'));
  roots.push(root);
  const controlled = createFilesystemControlledWorkspace({ rootPath: root });
  const workspace = await controlled.materialize(
    controlled.plan(createWorkspacePlanRequestFixture()),
  );
  return {
    context: { executionId: 'execution-contract-test', requestId: 'request-contract-test' },
    workspace,
    policyId: 'NODE_NONE_24_V1',
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const runtime = {
  adapter: 'DOCKER',
  engineName: 'DOCKER',
  clientVersion: '28.0.0',
  serverVersion: '28.0.0',
  imageReference: 'registry.example/brq/sandbox@sha256:' + 'd'.repeat(64),
  imageDigest: 'sha256:' + 'd'.repeat(64),
  imageId: 'sha256:' + 'e'.repeat(64),
  platform: 'linux/arm64',
  runtimeName: 'NODE',
  runtimeVersion: '24.19.0',
  toolchainVersions: { TYPESCRIPT: '5.9.3' },
} as const;

describe('sandbox public schemas and result projection', () => {
  it('accepts only bounded non-secret technical context identifiers', () => {
    expect(sandboxTechnicalContextIdSchema.safeParse('execution-contract-test').success).toBe(true);
    for (const value of [
      ' execution-1',
      'execution-1 ',
      'execution\n1',
      'execution\u00001',
      'sk-proj-sensitive',
      'request-token-secret',
      'trace.api_key.value',
    ]) {
      expect(sandboxTechnicalContextIdSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepts only the narrow request contract and rejects host authority fields', async () => {
    const request = await requestFixture();
    expect(sandboxRunRequestSchema.safeParse(request).success).toBe(true);
    expect(
      sandboxRunRequestSchema.safeParse({
        ...request,
        rootPath: '/private/workspace',
        image: 'untrusted:latest',
        command: 'npm test',
        environment: { SECRET: 'value' },
      }).success,
    ).toBe(false);
  });

  it('creates a deeply immutable terminal result with separated lineage and provenance', async () => {
    const request = await requestFixture();
    const result = finalizeSandboxRunResult({
      request,
      policy: createSandboxExecutionPolicyFixture(),
      effectiveLimits: resolveSandboxLimits(),
      runtime,
      status: 'SUCCESS',
      startedAt: '2026-08-10T00:00:00.000Z',
      finishedAt: '2026-08-10T00:00:04.000Z',
      durationMs: 4_000,
      steps: createSandboxStepResultsFixture(),
      resourceOutcome: 'NONE',
      failure: null,
    });

    expect(sandboxRunResultSchema.safeParse(result).success).toBe(true);
    expect(result.lineage.workspaceHash).toBe(request.workspace.metadata.workspaceHash);
    expect(result.provenance.runtime.imageDigest).toBe(runtime.imageDigest);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.steps)).toBe(true);
    expect(Object.isFrozen(result.provenance.runtime.toolchainVersions)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(roots.at(-1));

    const observationallyDifferent = finalizeSandboxRunResult({
      request,
      policy: createSandboxExecutionPolicyFixture(),
      effectiveLimits: resolveSandboxLimits(),
      runtime,
      status: 'SUCCESS',
      startedAt: '2026-08-11T01:00:00.000Z',
      finishedAt: '2026-08-11T01:00:08.000Z',
      durationMs: 8_000,
      steps: createSandboxStepResultsFixture().map((step) => ({
        ...step,
        startedAt: '2026-08-11T01:00:00.000Z',
        finishedAt: '2026-08-11T01:00:01.000Z',
        durationMs: 1_000,
      })),
      resourceOutcome: 'NONE',
      failure: null,
    });
    expect(observationallyDifferent.hashes.sandboxResultHash).toBe(result.hashes.sandboxResultHash);
  });

  it('rejects active states, noncanonical ordering and execution after a failed stage', async () => {
    const request = await requestFixture();
    const success = createSandboxStepResultsFixture();
    const result = finalizeSandboxRunResult({
      request,
      policy: createSandboxExecutionPolicyFixture(),
      effectiveLimits: resolveSandboxLimits(),
      runtime,
      status: 'SUCCESS',
      startedAt: '2026-08-10T00:00:00.000Z',
      finishedAt: '2026-08-10T00:00:04.000Z',
      durationMs: 4_000,
      steps: success,
      resourceOutcome: 'NONE',
      failure: null,
    });
    expect(sandboxRunResultSchema.safeParse({ ...result, status: 'RUNNING' }).success).toBe(false);
    expect(
      sandboxRunResultSchema.safeParse({ ...result, steps: [...result.steps].reverse() }).success,
    ).toBe(false);

    const failure = failedBuild();
    const invalidSteps = [
      ...success.slice(0, 2),
      failure.step,
      success[3]!,
    ] as readonly SandboxStepResult[];
    expect(
      sandboxRunResultSchema.safeParse({
        ...result,
        status: 'FAILED',
        steps: invalidSteps,
        failure: failure.failure,
      }).success,
    ).toBe(false);
  });

  it('allows a cleanup failure to override otherwise successful steps', async () => {
    const request = await requestFixture();
    const failure: SandboxFailure = {
      code: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
      stage: 'CLEANUP',
      message: 'A remoção da sandbox não pôde ser confirmada.',
      sourceCode: 'CONTAINER_REMAINS',
      reasonCode: null,
    };
    const result = finalizeSandboxRunResult({
      request,
      policy: createSandboxExecutionPolicyFixture(),
      effectiveLimits: resolveSandboxLimits(),
      runtime,
      status: 'FAILED',
      startedAt: '2026-08-10T00:00:00.000Z',
      finishedAt: '2026-08-10T00:00:04.000Z',
      durationMs: 4_000,
      steps: createSandboxStepResultsFixture(),
      resourceOutcome: 'NONE',
      failure,
    });
    expect(result.status).toBe('FAILED');
    expect(result.failure?.code).toBe(SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED);
  });

  it('allows cleanup failure to override a cancelled step while preserving its evidence', async () => {
    const request = await requestFixture();
    const cleanupFailure: SandboxFailure = {
      code: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
      stage: 'CLEANUP',
      message: 'A remoção da sandbox não pôde ser confirmada.',
      sourceCode: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
      reasonCode: null,
    };
    const cancelledFailure: SandboxFailure = {
      code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
      stage: 'PREPARE',
      message: 'A etapa foi cancelada.',
      sourceCode: null,
      reasonCode: null,
    };
    const steps: readonly SandboxStepResult[] = [
      {
        stepId: 'PREPARE',
        status: 'CANCELLED',
        startedAt: '2026-08-10T00:00:00.000Z',
        finishedAt: '2026-08-10T00:00:00.010Z',
        durationMs: 10,
        exitCode: null,
        timeoutMs: 30_000,
        stdout: createSandboxOutputSummaryFixture(),
        stderr: createSandboxOutputSummaryFixture(),
        resourceOutcome: 'NONE',
        failure: cancelledFailure,
      },
      ...createSandboxStepResultsFixture()
        .slice(1)
        .map((step) => ({
          ...step,
          status: 'SKIPPED' as const,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          exitCode: null,
          stdout: null,
          stderr: null,
          resourceOutcome: 'NONE' as const,
          failure: null,
        })),
    ];
    const result = finalizeSandboxRunResult({
      request,
      policy: createSandboxExecutionPolicyFixture(),
      effectiveLimits: resolveSandboxLimits(),
      runtime,
      status: 'FAILED',
      startedAt: '2026-08-10T00:00:00.000Z',
      finishedAt: '2026-08-10T00:00:01.000Z',
      durationMs: 1_000,
      steps,
      resourceOutcome: 'NONE',
      failure: cleanupFailure,
    });

    expect(result.status).toBe('FAILED');
    expect(result.failure?.code).toBe(SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED);
    expect(result.steps[0]?.status).toBe('CANCELLED');
  });

  it('accepts an interrupted pipeline only when subsequent stages are skipped', async () => {
    const request = await requestFixture();
    const success = createSandboxStepResultsFixture();
    const failure = failedBuild();
    const skipped: SandboxStepResult = {
      stepId: 'TEST',
      status: 'SKIPPED',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      timeoutMs: 90_000,
      stdout: null,
      stderr: null,
      resourceOutcome: 'NONE',
      failure: null,
    };
    const result = finalizeSandboxRunResult({
      request,
      policy: createSandboxExecutionPolicyFixture(),
      effectiveLimits: resolveSandboxLimits(),
      runtime,
      status: 'FAILED',
      startedAt: '2026-08-10T00:00:00.000Z',
      finishedAt: '2026-08-10T00:00:03.000Z',
      durationMs: 3_000,
      steps: [...success.slice(0, 2), failure.step, skipped],
      resourceOutcome: 'NONE',
      failure: failure.failure,
    });
    expect(result.status).toBe('FAILED');
    expect(result.steps[3]?.status).toBe('SKIPPED');
  });

  it('enforces terminal step timestamps, output, exit code and failure metadata', () => {
    const successful = createSandboxStepResultsFixture()[0]!;
    expect(sandboxStepResultSchema.safeParse({ ...successful, startedAt: null }).success).toBe(
      false,
    );
    expect(
      sandboxStepResultSchema.safeParse({
        ...successful,
        finishedAt: '2026-08-09T23:59:59.000Z',
      }).success,
    ).toBe(false);
    expect(sandboxStepResultSchema.safeParse({ ...successful, stdout: null }).success).toBe(false);
    expect(sandboxStepResultSchema.safeParse({ ...successful, exitCode: 1 }).success).toBe(false);
    expect(
      sandboxStepResultSchema.safeParse({ ...successful, status: 'FAILED', failure: null }).success,
    ).toBe(false);
    expect(sandboxStepResultSchema.safeParse({ ...successful, status: 'SKIPPED' }).success).toBe(
      false,
    );
  });

  it('correlates terminal status, failure stage and resource outcome', () => {
    const successful = createSandboxStepResultsFixture()[2]!;
    const output = createSandboxOutputSummaryFixture();
    const failed = {
      ...successful,
      status: 'FAILED' as const,
      exitCode: 137,
      stdout: output,
      stderr: output,
      resourceOutcome: 'OOM' as const,
      failure: {
        code: SANDBOX_RUNNER_ERROR_CODES.RESOURCE_LIMIT,
        stage: 'BUILD' as const,
        message: 'A etapa excedeu os recursos.',
        sourceCode: 'OOM',
        reasonCode: null,
      },
    };
    expect(sandboxStepResultSchema.safeParse(failed).success).toBe(true);
    expect(
      sandboxStepResultSchema.safeParse({
        ...failed,
        failure: { ...failed.failure, stage: 'TEST' },
      }).success,
    ).toBe(false);
    expect(
      sandboxStepResultSchema.safeParse({
        ...failed,
        status: 'TIMEOUT',
        resourceOutcome: 'NONE',
      }).success,
    ).toBe(false);
    expect(
      sandboxStepResultSchema.safeParse({
        ...failed,
        resourceOutcome: 'NONE',
      }).success,
    ).toBe(false);
  });

  it('allows lifecycle cancellation projected onto PREPARE while keeping executed stages strict', () => {
    const prepare = createSandboxStepResultsFixture()[0]!;
    expect(
      sandboxStepResultSchema.safeParse({
        ...prepare,
        status: 'CANCELLED',
        exitCode: null,
        failure: {
          code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
          stage: 'START',
          message: 'A inicialização foi cancelada.',
          sourceCode: null,
          reasonCode: null,
        },
      }).success,
    ).toBe(true);
    const build = createSandboxStepResultsFixture()[2]!;
    expect(
      sandboxStepResultSchema.safeParse({
        ...build,
        status: 'CANCELLED',
        exitCode: null,
        failure: {
          code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
          stage: 'START',
          message: 'A etapa foi cancelada.',
          sourceCode: null,
          reasonCode: null,
        },
      }).success,
    ).toBe(false);
  });

  it('uses the effective deterministic timeout ceiling and rejects divergent projections', async () => {
    const request = await requestFixture();
    const limits = resolveSandboxLimits({ buildTimeoutMs: 60_000 });
    const steps = createSandboxStepResultsFixture().map((step) =>
      step.stepId === 'BUILD' ? { ...step, timeoutMs: 60_000 } : step,
    );
    expect(() =>
      finalizeSandboxRunResult({
        request,
        policy: createSandboxExecutionPolicyFixture(),
        effectiveLimits: limits,
        runtime,
        status: 'SUCCESS',
        startedAt: '2026-08-10T00:00:00.000Z',
        finishedAt: '2026-08-10T00:00:04.000Z',
        durationMs: 4_000,
        steps,
        resourceOutcome: 'NONE',
        failure: null,
      }),
    ).not.toThrow();
    const divergent = steps.map((step) =>
      step.stepId === 'BUILD' ? { ...step, timeoutMs: 59_999 } : step,
    );
    expect(() =>
      finalizeSandboxRunResult({
        request,
        policy: createSandboxExecutionPolicyFixture(),
        effectiveLimits: limits,
        runtime,
        status: 'SUCCESS',
        startedAt: '2026-08-10T00:00:00.000Z',
        finishedAt: '2026-08-10T00:00:04.000Z',
        durationMs: 4_000,
        steps: divergent,
        resourceOutcome: 'NONE',
        failure: null,
      }),
    ).toThrow('O timeout determinístico da etapa');
  });

  it('rejects tampered output and result hashes', async () => {
    const output = createSandboxOutputSummaryFixture('safe summary');
    expect(
      sandboxOutputSummarySchema.safeParse({ ...output, summaryHash: 'f'.repeat(64) }).success,
    ).toBe(false);

    const request = await requestFixture();
    const result = finalizeSandboxRunResult({
      request,
      policy: createSandboxExecutionPolicyFixture(),
      effectiveLimits: resolveSandboxLimits(),
      runtime,
      status: 'SUCCESS',
      startedAt: '2026-08-10T00:00:00.000Z',
      finishedAt: '2026-08-10T00:00:04.000Z',
      durationMs: 4_000,
      steps: createSandboxStepResultsFixture(),
      resourceOutcome: 'NONE',
      failure: null,
    });
    expect(
      sandboxRunResultSchema.safeParse({
        ...result,
        hashes: { ...result.hashes, sandboxResultHash: 'f'.repeat(64) },
      }).success,
    ).toBe(false);
    expect(
      sandboxRunResultSchema.safeParse({
        ...result,
        sandboxRunId: 'sandbox-' + 'f'.repeat(32),
      }).success,
    ).toBe(false);
  });
});

function failedBuild(): { readonly failure: SandboxFailure; readonly step: SandboxStepResult } {
  const failure: SandboxFailure = {
    code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
    stage: 'BUILD',
    message: 'A etapa BUILD terminou com falha.',
    sourceCode: 'EXIT_NONZERO',
    reasonCode: 'BUILD_EMIT',
  };
  return {
    failure,
    step: {
      stepId: 'BUILD',
      status: 'FAILED',
      startedAt: '2026-08-10T00:00:02.000Z',
      finishedAt: '2026-08-10T00:00:02.010Z',
      durationMs: 10,
      exitCode: 1,
      timeoutMs: 120_000,
      stdout: createSandboxOutputSummaryFixture(),
      stderr: createSandboxOutputSummaryFixture('build failed'),
      resourceOutcome: 'NONE',
      failure,
    },
  };
}
