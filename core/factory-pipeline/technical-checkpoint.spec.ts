import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
  createControlledWorkspacePlanner,
  type WorkspacePlanRequest,
} from '@brq/controlled-workspace';
import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import {
  finalizeSandboxRunResult,
  resolveSandboxLimits,
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  SandboxRunnerError,
  type SandboxFailure,
  type SandboxRunRequest,
  type SandboxRuntimeObservation,
} from '@brq/sandbox-runner';
import {
  createSandboxExecutionPolicyFixture,
  createSandboxRuntimeObservationFixture,
  createSandboxStepResultsFixture,
} from '@brq/sandbox-runner/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './canonical-json';
import type { FactoryTechnicalBoundaryIdentity, FactoryWorkspacePort } from './contracts';
import {
  createFactoryTechnicalCheckpointFixture,
  createFactoryPipelineConfigurationFixture,
  createFactoryTechnicalBoundaryIdentityFixture,
  incrementalFactoryPipelineClock,
} from './testing/factory-pipeline-fixtures';
import {
  calculateFactoryTechnicalCheckpointHash,
  factoryTechnicalCheckpointSchema,
  type FactoryTechnicalCheckpoint,
} from './technical-checkpoint';
import {
  createFactoryTechnicalResumeExecutor,
  factoryTechnicalResumeResultSchema,
  type FactoryTechnicalResumeResult,
} from './technical-resume';

const TECHNICAL_RESUME_RESULT_HASH_DOMAIN = 'brq-factory-pipeline:technical-resume-result:v1';
const temporaryRoots: string[] = [];

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })),
  );
});

function rehashCheckpoint(
  checkpoint: FactoryTechnicalCheckpoint,
  mutate: (draft: Mutable<FactoryTechnicalCheckpoint>) => void,
): FactoryTechnicalCheckpoint {
  const draft = structuredClone(checkpoint) as Mutable<FactoryTechnicalCheckpoint>;
  mutate(draft);
  const { checkpointHash, ...projection } = draft;
  void checkpointHash;
  draft.checkpointHash = calculateFactoryTechnicalCheckpointHash(projection);
  return factoryTechnicalCheckpointSchema.parse(draft);
}

function rehashResumeResult(
  result: FactoryTechnicalResumeResult,
  mutate: (draft: Mutable<FactoryTechnicalResumeResult>) => void,
): unknown {
  const draft = structuredClone(result) as Mutable<FactoryTechnicalResumeResult>;
  mutate(draft);
  const { resultHash, ...projection } = draft;
  void resultHash;
  draft.resultHash = createHash('sha256')
    .update(`${TECHNICAL_RESUME_RESULT_HASH_DOMAIN}\u0000${canonicalJson(projection)}`)
    .digest('hex');
  return draft;
}

function mutateBoundaryIdentity(
  identity: FactoryTechnicalBoundaryIdentity,
  mutate: (draft: Mutable<FactoryTechnicalBoundaryIdentity>) => void,
): FactoryTechnicalBoundaryIdentity {
  const draft = structuredClone(identity) as Mutable<FactoryTechnicalBoundaryIdentity>;
  mutate(draft);
  return draft;
}

function createUnusedWorkspace() {
  return {
    plan: vi.fn(() => {
      throw new Error('workspace.plan must not be called');
    }),
    materialize: vi.fn(async () => {
      throw new Error('workspace.materialize must not be called');
    }),
    release: vi.fn(async () => {
      throw new Error('workspace.release must not be called');
    }),
  };
}

