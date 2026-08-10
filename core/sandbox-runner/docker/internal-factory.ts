import { randomUUID } from 'node:crypto';

import type {
  SandboxFailure,
  SandboxOutputSummary,
  SandboxResourceOutcome,
  SandboxRunRequest,
  SandboxRunResult,
  SandboxRunner,
  SandboxRunOptions,
  SandboxStepResult,
} from '../contracts';
import { resolveSandboxLimits } from '../configuration';
import {
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  SandboxRunnerError,
  type SandboxRunnerErrorCode,
  type SandboxRunnerErrorStage,
} from '../errors';
import {
  calculateSandboxPolicyHash,
  calculateSandboxRequestHash,
  deriveSandboxRunId,
} from '../hashing';
import { SANDBOX_STEP_IDS, type SandboxStepId } from '../lifecycle';
import type { SandboxLimits } from '../limits';
import { logSandboxEvent, sandboxLogContext } from '../logging';
import { sanitizeSandboxOutput } from '../output-sanitizer';
import {
  resolveSandboxPolicy,
  type SandboxCommandPolicy,
  type SandboxExecutionPolicy,
} from '../policies';
import { finalizeSandboxRunResult } from '../result-projector';
import { sandboxRunRequestSchema } from '../schemas';
import {
  buildArtifactExportArguments,
  buildCreateContainerArguments,
  buildExecArguments,
  buildReadinessArguments,
  isStrictSandboxCommand,
} from './docker-command-builder';
import {
  DOCKER_SANDBOX_ARTIFACT_EXPORT_ABI_VERSION,
  type DockerSandboxArtifactCorrelation,
  type DockerSandboxArtifactSink,
  type DockerSandboxArtifactUnavailableCode,
} from './artifact-capture';
import type { DockerCommandExecutor, DockerCommandResult } from './docker-cli';
import type { ResolvedDockerSandboxRunnerOptions } from './docker-configuration';
import { verifyCreatedContainer, verifyDockerRuntimeAndImage } from './docker-image-verifier';
import { createWorkspacePayload } from './workspace-payload';
import { readAndVerifyWorkspace } from './workspace-reader';

interface DockerSandboxRunnerDependencies {
  readonly executor: DockerCommandExecutor;
  readonly artifactSink?: DockerSandboxArtifactSink;
}

const ADMIN_OUTPUT_LIMIT = 1024 * 1024;
const ARTIFACT_EXPORT_OUTPUT_LIMIT = 1536 * 1024;
const ARTIFACT_EXPORT_TIMEOUT_MS = 15_000;
const MINIMUM_DOCKER_MEMORY_BYTES = 128 * 1024 * 1024;
const EMPTY_CAPTURE = Object.freeze({
  value: '',
  observedBytes: 0,
  observedLines: 0,
  captureTruncated: false,
});

function isoTime(value: number): string {
  return new Date(value).toISOString();
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function safeLog(operation: () => void): void {
  try {
    operation();
  } catch {
    // Observability is best effort and never changes a sandbox outcome.
  }
}

async function notifyArtifactUnavailable(
  sink: DockerSandboxArtifactSink,
  correlation: DockerSandboxArtifactCorrelation,
  code: DockerSandboxArtifactUnavailableCode,
): Promise<void> {
  try {
    await sink.unavailable(Object.freeze({ ...correlation, code }));
  } catch {
    // Artifact inspection is additive and can never change an authoritative Sandbox outcome.
  }
}

function artifactExportFailureCode(
  result: DockerCommandResult,
): DockerSandboxArtifactUnavailableCode | null {
  if (result.cancelled) return 'EXPORT_CANCELLED';
  if (result.timedOut) return 'EXPORT_TIMEOUT';
  if (result.outputLimitExceeded || result.stdout.captureTruncated) return 'EXPORT_OUTPUT_LIMIT';
  if (result.exitCode !== 0 || result.sourceCode !== null) return 'EXPORT_EXECUTION_FAILED';
  if (result.stderr.observedBytes > 0) return 'EXPORT_EXECUTION_FAILED';
  try {
    const candidate: unknown = JSON.parse(result.stdout.value);
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      !('abiVersion' in candidate) ||
      (candidate as { readonly abiVersion?: unknown }).abiVersion !==
        DOCKER_SANDBOX_ARTIFACT_EXPORT_ABI_VERSION
    ) {
      return 'EXPORT_INVALID_OUTPUT';
    }
  } catch {
    return 'EXPORT_INVALID_OUTPUT';
  }
  return null;
}

