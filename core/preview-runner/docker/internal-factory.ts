import { randomUUID } from 'node:crypto';

import {
  approvedPreviewArtifactSchema,
  previewArtifactExportEnvelopeSchema,
  projectApprovedPreviewArtifactDescriptor,
  type ApprovedPreviewArtifact,
  type PreviewArtifactContentStore,
} from '@brq/preview-artifact';

import type {
  ApprovedPreviewStartRequest,
  PreviewInspectRequest,
  PreviewRunnerOptions,
  PreviewRuntimeInspection,
  PreviewRuntimeObservation,
  PreviewRuntimeResult,
  PreviewStopRequest,
  PreviewStopResult,
} from '../contracts';
import {
  PREVIEW_RUNNER_ERROR_CODES,
  PREVIEW_RUNNER_ERROR_STAGES,
  PreviewRunnerError,
  type PreviewRunnerErrorCode,
  type PreviewRunnerErrorStage,
} from '../errors';
import { calculatePreviewRuntimeHash } from '../hashing';
import { PREVIEW_ABSOLUTE_LIMITS } from '../limits';
import {
  approvedPreviewStartRequestSchema,
  previewInspectRequestSchema,
  previewRuntimeInspectionSchema,
  previewRuntimeResultSchema,
  previewStopRequestSchema,
  previewStopResultSchema,
} from '../schemas';
import {
  buildCreateNetworkArguments,
  buildCreatePreviewContainerArguments,
  buildPrepareArguments,
  buildStartServerArguments,
} from './command-builder';
import type { ResolvedDockerPreviewRunnerOptions } from './configuration';
import type { DockerCommandExecutor, DockerCommandResult } from './docker-cli';
import type { PreviewHealthProbe } from './health-probe';
import type { PreviewLoopbackRelay, PreviewLoopbackRelayFactory } from './loopback-relay';
import {
  verifyCreatedPreviewContainer,
  verifyDockerRuntimeAndImage,
  verifyPreviewNetwork,
  verifyRunningPreviewContainer,
} from './verifier';

const ADMIN_OUTPUT_BYTES = 1024 * 1024;
const ARTIFACT_CHANNEL_BYTES = 1536 * 1024;
const SAFE_CONTAINER_ID = /^[a-f0-9]{12,64}$/u;
const SAFE_ACCESS_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const SAFE_OWNERSHIP_TOKEN = /^[A-Za-z0-9_-]{16,128}$/u;
const INSPECTION_HEALTH_ATTEMPTS = 3;
const INSPECTION_HEALTH_BUDGET_MS = 5_000;

type DockerResourceKind = 'container' | 'network';
type DockerInspectionState = 'PRESENT' | 'ABSENT' | 'INDETERMINATE';

export interface DockerPreviewGatewayTarget {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly expiresAt: string;
  readonly accessToken: string;
}

export interface DockerPreviewRunner {
  start(
    request: ApprovedPreviewStartRequest,
    options?: PreviewRunnerOptions,
  ): Promise<PreviewRuntimeResult>;
  inspect(request: PreviewInspectRequest): Promise<PreviewRuntimeInspection>;
  stop(request: PreviewStopRequest, options?: PreviewRunnerOptions): Promise<PreviewStopResult>;
  resolveGatewayTarget(request: PreviewInspectRequest): DockerPreviewGatewayTarget | null;
}

interface ActiveRuntime {
  readonly previewId: string;
  readonly executionId: string;
  readonly artifactId: string | null;
  readonly containerId: string;
  readonly containerName: string;
  readonly networkName: string;
  readonly ownershipToken: string;
  readonly relay: PreviewLoopbackRelay | null;
  readonly target: DockerPreviewGatewayTarget;
  readonly runtime: PreviewRuntimeObservation;
  readonly stopTimeoutMs: number;
}

interface RediscoveredRuntime {
  readonly runtime: ActiveRuntime;
  readonly healthy: boolean;
}

type PreviewRediscoveryExpectation = NonNullable<PreviewInspectRequest['expected']>;

type CleanupRuntime = Pick<
  ActiveRuntime,
  | 'previewId'
  | 'executionId'
  | 'artifactId'
  | 'containerId'
  | 'containerName'
  | 'networkName'
  | 'ownershipToken'
  | 'relay'
  | 'stopTimeoutMs'
>;

