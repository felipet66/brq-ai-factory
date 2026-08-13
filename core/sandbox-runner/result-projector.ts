import type {
  SandboxFailure,
  SandboxResourceOutcome,
  SandboxRunRequest,
  SandboxRunResult,
  SandboxStepResult,
} from './contracts';
import type { SandboxLimits } from './limits';
import { type SandboxExecutionPolicy, sandboxExecutionPolicySchema } from './policies';
import {
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  SandboxRunnerError,
} from './errors';
import {
  calculateSandboxCommandPolicyHash,
  calculateSandboxLimitsHash,
  calculateSandboxPolicyHash,
  calculateSandboxRequestHash,
  calculateSandboxResultHash,
  deriveSandboxRunId,
} from './hashing';
import { immutableClone } from './immutability';
import {
  sandboxEffectiveLimitsSchema,
  sandboxRunRequestSchema,
  sandboxRunResultSchema,
  sandboxRuntimeObservationSchema,
} from './schemas';
import {
  SANDBOX_OUTPUT_SANITIZER_VERSION,
  SANDBOX_RUNNER_CONTRACT_VERSION,
  SANDBOX_RUNNER_HASH_ALGORITHM,
  SANDBOX_RUNNER_VERSION,
} from './version';

export interface SandboxRuntimeObservationInput {
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
}

export interface FinalizeSandboxRunInput {
  readonly request: SandboxRunRequest;
  readonly policy: SandboxExecutionPolicy;
  readonly effectiveLimits: SandboxLimits;
  readonly runtime: SandboxRuntimeObservationInput;
  readonly status: SandboxRunResult['status'];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly steps: readonly SandboxStepResult[];
  readonly resourceOutcome: SandboxResourceOutcome;
  readonly failure: SandboxFailure | null;
}

export function finalizeSandboxRunResult(input: FinalizeSandboxRunInput): SandboxRunResult {
  const request = sandboxRunRequestSchema.parse(input.request);
  const policy = sandboxExecutionPolicySchema.parse(input.policy);
  const effectiveLimits = sandboxEffectiveLimitsSchema.parse(input.effectiveLimits);
  const runtime = sandboxRuntimeObservationSchema.parse(input.runtime);
  if (policy.policyId !== request.policyId) {
    throw new SandboxRunnerError('A policy resolvida não corresponde ao request da sandbox.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
      stage: SANDBOX_RUNNER_ERROR_STAGES.REQUEST_VALIDATION,
    });
  }
  const timeoutCeilings = {
    PREPARE: effectiveLimits.prepareTimeoutMs,
    TYPECHECK: effectiveLimits.typecheckTimeoutMs,
    BUILD: effectiveLimits.buildTimeoutMs,
    TEST: effectiveLimits.testTimeoutMs,
  } as const;
  for (const step of input.steps) {
    const expectedTimeoutMs = Math.min(
      policy.steps[step.stepId].timeoutMs,
      timeoutCeilings[step.stepId],
    );
    if (step.timeoutMs !== expectedTimeoutMs) {
      throw new SandboxRunnerError(
        'O timeout determinístico da etapa não corresponde à policy e aos limites efetivos.',
        {
          code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
          stage: SANDBOX_RUNNER_ERROR_STAGES.REQUEST_VALIDATION,
        },
      );
    }
  }
  const policyHash = calculateSandboxPolicyHash(policy, runtime);
  const commandPolicyHash = calculateSandboxCommandPolicyHash(policy);
  const limitsHash = calculateSandboxLimitsHash(effectiveLimits);
  const sandboxRequestHash = calculateSandboxRequestHash({
    request,
    effectiveLimits,
    policyHash,
  });
  const sandboxRunId = deriveSandboxRunId(sandboxRequestHash);
  const sandboxResultHash = calculateSandboxResultHash({
    sandboxRunId,
    sandboxRequestHash,
    status: input.status,
    workspaceHash: request.workspace.metadata.workspaceHash,
    steps: input.steps,
    resourceOutcome: input.resourceOutcome,
    failure:
      input.failure === null
        ? null
        : {
            code: input.failure.code,
            stage: input.failure.stage,
            sourceCode: input.failure.sourceCode,
            reasonCode: input.failure.reasonCode,
            diagnosticSummary: input.failure.diagnosticSummary,
          },
    policyHash,
    commandPolicyHash,
    limitsHash,
    runtimeIdentity: runtime,
  });
  const candidate = {
    sandboxRunId,
    context: request.context,
    workspace: {
      workspaceId: request.workspace.workspaceId,
      fileCount: request.workspace.metadata.fileCount,
      totalBytes: request.workspace.metadata.totalBytes,
      planHash: request.workspace.metadata.planHash,
      workspaceHash: request.workspace.metadata.workspaceHash,
    },
    runnerVersion: SANDBOX_RUNNER_VERSION,
    contractVersion: SANDBOX_RUNNER_CONTRACT_VERSION,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    steps: input.steps,
    limits: effectiveLimits,
    resourceOutcome: input.resourceOutcome,
    failure: input.failure,
    hashes: {
      policyHash,
      commandPolicyHash,
      limitsHash,
      sandboxRequestHash,
      sandboxResultHash,
    },
    lineage: {
      technicalSpecificationHash: request.workspace.source.technicalSpecificationHash,
      generationHash: request.workspace.source.generationHash,
      bundleHash: request.workspace.source.bundleHash,
      bundleContentHash: request.workspace.source.bundleContentHash,
      planHash: request.workspace.metadata.planHash,
      workspaceHash: request.workspace.metadata.workspaceHash,
      sandboxRequestHash,
      sandboxResultHash,
    },
    provenance: {
      runnerVersion: SANDBOX_RUNNER_VERSION,
      contractVersion: SANDBOX_RUNNER_CONTRACT_VERSION,
      hashAlgorithm: SANDBOX_RUNNER_HASH_ALGORITHM,
      sanitizerVersion: SANDBOX_OUTPUT_SANITIZER_VERSION,
      policyId: policy.policyId,
      policyVersion: policy.version,
      packageManager: policy.packageManager,
      policyHash,
      commandPolicyHash,
      limitsHash,
      helperAbiVersion: policy.helperAbiVersion,
      dependencySnapshotHash: policy.dependencySnapshotHash,
      runtime,
    },
  };
  return immutableClone(sandboxRunResultSchema.parse(candidate));
}
