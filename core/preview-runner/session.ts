import type {
  ApprovedPreviewStartRequest,
  PreviewFailure,
  PreviewRuntimeObservation,
  PreviewSession,
  PreviewSessionEvent,
  PreviewStartRequest,
} from './contracts';
import { resolvePreviewLimits } from './configuration';
import type { PreviewLimitReductions } from './limits';
import {
  PREVIEW_RUNNER_ERROR_CODES,
  PREVIEW_RUNNER_ERROR_STAGES,
  PreviewRunnerError,
} from './errors';
import {
  calculatePreviewLineageHash,
  calculatePreviewLimitsHash,
  calculatePreviewPolicyHash,
  calculatePreviewProvenanceHash,
  calculatePreviewRequestHash,
  calculatePreviewSessionHash,
  derivePreviewId,
} from './hashing';
import { immutableClone } from './immutability';
import {
  canTransitionPreviewSession,
  type PreviewObservabilityEventName,
  type PreviewSessionStatus,
} from './lifecycle';
import { resolvePreviewPolicy, type PreviewPolicyRegistry } from './policies';
import {
  approvedPreviewStartRequestSchema,
  previewSessionEventSchema,
  previewSessionSchema,
  previewStartRequestSchema,
} from './schemas';
import {
  PREVIEW_OBSERVABILITY_CONTRACT_VERSION,
  PREVIEW_RUNNER_CONTRACT_VERSION,
  PREVIEW_RUNNER_HASH_ALGORITHM,
  PREVIEW_RUNNER_VERSION,
} from './version';

export interface ResolvePreviewStartInput {
  readonly request: PreviewStartRequest;
  readonly policies: PreviewPolicyRegistry;
  readonly observedAt: string;
}

export interface ResolvedPreviewStart {
  readonly request: ApprovedPreviewStartRequest;
  readonly session: PreviewSession;
}