export interface DockerPreviewRunnerDependencies {
  readonly executor: DockerCommandExecutor;
  readonly healthProbe: PreviewHealthProbe;
  readonly createRelay: PreviewLoopbackRelayFactory;
  readonly randomId?: () => string;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function isoTime(value: number): string {
  return new Date(value).toISOString();
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function runnerError(input: {
  readonly message: string;
  readonly code: PreviewRunnerErrorCode;
  readonly stage: PreviewRunnerErrorStage;
  readonly previewId?: string;
  readonly sourceCode?: string;
  readonly cause?: unknown;
}): PreviewRunnerError {
  return new PreviewRunnerError(input.message, {
    code: input.code,
    stage: input.stage,
    ...(input.previewId === undefined ? {} : { previewId: input.previewId }),
    ...(input.sourceCode === undefined ? {} : { sourceCode: input.sourceCode }),
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

function failureForCommand(
  result: DockerCommandResult,
  input: {
    readonly previewId: string;
    readonly code: PreviewRunnerErrorCode;
    readonly stage: PreviewRunnerErrorStage;
  },
): PreviewRunnerError | null {
  if (result.cancelled) {
    return runnerError({
      message: 'A operação do Preview foi cancelada.',
      code: PREVIEW_RUNNER_ERROR_CODES.CANCELLED,
      stage: input.stage,
      previewId: input.previewId,
      ...(result.sourceCode === null ? {} : { sourceCode: result.sourceCode }),
    });
  }
  if (result.timedOut) {
    return runnerError({
      message: 'A operação Docker do Preview excedeu o timeout.',
      code:
        input.stage === PREVIEW_RUNNER_ERROR_STAGES.START
          ? PREVIEW_RUNNER_ERROR_CODES.START_TIMEOUT
          : input.code,
      stage: input.stage,
      previewId: input.previewId,
      ...(result.sourceCode === null ? {} : { sourceCode: result.sourceCode }),
    });
  }
  if (result.exitCode !== 0 || result.outputLimitExceeded || result.sourceCode !== null) {
    return runnerError({
      message: 'O runtime Docker do Preview rejeitou uma operação fixa.',
      code: input.code,
      stage: input.stage,
      previewId: input.previewId,
      sourceCode:
        result.sourceCode ??
        (result.outputLimitExceeded
          ? 'OUTPUT_LIMIT'
          : result.exitCode === null
            ? 'NO_EXIT_CODE'
            : `EXIT_${result.exitCode}`),
    });
  }
  return null;
}

async function requiredCommand(input: {
  readonly executor: DockerCommandExecutor;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly previewId: string;
  readonly code: PreviewRunnerErrorCode;
  readonly stage: PreviewRunnerErrorStage;
  readonly outputLimitBytes?: number;
  readonly payload?: Buffer;
  readonly signal?: AbortSignal;
}): Promise<DockerCommandResult> {
  let result: DockerCommandResult;
  try {
    result = await input.executor.execute({
      args: input.args,
      timeoutMs: input.timeoutMs,
      outputLimitBytes: input.outputLimitBytes ?? ADMIN_OUTPUT_BYTES,
      ...(input.payload === undefined ? {} : { input: input.payload }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  } catch (error) {
    throw runnerError({
      message: 'O runtime Docker do Preview não está disponível.',
      code: PREVIEW_RUNNER_ERROR_CODES.RUNTIME_UNAVAILABLE,
      stage: input.stage,
      previewId: input.previewId,
      sourceCode: 'DOCKER_COMMAND_REJECTED',
      cause: error,
    });
  }
  const failure = failureForCommand(result, input);
  if (failure !== null) throw failure;
  return result;
}

function remaining(deadline: number): number {
  const value = deadline - Date.now();
  if (value <= 0) {
    throw runnerError({
      message: 'O startup do Preview excedeu o timeout total.',
      code: PREVIEW_RUNNER_ERROR_CODES.START_TIMEOUT,
      stage: PREVIEW_RUNNER_ERROR_STAGES.START,
    });
  }
  return value;
}

function serializeArtifact(artifact: ApprovedPreviewArtifact): Buffer {
  const envelope = previewArtifactExportEnvelopeSchema.parse({
    abiVersion: '1.0.0',
    profileId: artifact.metadata.profileId,
    exporterVersion: artifact.metadata.exporterVersion,
    files: artifact.files.map(({ path, content, mediaType }) => ({ path, content, mediaType })),
  });
  const payload = Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');
  if (payload.byteLength > ARTIFACT_CHANNEL_BYTES) {
    throw runnerError({
      message: 'O PreviewArtifact excede o canal privado do runtime.',
      code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_UNAVAILABLE,
      stage: PREVIEW_RUNNER_ERROR_STAGES.ARTIFACT,
    });
  }
  return payload;
}

function descriptorMatches(
  artifact: ApprovedPreviewArtifact,
  request: ApprovedPreviewStartRequest,
): boolean {
  const descriptor = projectApprovedPreviewArtifactDescriptor(artifact);
  return JSON.stringify(descriptor) === JSON.stringify(request.artifact);
}

function safeTarget(
  port: number,
  accessToken: string,
  expiresAt: string,
): DockerPreviewGatewayTarget {
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !SAFE_ACCESS_TOKEN.test(accessToken)
  ) {
    throw new Error('UNSAFE_GATEWAY_TARGET');
  }
  return Object.freeze({ host: '127.0.0.1' as const, port, expiresAt, accessToken });
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_DOCKER_INSPECTION');
  }
  return value as Record<string, unknown>;
}

function resourceLabels(value: Record<string, unknown>, nested: boolean): Record<string, unknown> {
  const source = nested ? parseObject(value.Config) : value;
  return parseObject(source.Labels);
}

async function observeRuntime(input: {
  readonly executor: DockerCommandExecutor;
  readonly options: ResolvedDockerPreviewRunnerOptions;
  readonly previewId: string;
  readonly policy: ApprovedPreviewStartRequest['policy'];
  readonly deadline: number;
  readonly signal?: AbortSignal;
}): Promise<PreviewRuntimeObservation> {
  const version = await requiredCommand({
    executor: input.executor,
    args: ['version', '--format', '{{json .}}'],
    timeoutMs: remaining(input.deadline),
    previewId: input.previewId,
    code: PREVIEW_RUNNER_ERROR_CODES.RUNTIME_UNAVAILABLE,
    stage: PREVIEW_RUNNER_ERROR_STAGES.IMAGE,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const image = await requiredCommand({
    executor: input.executor,
    args: ['image', 'inspect', '--format', '{{json .}}', input.options.image.reference],
    timeoutMs: remaining(input.deadline),
    previewId: input.previewId,
    code: PREVIEW_RUNNER_ERROR_CODES.IMAGE_VERIFICATION_FAILED,
    stage: PREVIEW_RUNNER_ERROR_STAGES.IMAGE,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  try {
    return verifyDockerRuntimeAndImage({
      versionJson: version.stdout,
      imageJson: image.stdout,
      image: input.options.image,
      policy: input.policy,
    });
  } catch (error) {
    throw runnerError({
      message: 'A identidade da imagem Docker de Preview não foi confirmada.',
      code: PREVIEW_RUNNER_ERROR_CODES.IMAGE_VERIFICATION_FAILED,
      stage: PREVIEW_RUNNER_ERROR_STAGES.IMAGE,
      previewId: input.previewId,
      sourceCode: 'IMAGE_IDENTITY_MISMATCH',
      cause: error,
    });
  }
}

function expectedMissingResourceMessage(
  kind: DockerResourceKind,
  identifier: string,
): readonly string[] {
  return kind === 'container'
    ? [`No such container: ${identifier}`, `No such object: ${identifier}`]
    : [`network ${identifier} not found`, `No such network: ${identifier}`];
}

function isExpectedMissingResourceError(
  result: DockerCommandResult,
  kind: DockerResourceKind,
  identifier: string,
): boolean {
  if (
    result.exitCode !== 1 ||
    result.timedOut ||
    result.cancelled ||
    result.outputLimitExceeded ||
    result.sourceCode !== null ||
    !['', '[]'].includes(result.stdout.trim())
  ) {
    return false;
  }
  const stderr = result.stderr.trim();
  const messages = expectedMissingResourceMessage(kind, identifier);
  if (messages.some((message) => stderr === `Error: ${message}`)) return true;
  const daemonPrefix = 'Error response from daemon: ';
  if (!stderr.startsWith(daemonPrefix)) return false;
  const daemonResponse = stderr.slice(daemonPrefix.length);
  if (messages.includes(daemonResponse)) return true;
  try {
    const parsed = JSON.parse(daemonResponse) as unknown;
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 &&
      typeof (parsed as { readonly message?: unknown }).message === 'string' &&
      messages.includes((parsed as { readonly message: string }).message)
    );
  } catch {
    return false;
  }
}

function classifyResourceInspection(
  result: DockerCommandResult,
  kind: DockerResourceKind,
  identifier: string,
): DockerInspectionState {
  if (
    result.exitCode === 0 &&
    !result.timedOut &&
    !result.cancelled &&
    !result.outputLimitExceeded &&
    result.sourceCode === null
  ) {
    return 'PRESENT';
  }
  return isExpectedMissingResourceError(result, kind, identifier) ? 'ABSENT' : 'INDETERMINATE';
}

async function removeAndConfirm(input: {
  readonly executor: DockerCommandExecutor;
  readonly kind: DockerResourceKind;
  readonly identifier: string;
  readonly timeoutMs: number;
}): Promise<boolean> {
  try {
    await input.executor.execute({
      args:
        input.kind === 'container'
          ? ['container', 'rm', '--force', '--volumes', input.identifier]
          : ['network', 'rm', input.identifier],
      timeoutMs: input.timeoutMs,
      outputLimitBytes: ADMIN_OUTPUT_BYTES,
    });
  } catch {
    // Absence is confirmed only by the independent inspection below.
  }
  try {
    const inspection = await input.executor.execute({
      args: [input.kind, 'inspect', '--format', '{{json .}}', input.identifier],
      timeoutMs: input.timeoutMs,
      outputLimitBytes: ADMIN_OUTPUT_BYTES,
    });
    return classifyResourceInspection(inspection, input.kind, input.identifier) === 'ABSENT';
  } catch {
    return false;
  }
}

async function cleanupAttempt(operation: () => Promise<boolean>): Promise<boolean> {
  try {
    return await operation();
  } catch {
    return false;
  }
}

async function removeArtifact(
  contentStore: PreviewArtifactContentStore,
  artifactId: string | null,
  at: string,
): Promise<boolean> {
  if (artifactId === null) return true;
  try {
    const descriptor = await contentStore.remove(artifactId, at);
    return descriptor === null || descriptor.status === 'DELETED';
  } catch {
    return false;
  }
}

export function createDockerPreviewRunnerWithDependencies(
  options: ResolvedDockerPreviewRunnerOptions,
  dependencies: DockerPreviewRunnerDependencies,
): DockerPreviewRunner {
  const now = options.now ?? Date.now;
  const randomId = dependencies.randomId ?? randomUUID;
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const active = new Map<string, ActiveRuntime>();
  const starting = new Set<string>();
  const cleanupPromises = new Map<string, Promise<boolean>>();
  const rediscoveryPromises = new Map<string, Promise<RediscoveredRuntime | null>>();

  const confirmHealth = async (input: {
    readonly target: DockerPreviewGatewayTarget;
    readonly path: string;
    readonly expectedBody: string;
    readonly budgetMs: number;
  }): Promise<boolean> => {
    const deadline = Date.now() + Math.min(input.budgetMs, INSPECTION_HEALTH_BUDGET_MS);
    for (let attempt = 0; attempt < INSPECTION_HEALTH_ATTEMPTS; attempt += 1) {
      const timeoutMs = Math.max(1, Math.min(1_000, deadline - Date.now()));
      let healthy = false;
      try {
        healthy = await dependencies.healthProbe.check({
          host: input.target.host,
          port: input.target.port,
          path: input.path,
          expectedBody: input.expectedBody,
          timeoutMs,
          accessToken: input.target.accessToken,
        });
      } catch {
        healthy = false;
      }
      if (healthy) return true;
      if (attempt + 1 >= INSPECTION_HEALTH_ATTEMPTS || Date.now() >= deadline) break;
      await sleep(Math.max(1, Math.min(100, deadline - Date.now())));
    }
    return false;
  };

  const cleanup = (runtime: CleanupRuntime): Promise<boolean> => {
    const existing = cleanupPromises.get(runtime.previewId);
    if (existing !== undefined) return existing;
    const operation = (async () => {
      const relayRemoved = await cleanupAttempt(async () =>
        runtime.relay === null ? true : runtime.relay.close(),
      );
      const containerRemoved = await cleanupAttempt(() =>
        removeAndConfirm({
          executor: dependencies.executor,
          kind: 'container',
          identifier: runtime.containerId,
          timeoutMs: runtime.stopTimeoutMs,
        }),
      );
      const networkRemoved = await cleanupAttempt(() =>
        removeAndConfirm({
          executor: dependencies.executor,
          kind: 'network',
          identifier: runtime.networkName,
          timeoutMs: runtime.stopTimeoutMs,
        }),
      );
      const artifactRemoved = await cleanupAttempt(() =>
        removeArtifact(options.contentStore, runtime.artifactId, isoTime(now())),
      );
      if (relayRemoved && containerRemoved && networkRemoved && artifactRemoved) {
        active.delete(runtime.previewId);
      }
      return relayRemoved && containerRemoved && networkRemoved && artifactRemoved;
    })();
    cleanupPromises.set(runtime.previewId, operation);
    return operation;
  };

  const discoverOwnedOrphan = async (
    request: PreviewStopRequest,
  ): Promise<CleanupRuntime | null> => {
    const containerName = `brq-${request.previewId}`;
    const networkName = `brq-net-${request.previewId}`;
    const inspect = async (kind: DockerResourceKind, identifier: string) =>
      dependencies.executor.execute({
        args: [kind, 'inspect', '--format', '{{json .}}', identifier],
        timeoutMs: PREVIEW_ABSOLUTE_LIMITS.stopTimeoutMs,
        outputLimitBytes: ADMIN_OUTPUT_BYTES,
      });
    let containerResult: DockerCommandResult;
    let networkResult: DockerCommandResult;
    try {
      [containerResult, networkResult] = await Promise.all([
        inspect('container', containerName),
        inspect('network', networkName),
      ]);
    } catch (error) {
      throw runnerError({
        message: 'A inspeção de recursos órfãos do Preview falhou.',
        code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
        stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
        previewId: request.previewId,
        sourceCode: 'ORPHAN_INSPECTION_FAILED',
        cause: error,
      });
    }
    const containerState = classifyResourceInspection(containerResult, 'container', containerName);
    const networkState = classifyResourceInspection(networkResult, 'network', networkName);
    if (containerState === 'INDETERMINATE' || networkState === 'INDETERMINATE') {
      throw runnerError({
        message: 'A ausência de recursos órfãos do Preview não pôde ser confirmada.',
        code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
        stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
        previewId: request.previewId,
        sourceCode: 'ORPHAN_INSPECTION_INDETERMINATE',
      });
    }
    const containerPresent = containerState === 'PRESENT';
    const networkPresent = networkState === 'PRESENT';
    if (!containerPresent && !networkPresent) return null;
    try {
      const container = containerPresent ? parseObject(JSON.parse(containerResult.stdout)) : null;
      const network = networkPresent ? parseObject(JSON.parse(networkResult.stdout)) : null;
      const containerLabels = container === null ? null : resourceLabels(container, true);
      const networkLabels = network === null ? null : resourceLabels(network, false);
      for (const labels of [containerLabels, networkLabels]) {
        if (
          labels !== null &&
          (labels['org.brq.preview.managed'] !== '1' ||
            labels['org.brq.preview.id'] !== request.previewId ||
            labels['org.brq.preview.execution'] !== request.executionId ||
            typeof labels['org.brq.preview.artifact'] !== 'string' ||
            !/^preview-artifact-[a-f0-9]{32}$/u.test(labels['org.brq.preview.artifact']) ||
            typeof labels['org.brq.preview.ownership'] !== 'string' ||
            labels['org.brq.preview.ownership'].length < 16)
        ) {
          throw new Error('ORPHAN_OWNERSHIP_MISMATCH');
        }
      }
      const containerOwnership = containerLabels?.['org.brq.preview.ownership'];
      const networkOwnership = networkLabels?.['org.brq.preview.ownership'];
      const containerArtifact = containerLabels?.['org.brq.preview.artifact'];
      const networkArtifact = networkLabels?.['org.brq.preview.artifact'];
      if (
        containerOwnership !== undefined &&
        networkOwnership !== undefined &&
        containerOwnership !== networkOwnership
      ) {
        throw new Error('ORPHAN_OWNERSHIP_MISMATCH');
      }
      if (
        containerArtifact !== undefined &&
        networkArtifact !== undefined &&
        containerArtifact !== networkArtifact
      ) {
        throw new Error('ORPHAN_ARTIFACT_MISMATCH');
      }
      const ownershipToken = String(containerOwnership ?? networkOwnership);
      const artifactId = String(containerArtifact ?? networkArtifact);
      if (network !== null) {
        verifyPreviewNetwork({
          inspectionJson: networkResult.stdout,
          ownershipToken,
          previewId: request.previewId,
          executionId: request.executionId,
          artifactId,
        });
      }
      if (container !== null) {
        const containerId = container.Id;
        const host = parseObject(container.HostConfig);
        if (!SAFE_CONTAINER_ID.test(String(containerId)) || host.NetworkMode !== networkName) {
          throw new Error('ORPHAN_CONTAINER_MISMATCH');
        }
      }
      return Object.freeze({
        previewId: request.previewId,
        executionId: request.executionId,
        artifactId,
        containerId: container === null ? containerName : String(container.Id),
        containerName,
        networkName,
        ownershipToken,
        relay: null,
        stopTimeoutMs: PREVIEW_ABSOLUTE_LIMITS.stopTimeoutMs,
      });
    } catch (error) {
      throw runnerError({
        message: 'Um recurso órfão não possui ownership íntegro e não será removido.',
        code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
        stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
        previewId: request.previewId,
        sourceCode: 'ORPHAN_OWNERSHIP_MISMATCH',
        cause: error,
      });
    }
  };

  const rediscoverActiveRuntime = (
    request: PreviewInspectRequest & { readonly expected: PreviewRediscoveryExpectation },
  ): Promise<RediscoveredRuntime | null> => {
    const rediscoveryKey = [
      request.previewId,
      request.executionId,
      request.expected.previewSessionHash,
      String(request.expected.sessionRevision),
    ].join(':');
    const pending = rediscoveryPromises.get(rediscoveryKey);
    if (pending !== undefined) return pending;
    const operation = (async (): Promise<RediscoveredRuntime | null> => {
      const containerName = `brq-${request.previewId}`;
      const networkName = `brq-net-${request.previewId}`;
      const inspectResource = async (kind: DockerResourceKind, identifier: string) => {
        try {
          return await dependencies.executor.execute({
            args: [kind, 'inspect', '--format', '{{json .}}', identifier],
            timeoutMs: request.expected.limits.stopTimeoutMs,
            outputLimitBytes: ADMIN_OUTPUT_BYTES,
          });
        } catch (error) {
          throw runnerError({
            message: 'A redescoberta do runtime de Preview falhou.',
            code: PREVIEW_RUNNER_ERROR_CODES.RUNTIME_LOST,
            stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
            previewId: request.previewId,
            sourceCode: 'RUNTIME_REDISCOVERY_INSPECTION_FAILED',
            cause: error,
          });
        }
      };
      const [containerResult, networkResult] = await Promise.all([
        inspectResource('container', containerName),
        inspectResource('network', networkName),
      ]);
      const containerState = classifyResourceInspection(
        containerResult,
        'container',
        containerName,
      );
      const networkState = classifyResourceInspection(networkResult, 'network', networkName);
      if (containerState === 'ABSENT' && networkState === 'ABSENT') return null;
      if (containerState === 'INDETERMINATE' || networkState === 'INDETERMINATE') {
        throw runnerError({
          message: 'A existência do runtime de Preview não pôde ser confirmada.',
          code: PREVIEW_RUNNER_ERROR_CODES.RUNTIME_LOST,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          previewId: request.previewId,
          sourceCode: 'RUNTIME_REDISCOVERY_INDETERMINATE',
        });
      }
      if (containerState !== 'PRESENT' || networkState !== 'PRESENT') {
        throw runnerError({
          message: 'Os recursos do runtime de Preview estão incompletos.',
          code: PREVIEW_RUNNER_ERROR_CODES.RUNTIME_LOST,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          previewId: request.previewId,
          sourceCode: 'RUNTIME_REDISCOVERY_PARTIAL',
        });
      }

      let container: Record<string, unknown>;
      let ownershipToken: string;
      try {
        container = parseObject(JSON.parse(containerResult.stdout));
        const network = parseObject(JSON.parse(networkResult.stdout));
        const containerLabels = resourceLabels(container, true);
        const networkLabels = resourceLabels(network, false);
        const expectedExpires = String(Math.floor(Date.parse(request.expected.expiresAt) / 1_000));
        const containerOwnership = containerLabels['org.brq.preview.ownership'];
        const networkOwnership = networkLabels['org.brq.preview.ownership'];
        for (const labels of [containerLabels, networkLabels]) {
          if (
            labels['org.brq.preview.managed'] !== '1' ||
            labels['org.brq.preview.id'] !== request.previewId ||
            labels['org.brq.preview.execution'] !== request.executionId ||
            labels['org.brq.preview.artifact'] !== request.expected.artifactId
          ) {
            throw new Error('RUNTIME_REDISCOVERY_LABEL_MISMATCH');
          }
        }
        if (
          typeof containerOwnership !== 'string' ||
          typeof networkOwnership !== 'string' ||
          !SAFE_OWNERSHIP_TOKEN.test(containerOwnership) ||
          containerOwnership !== networkOwnership ||
          containerLabels['org.brq.preview.expires'] !== expectedExpires
        ) {
          throw new Error('RUNTIME_REDISCOVERY_OWNERSHIP_MISMATCH');
        }
        ownershipToken = containerOwnership;
        verifyPreviewNetwork({
          inspectionJson: networkResult.stdout,
          ownershipToken,
          previewId: request.previewId,
          executionId: request.executionId,
          artifactId: request.expected.artifactId,
        });
        const containerId = String(container.Id);
        const config = parseObject(container.Config);
        if (
          !SAFE_CONTAINER_ID.test(containerId) ||
          container.Image !== options.image.expectedImageId ||
          config.Image !== options.image.reference
        ) {
          throw new Error('RUNTIME_REDISCOVERY_IMAGE_MISMATCH');
        }
        verifyCreatedPreviewContainer({
          inspectionJson: containerResult.stdout,
          networkName,
          ownershipToken,
          previewId: request.previewId,
          executionId: request.executionId,
          artifactId: request.expected.artifactId,
          limits: request.expected.limits,
        });
        verifyRunningPreviewContainer(containerResult.stdout, networkName);
      } catch (error) {
        throw runnerError({
          message: 'O runtime redescoberto não corresponde à sessão persistida.',
          code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_INTEGRITY_MISMATCH,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          previewId: request.previewId,
          sourceCode: 'RUNTIME_REDISCOVERY_MISMATCH',
          cause: error,
        });
      }

      const runtimeDeadline = Date.now() + request.expected.limits.stopTimeoutMs;
      const runtime = await observeRuntime({
        executor: dependencies.executor,
        options,
        previewId: request.previewId,
        policy: request.expected.policy,
        deadline: runtimeDeadline,
      });
      if (
        request.expected.runtime !== null &&
        JSON.stringify(runtime) !== JSON.stringify(request.expected.runtime)
      ) {
        throw runnerError({
          message: 'A identidade observada do runtime diverge da sessão persistida.',
          code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_INTEGRITY_MISMATCH,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          previewId: request.previewId,
          sourceCode: 'RUNTIME_REDISCOVERY_RUNTIME_MISMATCH',
        });
      }

      let relay: PreviewLoopbackRelay;
      try {
        relay = await dependencies.createRelay({
          executor: dependencies.executor,
          containerId: String(container.Id),
          responseBytes: request.expected.limits.responseBytes,
          responseTimeoutMs: request.expected.limits.responseTimeoutMs,
        });
      } catch (error) {
        throw runnerError({
          message: 'O canal privado do runtime redescoberto não pôde ser recriado.',
          code: PREVIEW_RUNNER_ERROR_CODES.RUNTIME_LOST,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          previewId: request.previewId,
          sourceCode: 'RUNTIME_REDISCOVERY_RELAY_FAILED',
          cause: error,
        });
      }
      let accepted = false;
      try {
        const target = safeTarget(relay.port, relay.accessToken, request.expected.expiresAt);
        const healthy = await confirmHealth({
          target,
          path: request.expected.policy.protocol.healthPath,
          expectedBody: request.expected.policy.protocol.healthExpectedBody,
          budgetMs: request.expected.limits.healthTimeoutMs,
        });
        if (!healthy)
          return Object.freeze({
            runtime: Object.freeze({
              previewId: request.previewId,
              executionId: request.executionId,
              artifactId: request.expected.artifactId,
              containerId: String(container.Id),
              containerName,
              networkName,
              ownershipToken,
              relay,
              target,
              runtime,
              stopTimeoutMs: request.expected.limits.stopTimeoutMs,
            }),
            healthy: false,
          });
        const rediscovered = Object.freeze({
          previewId: request.previewId,
          executionId: request.executionId,
          artifactId: request.expected.artifactId,
          containerId: String(container.Id),
          containerName,
          networkName,
          ownershipToken,
          relay,
          target,
          runtime,
          stopTimeoutMs: request.expected.limits.stopTimeoutMs,
        });
        active.set(request.previewId, rediscovered);
        accepted = true;
        return Object.freeze({ runtime: rediscovered, healthy: true });
      } finally {
        if (!accepted) await relay.close().catch(() => false);
      }
    })().finally(() => rediscoveryPromises.delete(rediscoveryKey));
    rediscoveryPromises.set(rediscoveryKey, operation);
    return operation;
  };

  const runner: DockerPreviewRunner = {
    async start(rawRequest, runOptions = {}) {
      const parsed = approvedPreviewStartRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        throw runnerError({
          message: 'A solicitação aprovada de Preview é inválida.',
          code: PREVIEW_RUNNER_ERROR_CODES.INVALID_REQUEST,
          stage: PREVIEW_RUNNER_ERROR_STAGES.REQUEST_VALIDATION,
          cause: parsed.error,
        });
      }
      const request = parsed.data;
      if (isAborted(runOptions.signal)) {
        const artifactRemoved = await removeArtifact(
          options.contentStore,
          request.artifact.artifactId,
          isoTime(now()),
        );
        if (!artifactRemoved) {
          throw runnerError({
            message: 'O cleanup do Preview cancelado não foi confirmado.',
            code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
            stage: PREVIEW_RUNNER_ERROR_STAGES.CLEANUP,
            previewId: request.previewId,
            sourceCode: 'ARTIFACT_REMOVAL_NOT_CONFIRMED',
          });
        }
        throw runnerError({
          message: 'A solicitação de Preview foi cancelada antes do startup.',
          code: PREVIEW_RUNNER_ERROR_CODES.CANCELLED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.REQUEST_VALIDATION,
          previewId: request.previewId,
        });
      }
      if (
        active.has(request.previewId) ||
        starting.has(request.previewId) ||
        active.size + starting.size >= options.maxActivePreviews
      ) {
        throw runnerError({
          message: 'A capacidade local de Preview foi atingida ou a sessão já existe.',
          code: active.has(request.previewId)
            ? PREVIEW_RUNNER_ERROR_CODES.CONFLICT
            : PREVIEW_RUNNER_ERROR_CODES.CAPACITY_EXCEEDED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.CAPACITY,
          previewId: request.previewId,
        });
      }
      starting.add(request.previewId);
      const containerName = `brq-${request.previewId}`;
      const networkName = `brq-net-${request.previewId}`;
      const ownershipToken = `${request.previewId}-${randomId()}`;
      const deadline = Date.now() + request.effectiveLimits.startupTimeoutMs;
      let containerId: string | null = null;
      let networkCreated = false;
      let runtimeObservation: PreviewRuntimeObservation | null = null;
      let candidateRuntime: ActiveRuntime | null = null;
      let relay: PreviewLoopbackRelay | null = null;
      try {
        const artifactCandidate = await options.contentStore.readApproved(
          request.artifact.artifactId,
          runOptions.signal === undefined ? {} : { signal: runOptions.signal },
        );
        if (artifactCandidate === null) {
          throw runnerError({
            message: 'O PreviewArtifact aprovado não está disponível.',
            code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_UNAVAILABLE,
            stage: PREVIEW_RUNNER_ERROR_STAGES.ARTIFACT,
            previewId: request.previewId,
          });
        }
        const artifact = approvedPreviewArtifactSchema.parse(artifactCandidate);
        if (!descriptorMatches(artifact, request)) {
          throw runnerError({
            message: 'O PreviewArtifact diverge do descriptor aprovado.',
            code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_INTEGRITY_MISMATCH,
            stage: PREVIEW_RUNNER_ERROR_STAGES.ARTIFACT,
            previewId: request.previewId,
          });
        }
        const artifactPayload = serializeArtifact(artifact);
        runtimeObservation = await observeRuntime({
          executor: dependencies.executor,
          options,
          previewId: request.previewId,
          policy: request.policy,
          deadline,
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
        });
        const network = await requiredCommand({
          executor: dependencies.executor,
          args: buildCreateNetworkArguments({
            networkName,
            ownershipToken,
            previewId: request.previewId,
            executionId: request.executionId,
            artifactId: request.artifact.artifactId,
          }),
          timeoutMs: remaining(deadline),
          previewId: request.previewId,
          code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.START,
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
        });
        if (!SAFE_CONTAINER_ID.test(network.stdout.trim())) {
          throw runnerError({
            message: 'O Docker não retornou uma networkId segura.',
            code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
            stage: PREVIEW_RUNNER_ERROR_STAGES.START,
            previewId: request.previewId,
            sourceCode: 'INVALID_NETWORK_ID',
          });
        }
        networkCreated = true;
        const networkInspection = await requiredCommand({
          executor: dependencies.executor,
          args: ['network', 'inspect', '--format', '{{json .}}', networkName],
          timeoutMs: remaining(deadline),
          previewId: request.previewId,
          code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.START,
        });
        verifyPreviewNetwork({
          inspectionJson: networkInspection.stdout,
          ownershipToken,
          previewId: request.previewId,
          executionId: request.executionId,
          artifactId: request.artifact.artifactId,
        });
        const creation = await requiredCommand({
          executor: dependencies.executor,
          args: buildCreatePreviewContainerArguments({
            containerName,
            networkName,
            ownershipToken,
            previewId: request.previewId,
            executionId: request.executionId,
            artifactId: request.artifact.artifactId,
            expiresAtEpochSeconds: Math.floor(Date.parse(request.expiresAt) / 1000),
            imageReference: options.image.reference,
            limits: request.effectiveLimits,
          }),
          timeoutMs: remaining(deadline),
          previewId: request.previewId,
          code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.START,
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
        });
        containerId = creation.stdout.trim();
        if (!SAFE_CONTAINER_ID.test(containerId)) {
          throw runnerError({
            message: 'O Docker não retornou um containerId seguro.',
            code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
            stage: PREVIEW_RUNNER_ERROR_STAGES.START,
            previewId: request.previewId,
            sourceCode: 'INVALID_CONTAINER_ID',
          });
        }
        const creationInspection = await requiredCommand({
          executor: dependencies.executor,
          args: ['container', 'inspect', '--format', '{{json .}}', containerId],
          timeoutMs: remaining(deadline),
          previewId: request.previewId,
          code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.START,
        });
        verifyCreatedPreviewContainer({
          inspectionJson: creationInspection.stdout,
          networkName,
          ownershipToken,
          previewId: request.previewId,
          executionId: request.executionId,
          artifactId: request.artifact.artifactId,
          limits: request.effectiveLimits,
        });
        await requiredCommand({
          executor: dependencies.executor,
          args: ['container', 'start', containerId],
          timeoutMs: remaining(deadline),
          previewId: request.previewId,
          code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.START,
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
        });
        const runningInspection = await requiredCommand({
          executor: dependencies.executor,
          args: ['container', 'inspect', '--format', '{{json .}}', containerId],
          timeoutMs: remaining(deadline),
          previewId: request.previewId,
          code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.START,
        });
        verifyRunningPreviewContainer(runningInspection.stdout, networkName);
        await requiredCommand({
          executor: dependencies.executor,
          args: buildPrepareArguments(containerId),
          payload: artifactPayload,
          timeoutMs: remaining(deadline),
          outputLimitBytes: ARTIFACT_CHANNEL_BYTES,
          previewId: request.previewId,
          code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_INTEGRITY_MISMATCH,
          stage: PREVIEW_RUNNER_ERROR_STAGES.ARTIFACT,
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
        });
        await requiredCommand({
          executor: dependencies.executor,
          args: buildStartServerArguments(containerId, request.effectiveLimits.ttlSeconds),
          timeoutMs: remaining(deadline),
          previewId: request.previewId,
          code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.START,
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
        });
        relay = await dependencies.createRelay({
          executor: dependencies.executor,
          containerId,
          responseBytes: request.effectiveLimits.responseBytes,
          responseTimeoutMs: request.effectiveLimits.responseTimeoutMs,
        });
        const target = safeTarget(relay.port, relay.accessToken, request.expiresAt);
        const healthDeadline = Math.min(
          deadline,
          Date.now() + request.effectiveLimits.healthTimeoutMs,
        );
        let healthy = false;
        while (!healthy && Date.now() < healthDeadline) {
          healthy = await dependencies.healthProbe.check({
            host: target.host,
            port: target.port,
            path: request.policy.protocol.healthPath,
            expectedBody: request.policy.protocol.healthExpectedBody,
            timeoutMs: Math.max(1, healthDeadline - Date.now()),
            accessToken: target.accessToken,
            ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
          });
          if (!healthy && Date.now() < healthDeadline) await sleep(100);
        }
        if (!healthy) {
          throw runnerError({
            message: 'O servidor de Preview não atingiu o estado healthy.',
            code: isAborted(runOptions.signal)
              ? PREVIEW_RUNNER_ERROR_CODES.CANCELLED
              : PREVIEW_RUNNER_ERROR_CODES.HEALTHCHECK_FAILED,
            stage: PREVIEW_RUNNER_ERROR_STAGES.HEALTH,
            previewId: request.previewId,
          });
        }
        candidateRuntime = Object.freeze({
          previewId: request.previewId,
          executionId: request.executionId,
          artifactId: artifact.artifactId,
          containerId,
          containerName,
          networkName,
          ownershipToken,
          relay,
          target,
          runtime: runtimeObservation,
          stopTimeoutMs: request.effectiveLimits.stopTimeoutMs,
        });
        await options.contentStore.consume(
          artifact.artifactId,
          isoTime(now()),
          runOptions.signal === undefined ? {} : { signal: runOptions.signal },
        );
        active.set(request.previewId, candidateRuntime);
        const startedAt = isoTime(now());
        return previewRuntimeResultSchema.parse({
          previewId: request.previewId,
          executionId: request.executionId,
          status: 'RUNNING',
          health: { status: 'HEALTHY', observedAt: startedAt },
          startedAt,
          expiresAt: request.expiresAt,
          runtime: runtimeObservation,
          runtimeHash: calculatePreviewRuntimeHash(runtimeObservation),
        });
      } catch (error) {
        let cleanupConfirmed = true;
        let artifactCleanupHandled = false;
        if (containerId !== null && runtimeObservation !== null) {
          const cleanupRuntime: CleanupRuntime =
            candidateRuntime ??
            Object.freeze({
              previewId: request.previewId,
              executionId: request.executionId,
              artifactId: request.artifact.artifactId,
              containerId,
              containerName,
              networkName,
              ownershipToken,
              relay,
              stopTimeoutMs: request.effectiveLimits.stopTimeoutMs,
            });
          cleanupConfirmed = await cleanup(cleanupRuntime);
          artifactCleanupHandled = true;
        } else if (networkCreated) {
          cleanupConfirmed = await removeAndConfirm({
            executor: dependencies.executor,
            kind: 'network',
            identifier: networkName,
            timeoutMs: request.effectiveLimits.stopTimeoutMs,
          });
        }
        if (!artifactCleanupHandled) {
          cleanupConfirmed =
            (await removeArtifact(
              options.contentStore,
              request.artifact.artifactId,
              isoTime(now()),
            )) && cleanupConfirmed;
        }
        if (!cleanupConfirmed) {
          throw runnerError({
            message: 'O cleanup do Preview após falha não foi confirmado.',
            code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
            stage: PREVIEW_RUNNER_ERROR_STAGES.CLEANUP,
            previewId: request.previewId,
            cause: error,
          });
        }
        if (error instanceof PreviewRunnerError) throw error;
        throw runnerError({
          message: 'O startup isolado do Preview falhou.',
          code: PREVIEW_RUNNER_ERROR_CODES.START_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.START,
          previewId: request.previewId,
          sourceCode: 'UNEXPECTED_START_FAILURE',
          cause: error,
        });
      } finally {
        starting.delete(request.previewId);
      }
    },

    async inspect(rawRequest) {
      const request = previewInspectRequestSchema.parse(rawRequest);
      const observedAt = isoTime(now());
      const runtime = active.get(request.previewId);
      if (runtime !== undefined && runtime.executionId !== request.executionId) {
        return previewRuntimeInspectionSchema.parse({
          previewId: request.previewId,
          executionId: request.executionId,
          status: 'MISSING',
          health: 'NOT_APPLICABLE',
          observedAt,
          runtime: null,
        });
      }
      if (runtime === undefined && request.expected !== undefined) {
        const rediscovered = await rediscoverActiveRuntime({
          ...request,
          expected: request.expected,
        });
        if (rediscovered === null) {
          return previewRuntimeInspectionSchema.parse({
            previewId: request.previewId,
            executionId: request.executionId,
            status: 'MISSING',
            health: 'NOT_APPLICABLE',
            observedAt,
            runtime: null,
          });
        }
        if (!rediscovered.healthy) {
          return previewRuntimeInspectionSchema.parse({
            previewId: request.previewId,
            executionId: request.executionId,
            status: 'UNHEALTHY',
            health: 'UNHEALTHY',
            observedAt,
            runtime: rediscovered.runtime.runtime,
          });
        }
        return previewRuntimeInspectionSchema.parse({
          previewId: request.previewId,
          executionId: request.executionId,
          status: 'RUNNING',
          health: 'HEALTHY',
          observedAt,
          runtime: rediscovered.runtime.runtime,
        });
      }
      if (runtime === undefined) {
        return previewRuntimeInspectionSchema.parse({
          previewId: request.previewId,
          executionId: request.executionId,
          status: 'MISSING',
          health: 'NOT_APPLICABLE',
          observedAt,
          runtime: null,
        });
      }
      const healthy = await confirmHealth({
        target: runtime.target,
        path: request.expected?.policy.protocol.healthPath ?? '/__brq/health',
        expectedBody: request.expected?.policy.protocol.healthExpectedBody ?? 'BRQ_PREVIEW_HEALTHY',
        budgetMs: request.expected?.limits.healthTimeoutMs ?? INSPECTION_HEALTH_BUDGET_MS,
      });
      return previewRuntimeInspectionSchema.parse({
        previewId: request.previewId,
        executionId: request.executionId,
        status: healthy ? 'RUNNING' : 'UNHEALTHY',
        health: healthy ? 'HEALTHY' : 'UNHEALTHY',
        observedAt,
        runtime: runtime.runtime,
      });
    },

    async stop(rawRequest) {
      const request = previewStopRequestSchema.parse(rawRequest);
      const activeRuntime = active.get(request.previewId);
      const stoppedAt = isoTime(now());
      if (activeRuntime !== undefined && activeRuntime.executionId !== request.executionId) {
        return previewStopResultSchema.parse({
          previewId: request.previewId,
          executionId: request.executionId,
          stoppedAt,
          cleanupConfirmed: true,
          alreadyAbsent: true,
        });
      }
      const runtime = activeRuntime ?? (await discoverOwnedOrphan(request));
      if (runtime === null) {
        return previewStopResultSchema.parse({
          previewId: request.previewId,
          executionId: request.executionId,
          stoppedAt,
          cleanupConfirmed: true,
          alreadyAbsent: true,
        });
      }
      if (!(await cleanup(runtime))) {
        throw runnerError({
          message: 'A remoção do runtime de Preview não foi confirmada.',
          code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
          stage: PREVIEW_RUNNER_ERROR_STAGES.CLEANUP,
          previewId: request.previewId,
          sourceCode: 'REMOVAL_NOT_CONFIRMED',
        });
      }
      return previewStopResultSchema.parse({
        previewId: request.previewId,
        executionId: request.executionId,
        stoppedAt,
        cleanupConfirmed: true,
        alreadyAbsent: false,
      });
    },

    resolveGatewayTarget(rawRequest) {
      const parsed = previewInspectRequestSchema.safeParse(rawRequest);
      if (!parsed.success) return null;
      const runtime = active.get(parsed.data.previewId);
      if (
        runtime === undefined ||
        runtime.executionId !== parsed.data.executionId ||
        Date.parse(runtime.target.expiresAt) <= now()
      ) {
        return null;
      }
      return Object.freeze({ ...runtime.target });
    },
  };
  return Object.freeze(runner);
}