function createSandboxResult(
  request: SandboxRunRequest,
  input: {
    readonly runtime?: SandboxRuntimeObservation;
    readonly cleanupFailure?: SandboxFailure | null;
  } = {},
) {
  const configuration = createFactoryPipelineConfigurationFixture();
  const runtime = input.runtime ?? createSandboxRuntimeObservationFixture();
  const cleanupFailure = input.cleanupFailure ?? null;
  return finalizeSandboxRunResult({
    request,
    policy: createSandboxExecutionPolicyFixture({
      policyId: configuration.sandbox.policyId,
      version: configuration.sandbox.policyVersion,
    }),
    effectiveLimits: resolveSandboxLimits(configuration.sandbox.limits),
    runtime,
    status: cleanupFailure === null ? 'SUCCESS' : 'FAILED',
    startedAt: '2026-08-13T00:00:00.000Z',
    finishedAt: '2026-08-13T00:00:01.000Z',
    durationMs: 1_000,
    steps: createSandboxStepResultsFixture(),
    resourceOutcome: 'NONE',
    failure: cleanupFailure,
    cleanupFailure,
  });
}

async function createSuccessfulRuntimeHarness(
  input: {
    readonly runtime?: SandboxRuntimeObservation;
    readonly cleanupFailure?: SandboxFailure;
  } = {},
) {
  const configuration = createFactoryPipelineConfigurationFixture();
  const boundaryIdentity = createFactoryTechnicalBoundaryIdentityFixture(configuration);
  const rootPath = await mkdtemp(path.join(tmpdir(), 'brq-technical-resume-'));
  temporaryRoots.push(rootPath);
  const controlledWorkspace = createFilesystemControlledWorkspace({ rootPath });
  const events: string[] = [];
  const workspace: FactoryWorkspacePort = {
    plan: vi.fn((request) => {
      events.push('workspace.plan');
      return controlledWorkspace.plan(request);
    }),
    materialize: vi.fn(async (plan, options) => {
      events.push('workspace.materialize');
      return controlledWorkspace.materialize(plan, options);
    }),
    release: vi.fn(async (materialization) => {
      events.push('workspace.release');
      return controlledWorkspace.release(materialization);
    }),
  };
  const preflight = vi.fn(async () => {
    events.push('sandbox.preflight');
  });
  const run = vi.fn(async (request: SandboxRunRequest) => {
    events.push('sandbox.run');
    return createSandboxResult(request, input);
  });
  const executor = createFactoryTechnicalResumeExecutor({
    workspace,
    sandboxRunner: { preflight, run },
    configuration,
    boundaryIdentity,
    now: incrementalFactoryPipelineClock(),
  });
  return { boundaryIdentity, events, executor, preflight, run, workspace };
}