export function resolvePreviewStart(input: ResolvePreviewStartInput): ResolvedPreviewStart {
  const request = previewStartRequestSchema.safeParse(input.request);
  if (!request.success) {
    throw new PreviewRunnerError('A solicitação de Preview é inválida.', {
      code: PREVIEW_RUNNER_ERROR_CODES.INVALID_REQUEST,
      stage: PREVIEW_RUNNER_ERROR_STAGES.REQUEST_VALIDATION,
      cause: request.error,
    });
  }
  const policy = resolvePreviewPolicy(input.policies, request.data.policyId);
  if (policy.artifactProfileId !== request.data.artifact.metadata.profileId) {
    throw new PreviewRunnerError('O profile do artifact não é suportado pela Preview policy.', {
      code: PREVIEW_RUNNER_ERROR_CODES.PROFILE_UNSUPPORTED,
      stage: PREVIEW_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  if (Date.parse(request.data.artifact.expiresAt) <= Date.parse(input.observedAt)) {
    throw new PreviewRunnerError('O PreviewArtifact aprovado expirou.', {
      code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_UNAVAILABLE,
      stage: PREVIEW_RUNNER_ERROR_STAGES.ARTIFACT,
    });
  }
  const artifactRemainingMs =
    Date.parse(request.data.artifact.expiresAt) - Date.parse(input.observedAt);
  if (artifactRemainingMs < 60_000) {
    throw new PreviewRunnerError('O PreviewArtifact não possui janela mínima para uma sessão.', {
      code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_UNAVAILABLE,
      stage: PREVIEW_RUNNER_ERROR_STAGES.ARTIFACT,
    });
  }
  const limits = resolvePreviewLimits(
    policy.limits,
    request.data.limits as PreviewLimitReductions | undefined,
  );
  if (
    request.data.artifact.metadata.fileCount > limits.artifactFiles ||
    request.data.artifact.metadata.totalBytes > limits.artifactBytes
  ) {
    throw new PreviewRunnerError('O PreviewArtifact excede a policy efetiva.', {
      code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_UNAVAILABLE,
      stage: PREVIEW_RUNNER_ERROR_STAGES.ARTIFACT,
    });
  }
  const policyHash = calculatePreviewPolicyHash(policy);
  const limitsHash = calculatePreviewLimitsHash(limits);
  const previewRequestHash = calculatePreviewRequestHash({
    executionId: request.data.executionId,
    artifact: request.data.artifact,
    policyId: policy.policyId,
    policyHash,
    effectiveLimits: limits,
  });
  const previewId = derivePreviewId(previewRequestHash);
  const lineage = {
    executionId: request.data.executionId,
    artifactId: request.data.artifact.artifactId,
    factoryResultHash: request.data.artifact.approval!.factoryResultHash,
    sandboxRequestHash: request.data.artifact.source.sandboxRequestHash,
    sandboxResultHash: request.data.artifact.approval!.sandboxResultHash,
    workspaceHash: request.data.artifact.source.workspaceHash,
    artifactHash: request.data.artifact.hashes.artifactHash,
    artifactApprovalHash: request.data.artifact.hashes.approvalHash!,
  };
  const lineageHash = calculatePreviewLineageHash(lineage);
  const provenance = {
    runnerVersion: PREVIEW_RUNNER_VERSION,
    contractVersion: PREVIEW_RUNNER_CONTRACT_VERSION,
    hashAlgorithm: PREVIEW_RUNNER_HASH_ALGORITHM,
    artifactVersion: request.data.artifact.metadata.artifactVersion,
    artifactContractVersion: request.data.artifact.metadata.contractVersion,
    exporterVersion: request.data.artifact.metadata.exporterVersion,
    policyId: policy.policyId,
    policyVersion: policy.version,
    policyHash,
    limitsHash,
    runtime: null,
  };
  const provenanceHash = calculatePreviewProvenanceHash(provenance);
  const previewSessionHash = calculatePreviewSessionHash({
    previewId,
    executionId: request.data.executionId,
    artifactId: request.data.artifact.artifactId,
    previewRequestHash,
    policyHash,
    limitsHash,
    lineageHash,
  });
  const hashes = {
    factoryResultHash: lineage.factoryResultHash,
    sandboxRequestHash: lineage.sandboxRequestHash,
    sandboxResultHash: lineage.sandboxResultHash,
    workspaceHash: lineage.workspaceHash,
    artifactHash: lineage.artifactHash,
    artifactApprovalHash: lineage.artifactApprovalHash,
    policyHash,
    limitsHash,
    previewRequestHash,
    lineageHash,
    provenanceHash,
    previewSessionHash,
  };
  const expiresAt = new Date(
    Math.min(
      Date.parse(input.observedAt) + limits.ttlSeconds * 1000,
      Date.parse(request.data.artifact.expiresAt),
    ),
  ).toISOString();
  const session = previewSessionSchema.parse({
    previewId,
    executionId: request.data.executionId,
    artifactId: request.data.artifact.artifactId,
    status: 'CREATED',
    health: 'PENDING',
    createdAt: input.observedAt,
    startedAt: null,
    expiresAt,
    stoppingAt: null,
    stoppedAt: null,
    revision: 0,
    policy: { id: policy.policyId, version: policy.version },
    artifact: {
      profileId: request.data.artifact.metadata.profileId,
      fileCount: request.data.artifact.metadata.fileCount,
      totalBytes: request.data.artifact.metadata.totalBytes,
      expiresAt: request.data.artifact.expiresAt,
    },
    limits,
    lineage,
    provenance,
    hashes,
    failure: null,
  });
  const approvedRequest = approvedPreviewStartRequestSchema.parse({
    previewId,
    executionId: request.data.executionId,
    artifact: request.data.artifact,
    policy,
    effectiveLimits: limits,
    createdAt: input.observedAt,
    expiresAt,
    hashes,
    ...(request.data.requestId === undefined ? {} : { requestId: request.data.requestId }),
    ...(request.data.traceId === undefined ? {} : { traceId: request.data.traceId }),
  });
  return immutableClone({ request: approvedRequest, session });
}

export interface TransitionPreviewSessionInput {
  readonly session: PreviewSession;
  readonly status: PreviewSessionStatus;
  readonly observedAt: string;
  readonly health?: PreviewSession['health'];
  readonly runtime?: PreviewRuntimeObservation | null;
  readonly failure?: PreviewFailure | null;
}

export function transitionPreviewSession(input: TransitionPreviewSessionInput): PreviewSession {
  if (!canTransitionPreviewSession(input.session.status, input.status)) {
    throw new PreviewRunnerError('Transição de estado da PreviewSession inválida.', {
      code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT,
      stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
      previewId: input.session.previewId,
    });
  }
  const provenance = {
    ...input.session.provenance,
    ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
  };
  const candidate = {
    ...input.session,
    status: input.status,
    health:
      input.health ??
      (input.status === 'RUNNING'
        ? 'HEALTHY'
        : input.status === 'STOPPED' || input.status === 'EXPIRED'
          ? 'NOT_APPLICABLE'
          : input.status === 'FAILED'
            ? 'UNHEALTHY'
            : input.session.health),
    startedAt:
      input.status === 'RUNNING' && input.session.startedAt === null
        ? input.observedAt
        : input.session.startedAt,
    stoppingAt:
      input.status === 'STOPPING' && input.session.stoppingAt === null
        ? input.observedAt
        : input.session.stoppingAt,
    stoppedAt:
      input.status === 'STOPPED' || input.status === 'EXPIRED'
        ? input.observedAt
        : input.session.stoppedAt,
    revision: input.session.revision + 1,
    provenance,
    hashes: {
      ...input.session.hashes,
      provenanceHash: calculatePreviewProvenanceHash(provenance),
    },
    failure: input.status === 'FAILED' ? (input.failure ?? null) : null,
  };
  return immutableClone(previewSessionSchema.parse(candidate));
}

export function createPreviewSessionEvent(
  session: PreviewSession,
  event: PreviewObservabilityEventName,
  occurredAt: string,
): PreviewSessionEvent {
  return immutableClone(
    previewSessionEventSchema.parse({
      previewId: session.previewId,
      executionId: session.executionId,
      sequence: session.revision + 1,
      event,
      status: session.status,
      occurredAt,
      durationMs: Math.max(0, Date.parse(occurredAt) - Date.parse(session.createdAt)),
      policyId: session.policy.id,
      hashes: {
        artifactHash: session.hashes.artifactHash,
        previewRequestHash: session.hashes.previewRequestHash,
        previewSessionHash: session.hashes.previewSessionHash,
      },
      failureCode: session.failure?.code ?? null,
      contractVersion: PREVIEW_OBSERVABILITY_CONTRACT_VERSION,
    }),
  );
}