async function capturePreviewArtifact(input: {
  readonly executor: DockerCommandExecutor;
  readonly sink: DockerSandboxArtifactSink;
  readonly correlation: DockerSandboxArtifactCorrelation;
  readonly containerId: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  let result: DockerCommandResult;
  try {
    result = await input.executor.execute({
      args: buildArtifactExportArguments(input.containerId),
      timeoutMs: ARTIFACT_EXPORT_TIMEOUT_MS,
      hardOutputBytes: ARTIFACT_EXPORT_OUTPUT_LIMIT,
      capturedOutputBytesPerStream: ARTIFACT_EXPORT_OUTPUT_LIMIT,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  } catch {
    await notifyArtifactUnavailable(input.sink, input.correlation, 'EXPORT_EXECUTION_FAILED');
    return;
  }
  const failureCode = artifactExportFailureCode(result);
  if (failureCode !== null) {
    await notifyArtifactUnavailable(input.sink, input.correlation, failureCode);
    return;
  }
  try {
    await input.sink.captured(
      Object.freeze({
        ...input.correlation,
        envelope: result.stdout.value,
      }),
    );
  } catch {
    await notifyArtifactUnavailable(input.sink, input.correlation, 'SINK_REJECTED');
  }
}

function stableFailure(input: {
  readonly code: SandboxRunnerErrorCode;
  readonly stage: SandboxRunnerErrorStage;
  readonly message: string;
  readonly sourceCode?: string | null;
}): SandboxFailure {
  return Object.freeze({
    code: input.code,
    stage: input.stage,
    message: input.message,
    sourceCode: input.sourceCode ?? null,
  });
}

function stageFor(stepId: SandboxStepId): SandboxRunnerErrorStage {
  return SANDBOX_RUNNER_ERROR_STAGES[stepId];
}

function timeoutForStep(
  stepId: SandboxStepId,
  policy: SandboxCommandPolicy,
  limits: SandboxLimits,
): number {
  const configured = {
    PREPARE: limits.prepareTimeoutMs,
    TYPECHECK: limits.typecheckTimeoutMs,
    BUILD: limits.buildTimeoutMs,
    TEST: limits.testTimeoutMs,
  }[stepId];
  return Math.min(policy.timeoutMs, configured);
}

function skippedStep(
  stepId: SandboxStepId,
  policy: SandboxExecutionPolicy,
  limits: SandboxLimits,
): SandboxStepResult {
  return Object.freeze({
    stepId,
    status: 'SKIPPED',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    exitCode: null,
    timeoutMs: timeoutForStep(stepId, policy.steps[stepId], limits),
    stdout: null,
    stderr: null,
    resourceOutcome: 'NONE',
    failure: null,
  });
}

function summarizeOutput(
  capture: DockerCommandResult['stdout'],
  limits: SandboxLimits,
  hostPaths: readonly string[],
  sensitiveValues: readonly string[],
): SandboxOutputSummary {
  const summary = sanitizeSandboxOutput(capture.value, {
    maxBytes: limits.capturedOutputBytesPerStream,
    maxLines: limits.maxOutputLinesPerStream,
    maxLineBytes: limits.maxOutputLineBytes,
    hostPaths,
    sensitiveValues,
  });
  return Object.freeze({
    ...summary,
    observedBytes: capture.observedBytes,
    observedLines: capture.observedLines,
    truncated: summary.truncated || capture.captureTruncated,
  });
}

function administrativeFailure(result: DockerCommandResult): SandboxRunnerError {
  if (result.cancelled) {
    return new SandboxRunnerError('A operação da sandbox foi cancelada.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
      stage: SANDBOX_RUNNER_ERROR_STAGES.START,
      ...(result.sourceCode === null ? {} : { sourceCode: result.sourceCode }),
    });
  }
  if (result.timedOut) {
    return new SandboxRunnerError('O runtime Docker não respondeu dentro do limite.', {
      code: SANDBOX_RUNNER_ERROR_CODES.TIMEOUT,
      stage: SANDBOX_RUNNER_ERROR_STAGES.START,
      ...(result.sourceCode === null ? {} : { sourceCode: result.sourceCode }),
    });
  }
  return new SandboxRunnerError('O runtime Docker não está disponível.', {
    code: SANDBOX_RUNNER_ERROR_CODES.RUNTIME_UNAVAILABLE,
    stage: SANDBOX_RUNNER_ERROR_STAGES.START,
    ...(result.sourceCode === null ? {} : { sourceCode: result.sourceCode }),
  });
}

async function administrativeCommand(
  executor: DockerCommandExecutor,
  limits: SandboxLimits,
  args: readonly string[],
  signal?: AbortSignal,
  timeoutMs = limits.administrativeTimeoutMs,
): Promise<DockerCommandResult> {
  let result: DockerCommandResult;
  try {
    result = await executor.execute({
      args,
      timeoutMs,
      hardOutputBytes: ADMIN_OUTPUT_LIMIT,
      capturedOutputBytesPerStream: ADMIN_OUTPUT_LIMIT,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    throw new SandboxRunnerError('O runtime Docker não está disponível.', {
      code: SANDBOX_RUNNER_ERROR_CODES.RUNTIME_UNAVAILABLE,
      stage: SANDBOX_RUNNER_ERROR_STAGES.START,
      sourceCode: 'DOCKER_COMMAND_REJECTED',
    });
  }
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.cancelled ||
    result.outputLimitExceeded ||
    result.sourceCode !== null
  ) {
    throw administrativeFailure(result);
  }
  return result;
}

function remainingTimeout(started: number, limits: SandboxLimits, now: () => number): number {
  const remaining = limits.totalTimeoutMs - Math.max(0, now() - started);
  if (remaining <= 0) {
    throw new SandboxRunnerError('A execução excedeu o timeout total autorizado.', {
      code: SANDBOX_RUNNER_ERROR_CODES.TIMEOUT,
      stage: SANDBOX_RUNNER_ERROR_STAGES.START,
    });
  }
  return Math.min(limits.administrativeTimeoutMs, remaining);
}

type ContainerDiscovery =
  | { readonly status: 'OWNED'; readonly containerId: string }
  | { readonly status: 'ABSENT' | 'UNCONFIRMED' };

async function discoverOwnedContainer(input: {
  readonly executor: DockerCommandExecutor;
  readonly limits: SandboxLimits;
  readonly containerName: string;
  readonly ownershipToken: string;
}): Promise<ContainerDiscovery> {
  try {
    const inspection = await input.executor.execute({
      args: ['container', 'inspect', '--format', '{{json .}}', input.containerName],
      timeoutMs: input.limits.administrativeTimeoutMs,
      hardOutputBytes: ADMIN_OUTPUT_LIMIT,
      capturedOutputBytesPerStream: ADMIN_OUTPUT_LIMIT,
    });
    if (
      inspection.exitCode === 0 &&
      !inspection.timedOut &&
      !inspection.cancelled &&
      !inspection.outputLimitExceeded &&
      inspection.sourceCode === null
    ) {
      const parsed: unknown = JSON.parse(inspection.stdout.value);
      if (parsed === null || typeof parsed !== 'object') return { status: 'UNCONFIRMED' };
      const candidate = parsed as {
        readonly Id?: unknown;
        readonly Config?: { readonly Labels?: Readonly<Record<string, unknown>> };
      };
      if (candidate.Config?.Labels?.['org.brq.sandbox.ownership'] !== input.ownershipToken) {
        return { status: 'ABSENT' };
      }
      return typeof candidate.Id === 'string' && /^[a-f0-9]{12,64}$/u.test(candidate.Id)
        ? { status: 'OWNED', containerId: candidate.Id }
        : { status: 'UNCONFIRMED' };
    }
  } catch {
    // A filtered list below is the independent absence/ownership confirmation.
  }
  try {
    const filtered = await input.executor.execute({
      args: [
        'container',
        'ls',
        '--all',
        '--quiet',
        '--filter',
        `name=^/${input.containerName}$`,
        '--filter',
        `label=org.brq.sandbox.ownership=${input.ownershipToken}`,
      ],
      timeoutMs: input.limits.administrativeTimeoutMs,
      hardOutputBytes: ADMIN_OUTPUT_LIMIT,
      capturedOutputBytesPerStream: ADMIN_OUTPUT_LIMIT,
    });
    if (
      filtered.exitCode !== 0 ||
      filtered.timedOut ||
      filtered.cancelled ||
      filtered.outputLimitExceeded ||
      filtered.sourceCode !== null
    ) {
      return { status: 'UNCONFIRMED' };
    }
    const identifiers = filtered.stdout.value.trim().split(/\s+/u).filter(Boolean);
    if (identifiers.length === 0) return { status: 'ABSENT' };
    return identifiers.length === 1 && /^[a-f0-9]{12,64}$/u.test(identifiers[0] ?? '')
      ? { status: 'OWNED', containerId: identifiers[0]! }
      : { status: 'UNCONFIRMED' };
  } catch {
    return { status: 'UNCONFIRMED' };
  }
}

async function cleanupOwnedContainer(input: {
  readonly executor: DockerCommandExecutor;
  readonly limits: SandboxLimits;
  readonly containerId: string;
}): Promise<SandboxFailure | null> {
  try {
    const cleanup = await input.executor.execute({
      args: ['container', 'rm', '--force', '--volumes', input.containerId],
      timeoutMs: input.limits.administrativeTimeoutMs,
      hardOutputBytes: ADMIN_OUTPUT_LIMIT,
      capturedOutputBytesPerStream: ADMIN_OUTPUT_LIMIT,
    });
    if (
      cleanup.exitCode !== 0 ||
      cleanup.timedOut ||
      cleanup.cancelled ||
      cleanup.outputLimitExceeded ||
      cleanup.sourceCode !== null
    ) {
      throw new Error('cleanup failed');
    }
    const confirmation = await input.executor.execute({
      args: ['container', 'ls', '--all', '--quiet', '--filter', `id=${input.containerId}`],
      timeoutMs: input.limits.administrativeTimeoutMs,
      hardOutputBytes: ADMIN_OUTPUT_LIMIT,
      capturedOutputBytesPerStream: ADMIN_OUTPUT_LIMIT,
    });
    if (
      confirmation.exitCode !== 0 ||
      confirmation.stdout.value.trim().length > 0 ||
      confirmation.timedOut ||
      confirmation.cancelled ||
      confirmation.outputLimitExceeded ||
      confirmation.sourceCode !== null
    ) {
      throw new Error('cleanup not confirmed');
    }
    return null;
  } catch {
    return stableFailure({
      code: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
      stage: SANDBOX_RUNNER_ERROR_STAGES.CLEANUP,
      message: 'A remoção do container não pôde ser confirmada.',
      sourceCode: 'REMOVAL_NOT_CONFIRMED',
    });
  }
}

async function withinDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
  onTimeout?: () => void,
): Promise<T> {
  if (signal?.aborted === true) {
    throw new SandboxRunnerError('A execução foi cancelada.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
      stage: SANDBOX_RUNNER_ERROR_STAGES.INTEGRITY,
    });
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(
        new SandboxRunnerError('A execução excedeu o timeout total autorizado.', {
          code: SANDBOX_RUNNER_ERROR_CODES.TIMEOUT,
          stage: SANDBOX_RUNNER_ERROR_STAGES.INTEGRITY,
        }),
      );
    }, timeoutMs);
    timer.unref();
    const onAbort = () => {
      reject(
        new SandboxRunnerError('A execução foi cancelada.', {
          code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
          stage: SANDBOX_RUNNER_ERROR_STAGES.INTEGRITY,
        }),
      );
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function observeResourceOutcome(
  executor: DockerCommandExecutor,
  limits: SandboxLimits,
  containerId: string,
  timeoutMs: number,
): Promise<SandboxResourceOutcome> {
  try {
    const inspection = await administrativeCommand(
      executor,
      limits,
      ['container', 'inspect', '--format', '{{json .State}}', containerId],
      undefined,
      timeoutMs,
    );
    const state: unknown = JSON.parse(inspection.stdout.value);
    return state !== null &&
      typeof state === 'object' &&
      'OOMKilled' in state &&
      (state as { readonly OOMKilled?: unknown }).OOMKilled === true
      ? 'OOM'
      : 'NONE';
  } catch {
    return 'UNKNOWN';
  }
}

function terminalStep(input: {
  readonly stepId: SandboxStepId;
  readonly policy: SandboxExecutionPolicy;
  readonly limits: SandboxLimits;
  readonly started: number;
  readonly finished: number;
  readonly result: DockerCommandResult;
  readonly resourceOutcome: SandboxResourceOutcome;
  readonly hostPaths: readonly string[];
  readonly sensitiveValues: readonly string[];
}): SandboxStepResult {
  let status: SandboxStepResult['status'] = 'SUCCESS';
  let failure: SandboxFailure | null = null;
  let resourceOutcome = input.resourceOutcome;
  if (input.result.cancelled) {
    status = 'CANCELLED';
    failure = stableFailure({
      code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
      stage: stageFor(input.stepId),
      message: 'A etapa da sandbox foi cancelada.',
      sourceCode: input.result.sourceCode,
    });
  } else if (input.result.timedOut) {
    status = 'TIMEOUT';
    failure = stableFailure({
      code: SANDBOX_RUNNER_ERROR_CODES.TIMEOUT,
      stage: stageFor(input.stepId),
      message: 'A etapa excedeu o timeout autorizado.',
      sourceCode: input.result.sourceCode,
    });
  } else if (input.result.outputLimitExceeded) {
    status = 'FAILED';
    resourceOutcome = 'OUTPUT_LIMIT';
    failure = stableFailure({
      code: SANDBOX_RUNNER_ERROR_CODES.OUTPUT_LIMIT,
      stage: stageFor(input.stepId),
      message: 'A etapa excedeu o hard limit de output.',
      sourceCode: 'OUTPUT_LIMIT',
    });
  } else if (input.resourceOutcome === 'OOM') {
    status = 'FAILED';
    failure = stableFailure({
      code: SANDBOX_RUNNER_ERROR_CODES.RESOURCE_LIMIT,
      stage: stageFor(input.stepId),
      message: 'A etapa excedeu um limite de recursos.',
      sourceCode: 'OOM',
    });
  } else if (input.result.exitCode !== 0 || input.result.sourceCode !== null) {
    status = 'FAILED';
    failure = stableFailure({
      code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
      stage: stageFor(input.stepId),
      message: 'A etapa terminou com falha técnica.',
      sourceCode:
        input.result.sourceCode ??
        (input.result.exitCode === null ? 'NO_EXIT_CODE' : `EXIT_${input.result.exitCode}`),
    });
  }
  return Object.freeze({
    stepId: input.stepId,
    status,
    startedAt: isoTime(input.started),
    finishedAt: isoTime(input.finished),
    durationMs: Math.max(0, input.finished - input.started),
    exitCode: input.result.exitCode,
    timeoutMs: timeoutForStep(input.stepId, input.policy.steps[input.stepId], input.limits),
    stdout: summarizeOutput(
      input.result.stdout,
      input.limits,
      input.hostPaths,
      input.sensitiveValues,
    ),
    stderr: summarizeOutput(
      input.result.stderr,
      input.limits,
      input.hostPaths,
      input.sensitiveValues,
    ),
    resourceOutcome,
    failure,
  });
}

function immediateTerminalStep(input: {
  readonly stepId: SandboxStepId;
  readonly policy: SandboxExecutionPolicy;
  readonly limits: SandboxLimits;
  readonly at: number;
  readonly status: 'FAILED' | 'TIMEOUT' | 'CANCELLED';
  readonly failure: SandboxFailure;
}): SandboxStepResult {
  const emptyResult: DockerCommandResult = {
    exitCode: null,
    stdout: EMPTY_CAPTURE,
    stderr: EMPTY_CAPTURE,
    timedOut: input.status === 'TIMEOUT',
    cancelled: input.status === 'CANCELLED',
    outputLimitExceeded: false,
    sourceCode: null,
  };
  return Object.freeze({
    ...terminalStep({
      stepId: input.stepId,
      policy: input.policy,
      limits: input.limits,
      started: input.at,
      finished: input.at,
      result: emptyResult,
      resourceOutcome: 'NONE',
      hostPaths: [],
      sensitiveValues: [],
    }),
    status: input.status,
    failure: input.failure,
  });
}

export function createDockerSandboxRunnerWithDependencies(
  options: ResolvedDockerSandboxRunnerOptions,
  dependencies: DockerSandboxRunnerDependencies,
): SandboxRunner {
  const now = options.now ?? Date.now;
  const ceiling = resolveSandboxLimits({}, options.limitCeiling);
  let active = false;

  return Object.freeze({
    run: async (
      rawRequest: SandboxRunRequest,
      runOptions: SandboxRunOptions = {},
    ): Promise<SandboxRunResult> => {
      if (active) {
        throw new SandboxRunnerError('O runner Docker já possui uma execução ativa.', {
          code: SANDBOX_RUNNER_ERROR_CODES.CAPACITY_EXCEEDED,
          stage: SANDBOX_RUNNER_ERROR_STAGES.CAPACITY,
        });
      }
      active = true;
      try {
        const parsed = sandboxRunRequestSchema.safeParse(rawRequest);
        if (!parsed.success) {
          throw new SandboxRunnerError('A solicitação de sandbox é inválida.', {
            code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
            stage: SANDBOX_RUNNER_ERROR_STAGES.REQUEST_VALIDATION,
          });
        }
        const request = parsed.data;
        const policy = resolveSandboxPolicy(options.policies, request.policyId);
        if (Object.values(policy.steps).some((command) => !isStrictSandboxCommand(command))) {
          throw new SandboxRunnerError('A policy contém um comando não autorizado.', {
            code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
            stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
          });
        }
        const limits = resolveSandboxLimits(request.limits, ceiling);
        if (limits.memoryBytes < MINIMUM_DOCKER_MEMORY_BYTES) {
          throw new SandboxRunnerError('A memória solicitada é insuficiente para o runtime Node.', {
            code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
            stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
          });
        }
        if (isAborted(runOptions.signal)) {
          throw new SandboxRunnerError('A solicitação foi cancelada antes da execução.', {
            code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
            stage: SANDBOX_RUNNER_ERROR_STAGES.REQUEST_VALIDATION,
          });
        }
        const started = now();
        const workspaceScanController = new AbortController();
        const workspaceScanSignal =
          runOptions.signal === undefined
            ? workspaceScanController.signal
            : AbortSignal.any([runOptions.signal, workspaceScanController.signal]);
        const workspace = await withinDeadline(
          readAndVerifyWorkspace(options.workspaceRoot, request.workspace, workspaceScanSignal),
          limits.totalTimeoutMs,
          runOptions.signal,
          () => workspaceScanController.abort(),
        );
        const payload = createWorkspacePayload(workspace);
        const dockerDiagnosticSensitiveValues = Object.freeze([
          options.dockerHost,
          options.dockerHost.slice('unix://'.length),
          options.dockerExecutable,
        ]);

        const versionResult = await administrativeCommand(
          dependencies.executor,
          limits,
          ['version', '--format', '{{json .}}'],
          runOptions.signal,
          remainingTimeout(started, limits, now),
        );
        const imageResult = await administrativeCommand(
          dependencies.executor,
          limits,
          ['image', 'inspect', '--format', '{{json .}}', options.image.reference],
          runOptions.signal,
          remainingTimeout(started, limits, now),
        );
        const runtime = verifyDockerRuntimeAndImage({
          versionJson: versionResult.stdout.value,
          imageJson: imageResult.stdout.value,
          image: options.image,
          policy,
        });
        const policyHash = calculateSandboxPolicyHash(policy, runtime);
        const sandboxRequestHash = calculateSandboxRequestHash({
          request,
          effectiveLimits: limits,
          policyHash,
        });
        const sandboxRunId = deriveSandboxRunId(sandboxRequestHash);

        const containerName = `brq-${sandboxRunId}`;
        const ownershipToken = `${sandboxRunId}-${randomUUID()}`;
        let lifecycleFailure: SandboxFailure | null = null;
        let containerId: string | null = null;
        let createOwnershipUnconfirmed = false;
        try {
          createOwnershipUnconfirmed = true;
          const createResult = await dependencies.executor.execute({
            args: buildCreateContainerArguments({
              containerName,
              ownershipToken,
              imageReference: options.image.reference,
              limits,
            }),
            timeoutMs: remainingTimeout(started, limits, now),
            hardOutputBytes: ADMIN_OUTPUT_LIMIT,
            capturedOutputBytesPerStream: ADMIN_OUTPUT_LIMIT,
            ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
          });
          if (
            createResult.exitCode !== 0 ||
            createResult.timedOut ||
            createResult.cancelled ||
            createResult.outputLimitExceeded ||
            createResult.sourceCode !== null
          ) {
            const discovery = await discoverOwnedContainer({
              executor: dependencies.executor,
              limits,
              containerName,
              ownershipToken,
            });
            containerId = discovery.status === 'OWNED' ? discovery.containerId : null;
            createOwnershipUnconfirmed = discovery.status === 'UNCONFIRMED';
            throw administrativeFailure(createResult);
          }
          const candidateId = createResult.stdout.value.trim();
          if (!/^[a-f0-9]{12,64}$/u.test(candidateId)) {
            const discovery = await discoverOwnedContainer({
              executor: dependencies.executor,
              limits,
              containerName,
              ownershipToken,
            });
            containerId = discovery.status === 'OWNED' ? discovery.containerId : null;
            createOwnershipUnconfirmed = discovery.status === 'UNCONFIRMED';
            throw new SandboxRunnerError('O Docker não retornou um containerId seguro.', {
              code: SANDBOX_RUNNER_ERROR_CODES.START_FAILED,
              stage: SANDBOX_RUNNER_ERROR_STAGES.START,
              sourceCode: 'INVALID_CONTAINER_ID',
            });
          }
          containerId = candidateId;
          createOwnershipUnconfirmed = false;
          const inspection = await administrativeCommand(
            dependencies.executor,
            limits,
            ['container', 'inspect', '--format', '{{json .}}', containerId],
            runOptions.signal,
            remainingTimeout(started, limits, now),
          );
          verifyCreatedContainer(inspection.stdout.value, limits, ownershipToken);
          await administrativeCommand(
            dependencies.executor,
            limits,
            ['container', 'start', containerId],
            runOptions.signal,
            remainingTimeout(started, limits, now),
          );
          await administrativeCommand(
            dependencies.executor,
            limits,
            buildReadinessArguments(containerId),
            runOptions.signal,
            remainingTimeout(started, limits, now),
          );
        } catch (error) {
          const failure =
            error instanceof SandboxRunnerError
              ? error
              : new SandboxRunnerError('Não foi possível iniciar o container da sandbox.', {
                  code: SANDBOX_RUNNER_ERROR_CODES.START_FAILED,
                  stage: SANDBOX_RUNNER_ERROR_STAGES.START,
                });
          lifecycleFailure = stableFailure({
            code: failure.code,
            stage: failure.stage,
            message: 'Não foi possível iniciar a sandbox isolada.',
            sourceCode: failure.sourceCode ?? null,
          });
        }

        const steps: SandboxStepResult[] = [];
        let status: SandboxRunResult['status'] = lifecycleFailure === null ? 'SUCCESS' : 'FAILED';
        let failure = lifecycleFailure;
        let resourceOutcome: SandboxResourceOutcome = 'NONE';
        let cleanupFailure: SandboxFailure | null = null;
        try {
          if (containerId !== null && lifecycleFailure === null) {
            safeLog(() =>
              logSandboxEvent(
                options.logger,
                'info',
                'sandbox.run.started',
                sandboxLogContext({
                  sandboxRunId,
                  executionId: request.context.executionId,
                  workspaceId: request.workspace.workspaceId,
                  policyId: policy.policyId,
                }),
              ),
            );
            for (const stepId of SANDBOX_STEP_IDS) {
              const command = policy.steps[stepId];
              const stepStarted = now();
              const elapsed = Math.max(0, stepStarted - started);
              const missingRequiredFile = command.requiredFiles.find(
                (required) => !workspace.files.some((file) => file.path === required),
              );
              let step: SandboxStepResult;
              safeLog(() =>
                logSandboxEvent(
                  options.logger,
                  'info',
                  'sandbox.step.started',
                  sandboxLogContext({
                    sandboxRunId,
                    executionId: request.context.executionId,
                    workspaceId: request.workspace.workspaceId,
                    policyId: policy.policyId,
                    stepId,
                  }),
                ),
              );
              if (isAborted(runOptions.signal)) {
                step = immediateTerminalStep({
                  stepId,
                  policy,
                  limits,
                  at: stepStarted,
                  status: 'CANCELLED',
                  failure: stableFailure({
                    code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
                    stage: stageFor(stepId),
                    message: 'A etapa foi cancelada antes de iniciar.',
                  }),
                });
              } else if (elapsed >= limits.totalTimeoutMs) {
                step = immediateTerminalStep({
                  stepId,
                  policy,
                  limits,
                  at: stepStarted,
                  status: 'TIMEOUT',
                  failure: stableFailure({
                    code: SANDBOX_RUNNER_ERROR_CODES.TIMEOUT,
                    stage: stageFor(stepId),
                    message: 'A execução excedeu o timeout total autorizado.',
                  }),
                });
              } else if (missingRequiredFile !== undefined) {
                step = immediateTerminalStep({
                  stepId,
                  policy,
                  limits,
                  at: stepStarted,
                  status: 'FAILED',
                  failure: stableFailure({
                    code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
                    stage: stageFor(stepId),
                    message: 'A etapa exige um arquivo ausente no workspace.',
                    sourceCode: 'REQUIRED_FILE_MISSING',
                  }),
                });
              } else {
                const timeoutMs = Math.max(
                  1,
                  Math.min(
                    timeoutForStep(stepId, command, limits),
                    limits.totalTimeoutMs - elapsed,
                  ),
                );
                let commandResult: DockerCommandResult;
                try {
                  commandResult = await dependencies.executor.execute({
                    args: buildExecArguments({
                      containerId,
                      policy: command,
                      interactive: stepId === 'PREPARE',
                      memoryBytes: limits.memoryBytes,
                    }),
                    ...(stepId === 'PREPARE' ? { input: payload } : {}),
                    timeoutMs,
                    hardOutputBytes: limits.hardOutputBytesPerStep,
                    capturedOutputBytesPerStream: limits.capturedOutputBytesPerStream,
                    ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
                  });
                } catch {
                  commandResult = {
                    exitCode: null,
                    stdout: EMPTY_CAPTURE,
                    stderr: EMPTY_CAPTURE,
                    timedOut: false,
                    cancelled: false,
                    outputLimitExceeded: false,
                    sourceCode: 'DOCKER_EXEC_FAILED',
                  };
                }
                const observedResource =
                  commandResult.exitCode !== 0 &&
                  !commandResult.cancelled &&
                  !commandResult.timedOut &&
                  !commandResult.outputLimitExceeded
                    ? await observeResourceOutcome(
                        dependencies.executor,
                        limits,
                        containerId,
                        Math.max(
                          1,
                          Math.min(
                            limits.administrativeTimeoutMs,
                            limits.totalTimeoutMs - Math.max(0, now() - started),
                          ),
                        ),
                      )
                    : 'NONE';
                step = terminalStep({
                  stepId,
                  policy,
                  limits,
                  started: stepStarted,
                  finished: now(),
                  result: commandResult,
                  resourceOutcome: observedResource,
                  hostPaths: [options.workspaceRoot],
                  sensitiveValues: dockerDiagnosticSensitiveValues,
                });
              }
              steps.push(step);
              safeLog(() =>
                logSandboxEvent(
                  options.logger,
                  step.status === 'SUCCESS' ? 'info' : 'error',
                  step.status === 'SUCCESS' ? 'sandbox.step.completed' : 'sandbox.step.failed',
                  sandboxLogContext({
                    sandboxRunId,
                    executionId: request.context.executionId,
                    workspaceId: request.workspace.workspaceId,
                    policyId: policy.policyId,
                    stepId,
                    durationMs: step.durationMs ?? 0,
                    exitCode: step.exitCode,
                    observedBytes:
                      (step.stdout?.observedBytes ?? 0) + (step.stderr?.observedBytes ?? 0),
                    truncated:
                      (step.stdout?.truncated ?? false) || (step.stderr?.truncated ?? false),
                    resourceOutcome: step.resourceOutcome,
                    ...(step.failure === null ? {} : { failure: step.failure }),
                  }),
                ),
              );
              if (step.status !== 'SUCCESS') {
                status =
                  step.status === 'TIMEOUT' || step.status === 'CANCELLED' ? step.status : 'FAILED';
                failure = step.failure;
                resourceOutcome = step.resourceOutcome;
                break;
              }
            }
            if (
              status === 'SUCCESS' &&
              steps.length === SANDBOX_STEP_IDS.length &&
              dependencies.artifactSink !== undefined
            ) {
              await capturePreviewArtifact({
                executor: dependencies.executor,
                sink: dependencies.artifactSink,
                correlation: Object.freeze({
                  executionId: request.context.executionId,
                  workspaceId: request.workspace.workspaceId,
                  workspaceHash: request.workspace.metadata.workspaceHash,
                  policyId: policy.policyId,
                  sandboxRequestHash,
                }),
                containerId,
                ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
              });
            }
          } else if (
            lifecycleFailure?.code === SANDBOX_RUNNER_ERROR_CODES.CANCELLED ||
            lifecycleFailure?.code === SANDBOX_RUNNER_ERROR_CODES.TIMEOUT
          ) {
            status =
              lifecycleFailure.code === SANDBOX_RUNNER_ERROR_CODES.CANCELLED
                ? 'CANCELLED'
                : 'TIMEOUT';
            steps.push(
              immediateTerminalStep({
                stepId: 'PREPARE',
                policy,
                limits,
                at: now(),
                status,
                failure: lifecycleFailure,
              }),
            );
          }
          for (const stepId of SANDBOX_STEP_IDS.slice(steps.length)) {
            steps.push(skippedStep(stepId, policy, limits));
          }
        } finally {
          cleanupFailure =
            containerId === null
              ? createOwnershipUnconfirmed
                ? stableFailure({
                    code: SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED,
                    stage: SANDBOX_RUNNER_ERROR_STAGES.CLEANUP,
                    message: 'A ausência de container órfão não pôde ser confirmada.',
                    sourceCode: 'OWNERSHIP_NOT_CONFIRMED',
                  })
                : null
              : await cleanupOwnedContainer({
                  executor: dependencies.executor,
                  limits,
                  containerId,
                });
        }
        if (cleanupFailure !== null) {
          safeLog(() =>
            logSandboxEvent(
              options.logger,
              'error',
              'sandbox.cleanup.failed',
              sandboxLogContext({
                sandboxRunId,
                executionId: request.context.executionId,
                workspaceId: request.workspace.workspaceId,
                policyId: policy.policyId,
                failure: cleanupFailure,
              }),
            ),
          );
        }
        if (cleanupFailure !== null) {
          status = 'FAILED';
          failure = stableFailure({
            code: cleanupFailure.code,
            stage: cleanupFailure.stage,
            message: cleanupFailure.message,
            sourceCode: failure?.code ?? cleanupFailure.sourceCode,
          });
        }

        const finished = now();
        const result = finalizeSandboxRunResult({
          request,
          policy,
          effectiveLimits: limits,
          runtime,
          status,
          startedAt: isoTime(started),
          finishedAt: isoTime(finished),
          durationMs: Math.max(0, finished - started),
          steps,
          resourceOutcome,
          failure,
        });
        safeLog(() =>
          logSandboxEvent(
            options.logger,
            result.status === 'SUCCESS' ? 'info' : 'error',
            result.status === 'SUCCESS'
              ? 'sandbox.run.completed'
              : result.status === 'CANCELLED'
                ? 'sandbox.run.cancelled'
                : 'sandbox.run.failed',
            sandboxLogContext({
              sandboxRunId: result.sandboxRunId,
              executionId: result.context.executionId,
              workspaceId: result.workspace.workspaceId,
              policyId: result.provenance.policyId,
              status: result.status,
              durationMs: result.durationMs,
              resourceOutcome: result.resourceOutcome,
              hashes: result.hashes,
              ...(result.failure === null ? {} : { failure: result.failure }),
            }),
          ),
        );
        return result;
      } finally {
        active = false;
      }
    },
  });
}