describe('FactoryTechnicalCheckpoint', () => {
  it('is deterministic, content-addressed and rejects content tampering', () => {
    const first = createFactoryTechnicalCheckpointFixture();
    const second = createFactoryTechnicalCheckpointFixture();
    const projection = (({ checkpointHash, ...value }) => {
      expect(checkpointHash).toMatch(/^[a-f0-9]{64}$/u);
      return value;
    })(first);

    expect(first).toEqual(second);
    expect(first.checkpointHash).toBe(calculateFactoryTechnicalCheckpointHash(projection));
    expect(Object.isFrozen(first)).toBe(true);
    expect(
      factoryTechnicalCheckpointSchema.safeParse({
        ...first,
        bundle: {
          ...first.bundle,
          files: [
            { ...first.bundle.files[0]!, content: `${first.bundle.files[0]!.content}\ntampered` },
            ...first.bundle.files.slice(1),
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('fails closed on a validly rehashed pipeline version drift before preflight or workspace', async () => {
    const checkpoint = rehashCheckpoint(createFactoryTechnicalCheckpointFixture(), (draft) => {
      draft.pipeline.version = '9.9.9';
    });
    const workspace = createUnusedWorkspace();
    const preflight = vi.fn(async () => undefined);
    const executor = createFactoryTechnicalResumeExecutor({
      workspace,
      sandboxRunner: {
        preflight,
        run: async () => {
          throw new Error('sandbox.run must not be called');
        },
      },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: createFactoryTechnicalBoundaryIdentityFixture(),
    });

    await expect(
      executor.resumeTechnical(checkpoint, {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174000',
      }),
    ).rejects.toMatchObject({ reasonCode: 'CHECKPOINT_PIPELINE_DRIFT' });
    expect(preflight).not.toHaveBeenCalled();
    expect(workspace.plan).not.toHaveBeenCalled();
  });

  it.each([
    [
      'version',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) => (draft.workspace.version = '9.9.9'),
    ],
    [
      'contractVersion',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) =>
        (draft.workspace.contractVersion = '9.9.9'),
    ],
    [
      'policyHash',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) =>
        (draft.workspace.policyHash = 'a'.repeat(64)),
    ],
    [
      'configurationHash',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) =>
        (draft.workspace.configurationHash = 'b'.repeat(64)),
    ],
  ])('fails closed on workspace %s drift before preflight or workspace', async (_field, mutate) => {
    const workspace = createUnusedWorkspace();
    const preflight = vi.fn(async () => undefined);
    const executor = createFactoryTechnicalResumeExecutor({
      workspace,
      sandboxRunner: {
        preflight,
        run: async () => {
          throw new Error('sandbox.run must not be called');
        },
      },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: mutateBoundaryIdentity(
        createFactoryTechnicalBoundaryIdentityFixture(),
        mutate,
      ),
    });

    await expect(
      executor.resumeTechnical(createFactoryTechnicalCheckpointFixture(), {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174001',
      }),
    ).rejects.toMatchObject({ reasonCode: 'CHECKPOINT_WORKSPACE_DRIFT' });
    expect(preflight).not.toHaveBeenCalled();
    expect(workspace.plan).not.toHaveBeenCalled();
  });

  it('fails closed on Code Generator asset bundle drift before preflight or workspace', async () => {
    const workspace = createUnusedWorkspace();
    const preflight = vi.fn(async () => undefined);
    const boundaryIdentity = mutateBoundaryIdentity(
      createFactoryTechnicalBoundaryIdentityFixture(),
      (draft) => {
        draft.codeGeneratorAssetBundleHash = 'a'.repeat(64);
      },
    );
    const executor = createFactoryTechnicalResumeExecutor({
      workspace,
      sandboxRunner: {
        preflight,
        run: async () => {
          throw new Error('sandbox.run must not be called');
        },
      },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity,
    });

    await expect(
      executor.resumeTechnical(createFactoryTechnicalCheckpointFixture(), {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174002',
      }),
    ).rejects.toMatchObject({ reasonCode: 'CHECKPOINT_CODE_GENERATOR_DRIFT' });
    expect(preflight).not.toHaveBeenCalled();
    expect(workspace.plan).not.toHaveBeenCalled();
  });

  it.each([
    [
      'policy hash',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) =>
        (draft.sandbox.policyHash = 'a'.repeat(64)),
    ],
    [
      'command policy hash',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) =>
        (draft.sandbox.commandPolicyHash = 'b'.repeat(64)),
    ],
    [
      'limits hash',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) =>
        (draft.sandbox.limitsHash = 'c'.repeat(64)),
    ],
    [
      'image digest',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) =>
        (draft.sandbox.imageDigest = `sha256:${'a'.repeat(64)}`),
    ],
    [
      'image id',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) =>
        (draft.sandbox.imageId = `sha256:${'b'.repeat(64)}`),
    ],
    [
      'platform',
      (draft: Mutable<FactoryTechnicalBoundaryIdentity>) =>
        (draft.sandbox.platform = 'linux/amd64'),
    ],
  ])('fails closed on sandbox %s drift before preflight or workspace', async (_field, mutate) => {
    const workspace = createUnusedWorkspace();
    const preflight = vi.fn(async () => undefined);
    const executor = createFactoryTechnicalResumeExecutor({
      workspace,
      sandboxRunner: {
        preflight,
        run: async () => {
          throw new Error('sandbox.run must not be called');
        },
      },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: mutateBoundaryIdentity(
        createFactoryTechnicalBoundaryIdentityFixture(),
        mutate,
      ),
    });

    await expect(
      executor.resumeTechnical(createFactoryTechnicalCheckpointFixture(), {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174003',
      }),
    ).rejects.toMatchObject({ reasonCode: 'CHECKPOINT_SANDBOX_DRIFT' });
    expect(preflight).not.toHaveBeenCalled();
    expect(workspace.plan).not.toHaveBeenCalled();
  });

  it('recomputes the workspace plan and rejects a different deterministic plan before materialization', async () => {
    const checkpoint = createFactoryTechnicalCheckpointFixture();
    const driftingPlanner = createControlledWorkspacePlanner({ limits: { maxFiles: 10 } });
    const plan = vi.fn((request: WorkspacePlanRequest) => driftingPlanner.plan(request));
    const materialize = vi.fn(async () => {
      throw new Error('workspace.materialize must not be called');
    });
    const preflight = vi.fn(async () => undefined);
    const executor = createFactoryTechnicalResumeExecutor({
      workspace: {
        plan,
        materialize,
        release: async () => {
          throw new Error('workspace.release must not be called');
        },
      },
      sandboxRunner: {
        preflight,
        run: async () => {
          throw new Error('sandbox.run must not be called');
        },
      },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: createFactoryTechnicalBoundaryIdentityFixture(),
    });

    await expect(
      executor.resumeTechnical(checkpoint, {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174004',
      }),
    ).rejects.toMatchObject({ reasonCode: 'CHECKPOINT_WORKSPACE_DRIFT' });
    expect(preflight).toHaveBeenCalledOnce();
    expect(plan).toHaveBeenCalledOnce();
    expect(materialize).not.toHaveBeenCalled();
  });

  it('runs preflight before workspace and forwards the current rerun requestId to sandbox', async () => {
    const checkpoint = createFactoryTechnicalCheckpointFixture();
    const harness = await createSuccessfulRuntimeHarness();
    const controller = new AbortController();

    const result = await harness.executor.resumeTechnical(checkpoint, {
      attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174005',
      requestId: 'request-current-technical-resume',
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      status: 'SUCCESS',
      failure: null,
      workspace: {
        planStatus: 'SUCCESS',
        materializationStatus: 'SUCCESS',
        releaseStatus: 'RELEASED',
      },
      sandbox: { status: 'SUCCESS', cleanupFailure: null },
    });
    expect(harness.events).toEqual([
      'sandbox.preflight',
      'workspace.plan',
      'workspace.materialize',
      'sandbox.run',
      'workspace.release',
    ]);
    expect(harness.preflight).toHaveBeenCalledWith({
      policyId: createFactoryPipelineConfigurationFixture().sandbox.policyId,
      signal: controller.signal,
    });
    expect(harness.run).toHaveBeenCalledOnce();
    expect(harness.run.mock.calls[0]?.[0].context).toEqual({
      executionId: 'technical-resume-123e4567-e89b-42d3-a456-426614174005',
      requestId: 'request-current-technical-resume',
      traceId: checkpoint.source.traceId,
    });
    expect(harness.run.mock.calls[0]?.[0].context.requestId).not.toBe(checkpoint.source.requestId);
    expect(factoryTechnicalResumeResultSchema.safeParse(result).success).toBe(true);
  });

  it('rejects a failed resume preflight before any workspace operation', async () => {
    const workspace = createUnusedWorkspace();
    const preflight = vi.fn(async () => {
      throw new SandboxRunnerError('private Docker detail', {
        code: SANDBOX_RUNNER_ERROR_CODES.RUNTIME_UNAVAILABLE,
        stage: SANDBOX_RUNNER_ERROR_STAGES.START,
      });
    });
    const executor = createFactoryTechnicalResumeExecutor({
      workspace,
      sandboxRunner: {
        preflight,
        run: async () => {
          throw new Error('sandbox.run must not be called');
        },
      },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: createFactoryTechnicalBoundaryIdentityFixture(),
    });

    await expect(
      executor.resumeTechnical(createFactoryTechnicalCheckpointFixture(), {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174006',
      }),
    ).rejects.toMatchObject({ reasonCode: 'RUNTIME_PREFLIGHT_FAILED' });
    expect(preflight).toHaveBeenCalledOnce();
    expect(workspace.plan).not.toHaveBeenCalled();
  });

  it.each([
    [
      'typed cleanup failure',
      () =>
        new SandboxRunnerError('private cleanup detail', {
          code: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
          stage: SANDBOX_RUNNER_ERROR_STAGES.CLEANUP,
          cleanupFailure: {
            code: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
            stage: SANDBOX_RUNNER_ERROR_STAGES.CLEANUP,
            sourceCode: 'PRIVATE_CONTAINER_ID',
          },
        }),
    ],
    ['untyped boundary failure', () => new Error('private unknown runtime detail')],
  ])('fails closed when preflight has %s', async (_label, createError) => {
    const workspace = createUnusedWorkspace();
    const executor = createFactoryTechnicalResumeExecutor({
      workspace,
      sandboxRunner: {
        preflight: async () => {
          throw createError();
        },
        run: async () => {
          throw new Error('sandbox.run must not be called');
        },
      },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: createFactoryTechnicalBoundaryIdentityFixture(),
    });

    await expect(
      executor.resumeTechnical(createFactoryTechnicalCheckpointFixture(), {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174014',
      }),
    ).rejects.toMatchObject({ reasonCode: 'RUNTIME_PREFLIGHT_CLEANUP_UNCONFIRMED' });
    expect(workspace.plan).not.toHaveBeenCalled();
  });

  it('projects unconfirmed sandbox termination when run throws and still releases workspace', async () => {
    const harness = await createSuccessfulRuntimeHarness();
    harness.run.mockRejectedValueOnce(new Error('private runtime boundary detail'));

    const result = await harness.executor.resumeTechnical(
      createFactoryTechnicalCheckpointFixture(),
      {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174015',
      },
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      failure: { stage: 'SANDBOX', reasonCode: 'SANDBOX_FAILED' },
      workspace: { releaseStatus: 'RELEASED' },
      sandbox: {
        status: 'FAILED',
        cleanupFailure: {
          code: 'SANDBOX_CLEANUP_FAILED',
          sourceCode: 'SANDBOX_TERMINATION_UNCONFIRMED',
        },
      },
    });
    expect(harness.events.at(-1)).toBe('workspace.release');
    expect(JSON.stringify(result)).not.toContain('private runtime boundary detail');
  });

  it('fails closed when the clock becomes invalid after physical execution starts', async () => {
    let observations = 0;
    const harness = await createSuccessfulRuntimeHarness();
    const executor = createFactoryTechnicalResumeExecutor({
      workspace: harness.workspace,
      sandboxRunner: { preflight: harness.preflight, run: harness.run },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: harness.boundaryIdentity,
      now: () => (++observations === 1 ? Date.parse('2026-08-13T00:00:00.000Z') : Number.NaN),
    });

    await expect(
      executor.resumeTechnical(createFactoryTechnicalCheckpointFixture(), {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174016',
      }),
    ).rejects.toMatchObject({ reasonCode: 'RUNTIME_CLOCK_FAILED' });
    expect(harness.run).toHaveBeenCalledOnce();
    expect(harness.workspace.release).toHaveBeenCalledOnce();
  });

  it('fails with cleanup evidence when sandbox cleanup is not confirmed and still releases workspace', async () => {
    const cleanupFailure: SandboxFailure = {
      code: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
      stage: 'CLEANUP',
      message: 'A remoção da sandbox não pôde ser confirmada.',
      sourceCode: 'CONTAINER_REMAINS',
      reasonCode: null,
      diagnosticSummary: null,
    };
    const harness = await createSuccessfulRuntimeHarness({ cleanupFailure });

    const result = await harness.executor.resumeTechnical(
      createFactoryTechnicalCheckpointFixture(),
      {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174007',
      },
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      failure: {
        stage: 'SANDBOX',
        reasonCode: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
      },
      workspace: { releaseStatus: 'RELEASED' },
      sandbox: {
        status: 'FAILED',
        cleanupFailure: {
          code: 'SANDBOX_CLEANUP_FAILED',
          stage: 'CLEANUP',
          sourceCode: 'CONTAINER_REMAINS',
        },
      },
    });
    expect(harness.events.at(-1)).toBe('workspace.release');
    expect(factoryTechnicalResumeResultSchema.safeParse(result).success).toBe(true);
  });

  it('preserves compensatory release evidence for an invalid materialization candidate', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'brq-technical-resume-candidate-'));
    temporaryRoots.push(rootPath);
    const candidateWorkspace = createFilesystemControlledWorkspace({
      rootPath,
      limits: { maxFiles: 10 },
    });
    const expectedPlanner = createControlledWorkspacePlanner();
    let observedRequest: WorkspacePlanRequest | undefined;
    const release = vi.fn(async (candidate) => candidateWorkspace.release(candidate));
    const run = vi.fn(async () => {
      throw new Error('sandbox.run must not be called');
    });
    const workspace: FactoryWorkspacePort = {
      plan: vi.fn((request) => {
        observedRequest = request;
        return expectedPlanner.plan(request);
      }),
      materialize: vi.fn(async () => {
        if (observedRequest === undefined) throw new Error('missing workspace request');
        const differentPlan = candidateWorkspace.plan(observedRequest);
        return candidateWorkspace.materialize(differentPlan);
      }),
      release,
    };
    const executor = createFactoryTechnicalResumeExecutor({
      workspace,
      sandboxRunner: { run },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: createFactoryTechnicalBoundaryIdentityFixture(),
      now: incrementalFactoryPipelineClock(),
    });

    const result = await executor.resumeTechnical(createFactoryTechnicalCheckpointFixture(), {
      attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174012',
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      failure: {
        stage: 'WORKSPACE_MATERIALIZATION',
        reasonCode: 'WORKSPACE_MATERIALIZATION_FAILED',
      },
      workspace: {
        planStatus: 'SUCCESS',
        materializationStatus: 'FAILED',
        releaseStatus: 'RELEASED',
        workspaceId: null,
        workspaceHash: null,
      },
      sandbox: { status: 'SKIPPED' },
    });
    expect(release).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    expect(factoryTechnicalResumeResultSchema.safeParse(result).success).toBe(true);
  });

  it('marks cleanup failed when materialization cannot confirm its own cleanup', async () => {
    const planner = createControlledWorkspacePlanner();
    const release = vi.fn(async () => {
      throw new Error('workspace.release must not be called without a candidate');
    });
    const run = vi.fn(async () => {
      throw new Error('sandbox.run must not be called');
    });
    const executor = createFactoryTechnicalResumeExecutor({
      workspace: {
        plan: (request) => planner.plan(request),
        materialize: async () => {
          throw new ControlledWorkspaceError('private cleanup diagnostics', {
            code: CONTROLLED_WORKSPACE_ERROR_CODES.CLEANUP_FAILED,
            stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP,
            workspaceId: `workspace-${'b'.repeat(32)}`,
          });
        },
        release,
      },
      sandboxRunner: { run },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: createFactoryTechnicalBoundaryIdentityFixture(),
      now: incrementalFactoryPipelineClock(),
    });

    const result = await executor.resumeTechnical(createFactoryTechnicalCheckpointFixture(), {
      attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174013',
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      failure: {
        stage: 'WORKSPACE_MATERIALIZATION',
        reasonCode: 'WORKSPACE_MATERIALIZATION_FAILED',
      },
      workspace: {
        materializationStatus: 'FAILED',
        releaseStatus: 'FAILED',
        workspaceId: null,
      },
      sandbox: { status: 'SKIPPED' },
    });
    expect(release).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(factoryTechnicalResumeResultSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private cleanup diagnostics');
  });

  it('records observed sandbox image/platform drift as a failure and releases workspace', async () => {
    const runtime = {
      ...createSandboxRuntimeObservationFixture(),
      imageReference: `registry.example/brq/sandbox@sha256:${'a'.repeat(64)}`,
      imageDigest: `sha256:${'a'.repeat(64)}`,
      imageId: `sha256:${'b'.repeat(64)}`,
      platform: 'linux/amd64' as const,
    };
    const harness = await createSuccessfulRuntimeHarness({ runtime });

    const result = await harness.executor.resumeTechnical(
      createFactoryTechnicalCheckpointFixture(),
      {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174008',
      },
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      failure: { stage: 'SANDBOX', reasonCode: 'CHECKPOINT_SANDBOX_DRIFT' },
      workspace: { releaseStatus: 'RELEASED' },
    });
    expect(harness.events.at(-1)).toBe('workspace.release');
  });

  it('returns a correlated CANCELLED result without planning or materializing workspace', async () => {
    const workspace = createUnusedWorkspace();
    const executor = createFactoryTechnicalResumeExecutor({
      workspace,
      sandboxRunner: {
        run: async () => {
          throw new Error('sandbox.run must not be called');
        },
      },
      configuration: createFactoryPipelineConfigurationFixture(),
      boundaryIdentity: createFactoryTechnicalBoundaryIdentityFixture(),
      now: incrementalFactoryPipelineClock(),
    });
    const controller = new AbortController();
    controller.abort();

    const result = await executor.resumeTechnical(createFactoryTechnicalCheckpointFixture(), {
      attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174009',
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      status: 'CANCELLED',
      failure: { stage: 'WORKSPACE_PLAN', reasonCode: 'CANCELLED' },
      workspace: {
        planStatus: 'FAILED',
        materializationStatus: 'SKIPPED',
        releaseStatus: 'NOT_REQUIRED',
      },
      sandbox: { status: 'SKIPPED', cleanupFailure: null },
    });
    expect(workspace.plan).not.toHaveBeenCalled();
    expect(factoryTechnicalResumeResultSchema.safeParse(result).success).toBe(true);
  });

  it('rejects rehashed SUCCESS/FAILED/CANCELLED and cleanup combinations that violate invariants', async () => {
    const successHarness = await createSuccessfulRuntimeHarness();
    const success = await successHarness.executor.resumeTechnical(
      createFactoryTechnicalCheckpointFixture(),
      {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174010',
      },
    );
    const cleanupFailure: SandboxFailure = {
      code: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
      stage: 'CLEANUP',
      message: 'A remoção da sandbox não pôde ser confirmada.',
      sourceCode: 'CONTAINER_REMAINS',
      reasonCode: null,
      diagnosticSummary: null,
    };
    const failedHarness = await createSuccessfulRuntimeHarness({ cleanupFailure });
    const failed = await failedHarness.executor.resumeTechnical(
      createFactoryTechnicalCheckpointFixture(),
      {
        attemptId: 'technical-resume-123e4567-e89b-42d3-a456-426614174011',
      },
    );

    expect(
      factoryTechnicalResumeResultSchema.safeParse(
        rehashResumeResult(success, (draft) => {
          draft.status = 'FAILED';
        }),
      ).success,
    ).toBe(false);
    expect(
      factoryTechnicalResumeResultSchema.safeParse(
        rehashResumeResult(failed, (draft) => {
          draft.status = 'CANCELLED';
        }),
      ).success,
    ).toBe(false);
    expect(
      factoryTechnicalResumeResultSchema.safeParse(
        rehashResumeResult(success, (draft) => {
          draft.workspace.releaseStatus = 'FAILED';
        }),
      ).success,
    ).toBe(false);
    expect(
      factoryTechnicalResumeResultSchema.safeParse(
        rehashResumeResult(success, (draft) => {
          draft.sandbox.cleanupFailure = {
            code: 'SANDBOX_CLEANUP_FAILED',
            stage: 'CLEANUP',
            sourceCode: 'CONTAINER_REMAINS',
            reasonCode: null,
            diagnosticSummary: null,
            message: 'A remoção da sandbox não pôde ser confirmada.',
          };
        }),
      ).success,
    ).toBe(false);
  });
});
