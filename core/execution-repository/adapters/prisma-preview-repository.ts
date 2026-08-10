import { isDeepStrictEqual } from 'node:util';

import {
  canTransitionPreviewArtifact,
  previewArtifactDescriptorSchema,
  previewArtifactIdSchema,
  type PreviewArtifactDescriptor,
} from '@brq/preview-artifact';
import {
  canTransitionPreviewSession,
  previewIdSchema,
  previewSessionEventSchema,
  previewSessionSchema,
  type PreviewSession,
  type PreviewSessionEvent,
  type PreviewSessionStoreMutationResult,
} from '@brq/preview-runner';
import type { DatabaseClient } from '@brq/prisma/client';

import { EXECUTION_REPOSITORY_ERROR_CODES, ExecutionRepositoryError } from '../errors';
import { immutableClone } from '../immutability';
import type {
  PreviewAccessTicketConsumeInput,
  PreviewAccessTicketIssueInput,
  PreviewAccessTicketMetadata,
  PreviewAccessTicketRedemption,
  PreviewAccessTicketRevokeInput,
  PreviewPersistenceRepository,
  PreviewRepositoryAccess,
} from '../preview-persistence-contracts';
import {
  previewAccessTicketConsumeInputSchema,
  previewAccessTicketIssueInputSchema,
  previewAccessTicketMetadataSchema,
  previewAccessTicketRedemptionSchema,
  previewAccessTicketRevokeInputSchema,
} from '../preview-persistence-schemas';

const OWNER_ID_MAX_LENGTH = 128;
const GENERIC_FAILURE_MESSAGE = 'A sessão de Preview falhou.';

interface RawFactoryBinding {
  status: string;
  sandboxStatus: string;
  workspaceReleaseStatus: string;
  factoryResultHash: string;
  lineage: {
    workspaceHash: string | null;
    sandboxRequestHash: string | null;
    sandboxResultHash: string | null;
  } | null;
}

interface RawExecutionBinding {
  storageId: string;
  userId: string;
  executionId: string | null;
  status: string;
  factoryResult: RawFactoryBinding | null;
}

interface RawArtifact {
  artifactId: string;
  status: string;
  artifactVersion: string;
  contractVersion: string;
  hashAlgorithm: string;
  profileId: string;
  exporterVersion: string;
  fileCount: number;
  totalBytes: number;
  createdAt: Date;
  approvedAt: Date | null;
  expiresAt: Date;
  consumedAt: Date | null;
  deletedAt: Date | null;
  workspaceHash: string;
  sandboxRequestHash: string;
  factoryResultHash: string | null;
  sandboxResultHash: string | null;
  artifactContentHash: string;
  artifactHash: string;
  approvalHash: string | null;
  revision: number;
  executionRecord: RawExecutionBinding;
}

interface RawSessionEvent {
  sequence: number;
  event: string;
  status: string;
  occurredAt: Date;
  durationMs: number | null;
  artifactHash: string;
  previewRequestHash: string;
  previewSessionHash: string;
  policyId: string;
  failureCode: string | null;
  contractVersion: string;
}

interface RawSessionProvenance {
  runnerVersion: string;
  contractVersion: string;
  hashAlgorithm: string;
  artifactVersion: string;
  artifactContractVersion: string;
  exporterVersion: string;
  policyId: string;
  policyVersion: string;
  policyHash: string;
  limitsHash: string;
  runtimeAdapter: string | null;
  runtimeEngineName: string | null;
  runtimeEngineVersion: string | null;
  runtimeImageReference: string | null;
  runtimeImageDigest: string | null;
  runtimeImageId: string | null;
  runtimePlatform: string | null;
  runtimeName: string | null;
  runtimeVersion: string | null;
  runtimeServerAbiVersion: string | null;
}

interface RawSession {
  previewId: string;
  artifactId: string;
  status: string;
  health: string;
  policyId: string;
  policyVersion: string;
  artifactProfileId: string;
  artifactFileCount: number;
  artifactTotalBytes: number;
  artifactExpiresAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  expiresAt: Date;
  stoppingAt: Date | null;
  stoppedAt: Date | null;
  revision: number;
  ttlSeconds: number;
  startupTimeoutMs: number;
  healthTimeoutMs: number;
  stopTimeoutMs: number;
  cpus: number;
  memoryBytes: number;
  pidsLimit: number;
  openFilesLimit: number;
  temporaryBytes: number;
  artifactBytes: number;
  artifactFiles: number;
  responseBytes: number;
  responseTimeoutMs: number;
  capturedLogBytes: number;
  maxLogLineBytes: number;
  factoryResultHash: string;
  sandboxRequestHash: string;
  sandboxResultHash: string;
  workspaceHash: string;
  artifactHash: string;
  artifactApprovalHash: string;
  policyHash: string;
  limitsHash: string;
  previewRequestHash: string;
  lineageHash: string;
  provenanceHash: string;
  previewSessionHash: string;
  failureCode: string | null;
  failureStage: string | null;
  failureSourceCode: string | null;
  executionRecord: RawExecutionBinding;
  provenance: RawSessionProvenance | null;
  events: RawSessionEvent[];
}

interface RawTicket {
  previewSessionId: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

const executionBindingSelect = {
  storageId: true,
  userId: true,
  executionId: true,
  status: true,
  factoryResult: {
    select: {
      status: true,
      sandboxStatus: true,
      workspaceReleaseStatus: true,
      factoryResultHash: true,
      lineage: {
        select: {
          workspaceHash: true,
          sandboxRequestHash: true,
          sandboxResultHash: true,
        },
      },
    },
  },
} as const;

const artifactInclude = {
  executionRecord: { select: executionBindingSelect },
} as const;

const sessionInclude = {
  executionRecord: { select: executionBindingSelect },
  provenance: true,
  events: { orderBy: { sequence: 'asc' as const } },
} as const;

function accessError(message: string): ExecutionRepositoryError {
  return new ExecutionRepositoryError(message, {
    code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
  });
}

function invalidInput(message: string, cause?: unknown): ExecutionRepositoryError {
  return new ExecutionRepositoryError(message, {
    code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string): ExecutionRepositoryError {
  return new ExecutionRepositoryError(message, {
    code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
  });
}

function notFound(message: string): ExecutionRepositoryError {
  return new ExecutionRepositoryError(message, {
    code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
  });
}

function parseAccess(access: PreviewRepositoryAccess): PreviewRepositoryAccess {
  if (
    access?.access === 'INTERNAL' ||
    access?.access === 'GLOBAL_PREVIEW' ||
    access?.access === 'TICKET_REDEEM'
  ) {
    return Object.freeze({ access: access.access });
  }
  if (
    access?.access === 'OWNER' &&
    typeof access.userId === 'string' &&
    access.userId === access.userId.trim() &&
    access.userId.length > 0 &&
    access.userId.length <= OWNER_ID_MAX_LENGTH
  ) {
    return Object.freeze({ access: 'OWNER', userId: access.userId });
  }
  throw accessError('Capability de persistência do Preview inválida.');
}

function persistenceCode(error: unknown): string | null {
  return error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : null;
}

function persistenceError(error: unknown): never {
  if (error instanceof ExecutionRepositoryError) throw error;
  const code = persistenceCode(error);
  if (code === 'P2002' || code === 'P2003') {
    throw conflict('Conflito ao persistir metadata de Preview.');
  }
  if (code === 'P2025') throw notFound('Metadata de Preview não encontrada.');
  throw new ExecutionRepositoryError('Falha ao persistir metadata de Preview.', {
    code: EXECUTION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
    cause: error,
  });
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return persistenceError(error);
  }
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function sanitizeFailureSourceCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/gu, '_')
    .slice(0, 128);
  return sanitized.length === 0 ? null : sanitized;
}

function mapArtifact(value: unknown): PreviewArtifactDescriptor {
  const raw = value as RawArtifact;
  return immutableClone(
    previewArtifactDescriptorSchema.parse({
      artifactId: raw.artifactId,
      status: raw.status,
      createdAt: raw.createdAt.toISOString(),
      expiresAt: raw.expiresAt.toISOString(),
      consumedAt: iso(raw.consumedAt),
      deletedAt: iso(raw.deletedAt),
      metadata: {
        artifactVersion: raw.artifactVersion,
        contractVersion: raw.contractVersion,
        hashAlgorithm: raw.hashAlgorithm,
        profileId: raw.profileId,
        exporterVersion: raw.exporterVersion,
        fileCount: raw.fileCount,
        totalBytes: raw.totalBytes,
      },
      source: {
        executionId: raw.executionRecord.executionId,
        workspaceHash: raw.workspaceHash,
        sandboxRequestHash: raw.sandboxRequestHash,
      },
      approval:
        raw.approvedAt === null || raw.factoryResultHash === null || raw.sandboxResultHash === null
          ? null
          : {
              factoryStatus: 'SUCCESS',
              sandboxStatus: 'SUCCESS',
              workspaceReleaseStatus: 'RELEASED',
              approvedAt: raw.approvedAt.toISOString(),
              factoryResultHash: raw.factoryResultHash,
              sandboxResultHash: raw.sandboxResultHash,
            },
      hashes: {
        artifactContentHash: raw.artifactContentHash,
        artifactHash: raw.artifactHash,
        approvalHash: raw.approvalHash,
      },
    }),
  );
}

function mapProvenance(raw: RawSessionProvenance) {
  const runtimeMissing = raw.runtimeAdapter === null;
  const runtime = runtimeMissing
    ? null
    : {
        adapter: raw.runtimeAdapter,
        engineName: raw.runtimeEngineName,
        engineVersion: raw.runtimeEngineVersion,
        imageReference: raw.runtimeImageReference,
        imageDigest: raw.runtimeImageDigest,
        imageId: raw.runtimeImageId,
        platform: raw.runtimePlatform,
        runtimeName: raw.runtimeName,
        runtimeVersion: raw.runtimeVersion,
        serverAbiVersion: raw.runtimeServerAbiVersion,
      };
  return {
    runnerVersion: raw.runnerVersion,
    contractVersion: raw.contractVersion,
    hashAlgorithm: raw.hashAlgorithm,
    artifactVersion: raw.artifactVersion,
    artifactContractVersion: raw.artifactContractVersion,
    exporterVersion: raw.exporterVersion,
    policyId: raw.policyId,
    policyVersion: raw.policyVersion,
    policyHash: raw.policyHash,
    limitsHash: raw.limitsHash,
    runtime,
  };
}

function mapSession(value: unknown): PreviewSession {
  const raw = value as RawSession;
  if (raw.provenance === null || raw.executionRecord.executionId === null) {
    throw new ExecutionRepositoryError('Aggregate de Preview persistido está incompleto.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
    });
  }
  return immutableClone(
    previewSessionSchema.parse({
      previewId: raw.previewId,
      executionId: raw.executionRecord.executionId,
      artifactId: raw.artifactId,
      status: raw.status,
      health: raw.health,
      createdAt: raw.createdAt.toISOString(),
      startedAt: iso(raw.startedAt),
      expiresAt: raw.expiresAt.toISOString(),
      stoppingAt: iso(raw.stoppingAt),
      stoppedAt: iso(raw.stoppedAt),
      revision: raw.revision,
      policy: { id: raw.policyId, version: raw.policyVersion },
      artifact: {
        profileId: raw.artifactProfileId,
        fileCount: raw.artifactFileCount,
        totalBytes: raw.artifactTotalBytes,
        expiresAt: raw.artifactExpiresAt.toISOString(),
      },
      limits: {
        ttlSeconds: raw.ttlSeconds,
        startupTimeoutMs: raw.startupTimeoutMs,
        healthTimeoutMs: raw.healthTimeoutMs,
        stopTimeoutMs: raw.stopTimeoutMs,
        cpus: raw.cpus,
        memoryBytes: raw.memoryBytes,
        pidsLimit: raw.pidsLimit,
        openFilesLimit: raw.openFilesLimit,
        temporaryBytes: raw.temporaryBytes,
        artifactBytes: raw.artifactBytes,
        artifactFiles: raw.artifactFiles,
        responseBytes: raw.responseBytes,
        responseTimeoutMs: raw.responseTimeoutMs,
        capturedLogBytes: raw.capturedLogBytes,
        maxLogLineBytes: raw.maxLogLineBytes,
      },
      lineage: {
        executionId: raw.executionRecord.executionId,
        artifactId: raw.artifactId,
        factoryResultHash: raw.factoryResultHash,
        sandboxRequestHash: raw.sandboxRequestHash,
        sandboxResultHash: raw.sandboxResultHash,
        workspaceHash: raw.workspaceHash,
        artifactHash: raw.artifactHash,
        artifactApprovalHash: raw.artifactApprovalHash,
      },
      provenance: mapProvenance(raw.provenance),
      hashes: {
        factoryResultHash: raw.factoryResultHash,
        sandboxRequestHash: raw.sandboxRequestHash,
        sandboxResultHash: raw.sandboxResultHash,
        workspaceHash: raw.workspaceHash,
        artifactHash: raw.artifactHash,
        artifactApprovalHash: raw.artifactApprovalHash,
        policyHash: raw.policyHash,
        limitsHash: raw.limitsHash,
        previewRequestHash: raw.previewRequestHash,
        lineageHash: raw.lineageHash,
        provenanceHash: raw.provenanceHash,
        previewSessionHash: raw.previewSessionHash,
      },
      failure:
        raw.failureCode === null || raw.failureStage === null
          ? null
          : {
              code: raw.failureCode,
              stage: raw.failureStage,
              sourceCode: sanitizeFailureSourceCode(raw.failureSourceCode),
              message: GENERIC_FAILURE_MESSAGE,
            },
    }),
  );
}

function mapEvent(raw: RawSessionEvent, session: RawSession): PreviewSessionEvent {
  if (session.executionRecord.executionId === null) {
    throw new ExecutionRepositoryError('Evento de Preview sem executionId.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
    });
  }
  return immutableClone(
    previewSessionEventSchema.parse({
      previewId: session.previewId,
      executionId: session.executionRecord.executionId,
      sequence: raw.sequence,
      event: raw.event,
      status: raw.status,
      occurredAt: raw.occurredAt.toISOString(),
      durationMs: raw.durationMs,
      policyId: raw.policyId,
      hashes: {
        artifactHash: raw.artifactHash,
        previewRequestHash: raw.previewRequestHash,
        previewSessionHash: raw.previewSessionHash,
      },
      failureCode: raw.failureCode,
      contractVersion: raw.contractVersion,
    }),
  );
}

function mapTicket(raw: RawTicket): PreviewAccessTicketMetadata {
  return immutableClone(
    previewAccessTicketMetadataSchema.parse({
      previewId: raw.previewSessionId,
      issuedAt: raw.issuedAt.toISOString(),
      expiresAt: raw.expiresAt.toISOString(),
      consumedAt: iso(raw.consumedAt),
      revokedAt: iso(raw.revokedAt),
    }),
  );
}

function artifactData(artifact: PreviewArtifactDescriptor) {
  return {
    status: artifact.status,
    artifactVersion: artifact.metadata.artifactVersion,
    contractVersion: artifact.metadata.contractVersion,
    hashAlgorithm: artifact.metadata.hashAlgorithm,
    profileId: artifact.metadata.profileId,
    exporterVersion: artifact.metadata.exporterVersion,
    fileCount: artifact.metadata.fileCount,
    totalBytes: artifact.metadata.totalBytes,
    createdAt: new Date(artifact.createdAt),
    approvedAt: artifact.approval === null ? null : new Date(artifact.approval.approvedAt),
    expiresAt: new Date(artifact.expiresAt),
    consumedAt: artifact.consumedAt === null ? null : new Date(artifact.consumedAt),
    deletedAt: artifact.deletedAt === null ? null : new Date(artifact.deletedAt),
    workspaceHash: artifact.source.workspaceHash,
    sandboxRequestHash: artifact.source.sandboxRequestHash,
    factoryResultHash: artifact.approval?.factoryResultHash ?? null,
    sandboxResultHash: artifact.approval?.sandboxResultHash ?? null,
    artifactContentHash: artifact.hashes.artifactContentHash,
    artifactHash: artifact.hashes.artifactHash,
    approvalHash: artifact.hashes.approvalHash,
  };
}

function provenanceData(session: PreviewSession) {
  const provenance = session.provenance;
  const runtime = provenance.runtime;
  return {
    runnerVersion: provenance.runnerVersion,
    contractVersion: provenance.contractVersion,
    hashAlgorithm: provenance.hashAlgorithm,
    artifactVersion: provenance.artifactVersion,
    artifactContractVersion: provenance.artifactContractVersion,
    exporterVersion: provenance.exporterVersion,
    policyId: provenance.policyId,
    policyVersion: provenance.policyVersion,
    policyHash: provenance.policyHash,
    limitsHash: provenance.limitsHash,
    runtimeAdapter: runtime?.adapter ?? null,
    runtimeEngineName: runtime?.engineName ?? null,
    runtimeEngineVersion: runtime?.engineVersion ?? null,
    runtimeImageReference: runtime?.imageReference ?? null,
    runtimeImageDigest: runtime?.imageDigest ?? null,
    runtimeImageId: runtime?.imageId ?? null,
    runtimePlatform: runtime?.platform ?? null,
    runtimeName: runtime?.runtimeName ?? null,
    runtimeVersion: runtime?.runtimeVersion ?? null,
    runtimeServerAbiVersion: runtime?.serverAbiVersion ?? null,
  };
}

function sessionData(session: PreviewSession) {
  return {
    status: session.status,
    health: session.health,
    policyId: session.policy.id,
    policyVersion: session.policy.version,
    artifactProfileId: session.artifact.profileId,
    artifactFileCount: session.artifact.fileCount,
    artifactTotalBytes: session.artifact.totalBytes,
    artifactExpiresAt: new Date(session.artifact.expiresAt),
    createdAt: new Date(session.createdAt),
    startedAt: session.startedAt === null ? null : new Date(session.startedAt),
    expiresAt: new Date(session.expiresAt),
    stoppingAt: session.stoppingAt === null ? null : new Date(session.stoppingAt),
    stoppedAt: session.stoppedAt === null ? null : new Date(session.stoppedAt),
    revision: session.revision,
    ...session.limits,
    factoryResultHash: session.hashes.factoryResultHash,
    sandboxRequestHash: session.hashes.sandboxRequestHash,
    sandboxResultHash: session.hashes.sandboxResultHash,
    workspaceHash: session.hashes.workspaceHash,
    artifactHash: session.hashes.artifactHash,
    artifactApprovalHash: session.hashes.artifactApprovalHash,
    policyHash: session.hashes.policyHash,
    limitsHash: session.hashes.limitsHash,
    previewRequestHash: session.hashes.previewRequestHash,
    lineageHash: session.hashes.lineageHash,
    provenanceHash: session.hashes.provenanceHash,
    previewSessionHash: session.hashes.previewSessionHash,
    failureCode: session.failure?.code ?? null,
    failureStage: session.failure?.stage ?? null,
    failureSourceCode: sanitizeFailureSourceCode(session.failure?.sourceCode),
  };
}

function eventData(event: PreviewSessionEvent) {
  return {
    sequence: event.sequence,
    event: event.event,
    status: event.status,
    occurredAt: new Date(event.occurredAt),
    durationMs: event.durationMs,
    artifactHash: event.hashes.artifactHash,
    previewRequestHash: event.hashes.previewRequestHash,
    previewSessionHash: event.hashes.previewSessionHash,
    policyId: event.policyId,
    failureCode: event.failureCode,
    contractVersion: event.contractVersion,
  };
}

function artifactIdentity(artifact: PreviewArtifactDescriptor): unknown {
  return {
    artifactId: artifact.artifactId,
    createdAt: artifact.createdAt,
    expiresAt: artifact.expiresAt,
    metadata: artifact.metadata,
    source: artifact.source,
    artifactContentHash: artifact.hashes.artifactContentHash,
    artifactHash: artifact.hashes.artifactHash,
  };
}

function assertArtifactTransition(
  current: PreviewArtifactDescriptor,
  next: PreviewArtifactDescriptor,
): void {
  if (!isDeepStrictEqual(artifactIdentity(current), artifactIdentity(next))) {
    throw conflict('A identidade imutável do PreviewArtifact não pode ser alterada.');
  }
  if (current.approval !== null && !isDeepStrictEqual(current.approval, next.approval)) {
    throw conflict('A aprovação do PreviewArtifact é imutável.');
  }
  if (!canTransitionPreviewArtifact(current.status, next.status)) {
    throw conflict(`Transição de PreviewArtifact inválida: ${current.status} -> ${next.status}.`);
  }
}

function assertFactoryBinding(
  execution: RawExecutionBinding,
  artifact: PreviewArtifactDescriptor,
): void {
  const approval = artifact.approval;
  if (approval === null) return;
  const factory = execution.factoryResult;
  if (
    execution.status !== 'SUCCESS' ||
    factory?.status !== 'SUCCESS' ||
    factory.sandboxStatus !== 'SUCCESS' ||
    factory.workspaceReleaseStatus !== 'RELEASED' ||
    factory.lineage === null ||
    factory.factoryResultHash !== approval.factoryResultHash ||
    factory.lineage.workspaceHash !== artifact.source.workspaceHash ||
    factory.lineage.sandboxRequestHash !== artifact.source.sandboxRequestHash ||
    factory.lineage.sandboxResultHash !== approval.sandboxResultHash
  ) {
    throw conflict('A aprovação do PreviewArtifact não corresponde ao FactoryResult SUCCESS.');
  }
}

function sessionIdentity(session: PreviewSession): unknown {
  return {
    previewId: session.previewId,
    executionId: session.executionId,
    artifactId: session.artifactId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    policy: session.policy,
    artifact: session.artifact,
    limits: session.limits,
    lineage: session.lineage,
    provenance: {
      runnerVersion: session.provenance.runnerVersion,
      contractVersion: session.provenance.contractVersion,
      hashAlgorithm: session.provenance.hashAlgorithm,
      artifactVersion: session.provenance.artifactVersion,
      artifactContractVersion: session.provenance.artifactContractVersion,
      exporterVersion: session.provenance.exporterVersion,
      policyId: session.provenance.policyId,
      policyVersion: session.provenance.policyVersion,
      policyHash: session.provenance.policyHash,
      limitsHash: session.provenance.limitsHash,
    },
    hashes: {
      factoryResultHash: session.hashes.factoryResultHash,
      sandboxRequestHash: session.hashes.sandboxRequestHash,
      sandboxResultHash: session.hashes.sandboxResultHash,
      workspaceHash: session.hashes.workspaceHash,
      artifactHash: session.hashes.artifactHash,
      artifactApprovalHash: session.hashes.artifactApprovalHash,
      policyHash: session.hashes.policyHash,
      limitsHash: session.hashes.limitsHash,
      previewRequestHash: session.hashes.previewRequestHash,
      lineageHash: session.hashes.lineageHash,
      previewSessionHash: session.hashes.previewSessionHash,
    },
  };
}

function assertEventMatchesSession(event: PreviewSessionEvent, session: PreviewSession): void {
  if (
    event.previewId !== session.previewId ||
    event.executionId !== session.executionId ||
    event.status !== session.status ||
    event.policyId !== session.policy.id ||
    event.hashes.artifactHash !== session.hashes.artifactHash ||
    event.hashes.previewRequestHash !== session.hashes.previewRequestHash ||
    event.hashes.previewSessionHash !== session.hashes.previewSessionHash ||
    event.failureCode !== (session.failure?.code ?? null) ||
    event.sequence !== session.revision + 1
  ) {
    throw conflict('O evento não corresponde à revisão da PreviewSession.');
  }
}

function assertSessionTransition(current: PreviewSession, next: PreviewSession): void {
  if (!isDeepStrictEqual(sessionIdentity(current), sessionIdentity(next))) {
    throw conflict('A identidade imutável da PreviewSession não pode ser alterada.');
  }
  if (current.provenance.runtime !== null) {
    if (!isDeepStrictEqual(current.provenance.runtime, next.provenance.runtime)) {
      throw conflict('A provenance de runtime da PreviewSession é imutável após observada.');
    }
  } else if (
    next.provenance.runtime === null &&
    current.hashes.provenanceHash !== next.hashes.provenanceHash
  ) {
    throw conflict('O provenanceHash não pode mudar sem nova observação de runtime.');
  }
  if (!canTransitionPreviewSession(current.status, next.status)) {
    throw conflict(`Transição de PreviewSession inválida: ${current.status} -> ${next.status}.`);
  }
  if (next.revision !== current.revision + 1) {
    throw conflict('A revisão da PreviewSession deve avançar exatamente uma unidade.');
  }
}

export class PrismaPreviewRepository implements PreviewPersistenceRepository {
  private readonly repositoryAccess: PreviewRepositoryAccess;

  constructor(
    private readonly client: DatabaseClient,
    access: PreviewRepositoryAccess,
  ) {
    this.repositoryAccess = parseAccess(access);
  }

  private assertArtifactMutationAccess(): void {
    if (this.repositoryAccess.access !== 'INTERNAL') {
      throw accessError('Somente a capability interna pode persistir metadata de artifact.');
    }
  }

  private assertSessionAccess(): void {
    if (this.repositoryAccess.access === 'TICKET_REDEEM') {
      throw accessError('A capability de redeem não permite operar PreviewSessions.');
    }
  }

  private assertTicketIssueAccess(): void {
    if (this.repositoryAccess.access === 'TICKET_REDEEM') {
      throw accessError('A capability de redeem não permite emitir ou revogar tickets.');
    }
  }

  private ownerExecutionWhere(): object {
    return this.repositoryAccess.access === 'OWNER'
      ? { executionRecord: { is: { userId: this.repositoryAccess.userId } } }
      : {};
  }

  private executionWhere(executionId: string): object {
    return {
      executionId,
      ...(this.repositoryAccess.access === 'OWNER' ? { userId: this.repositoryAccess.userId } : {}),
    };
  }

  private async loadSessionByPreviewId(previewId: string): Promise<RawSession | null> {
    const record = await this.client.previewSession.findFirst({
      where: { previewId, ...this.ownerExecutionWhere() },
      include: sessionInclude,
    });
    return record as unknown as RawSession | null;
  }

  async saveArtifactMetadata(
    rawArtifact: PreviewArtifactDescriptor,
  ): Promise<PreviewArtifactDescriptor> {
    this.assertArtifactMutationAccess();
    const parsed = previewArtifactDescriptorSchema.safeParse(rawArtifact);
    if (!parsed.success)
      throw invalidInput('Descriptor de PreviewArtifact inválido.', parsed.error);
    const artifact = parsed.data;
    return run(async () => {
      const existing = await this.client.previewArtifact.findUnique({
        where: { artifactId: artifact.artifactId },
        include: artifactInclude,
      });
      if (existing === null) {
        if (artifact.status !== 'CANDIDATE') {
          throw conflict('O primeiro estado persistido do PreviewArtifact deve ser CANDIDATE.');
        }
        const execution = await this.client.executionRecord.findUnique({
          where: { executionId: artifact.source.executionId },
          select: executionBindingSelect,
        });
        if (execution === null) throw notFound('Execução do PreviewArtifact não encontrada.');
        try {
          const created = await this.client.previewArtifact.create({
            data: {
              artifactId: artifact.artifactId,
              executionRecordId: execution.storageId,
              ...artifactData(artifact),
            },
            include: artifactInclude,
          });
          return mapArtifact(created);
        } catch (error) {
          if (persistenceCode(error) !== 'P2002') throw error;
          const concurrent = await this.client.previewArtifact.findUnique({
            where: { artifactId: artifact.artifactId },
            include: artifactInclude,
          });
          if (concurrent !== null) {
            const persisted = mapArtifact(concurrent);
            if (isDeepStrictEqual(persisted, artifact)) return persisted;
          }
          throw conflict('PreviewArtifact criado concorrentemente com metadata divergente.');
        }
      }

      const current = mapArtifact(existing);
      if (isDeepStrictEqual(current, artifact)) return current;
      assertArtifactTransition(current, artifact);
      const rawExisting = existing as unknown as RawArtifact;
      assertFactoryBinding(rawExisting.executionRecord, artifact);
      const update = await this.client.previewArtifact.updateMany({
        where: { artifactId: artifact.artifactId, revision: rawExisting.revision },
        data: { ...artifactData(artifact), revision: { increment: 1 } },
      });
      if (update.count !== 1) throw conflict('Concorrência ao atualizar o PreviewArtifact.');
      const saved = await this.client.previewArtifact.findUnique({
        where: { artifactId: artifact.artifactId },
        include: artifactInclude,
      });
      return mapArtifact(saved!);
    });
  }

  async findArtifactMetadataByArtifactId(
    rawArtifactId: string,
  ): Promise<PreviewArtifactDescriptor | null> {
    if (this.repositoryAccess.access === 'TICKET_REDEEM') {
      throw accessError('A capability de redeem não permite ler artifacts.');
    }
    const parsed = previewArtifactIdSchema.safeParse(rawArtifactId);
    if (!parsed.success) throw invalidInput('ArtifactId de Preview inválido.', parsed.error);
    return run(async () => {
      const artifact = await this.client.previewArtifact.findFirst({
        where: { artifactId: parsed.data, ...this.ownerExecutionWhere() },
        include: artifactInclude,
      });
      return artifact === null ? null : mapArtifact(artifact);
    });
  }

  async findArtifactMetadataByExecutionId(
    executionId: string,
  ): Promise<PreviewArtifactDescriptor | null> {
    if (this.repositoryAccess.access === 'TICKET_REDEEM') {
      throw accessError('A capability de redeem não permite ler artifacts.');
    }
    return run(async () => {
      const artifact = await this.client.previewArtifact.findFirst({
        where: {
          executionRecord: {
            is: {
              executionId,
              ...(this.repositoryAccess.access === 'OWNER'
                ? { userId: this.repositoryAccess.userId }
                : {}),
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        include: artifactInclude,
      });
      return artifact === null ? null : mapArtifact(artifact);
    });
  }

  async createOrGet(
    rawSession: PreviewSession,
    rawEvent: PreviewSessionEvent,
  ): Promise<PreviewSessionStoreMutationResult> {
    this.assertSessionAccess();
    const parsedSession = previewSessionSchema.safeParse(rawSession);
    const parsedEvent = previewSessionEventSchema.safeParse(rawEvent);
    if (!parsedSession.success) throw invalidInput('PreviewSession inválida.', parsedSession.error);
    if (!parsedEvent.success)
      throw invalidInput('Evento inicial de Preview inválido.', parsedEvent.error);
    const session = parsedSession.data;
    const event = parsedEvent.data;
    if (session.status !== 'CREATED' || session.revision !== 0 || event.sequence !== 1) {
      throw conflict('A criação da PreviewSession exige CREATED na revisão zero.');
    }
    assertEventMatchesSession(event, session);

    return run(async () => {
      const existing = await this.client.previewSession.findFirst({
        where: {
          OR: [
            { previewId: session.previewId },
            { executionRecord: { is: { executionId: session.executionId } } },
          ],
          ...this.ownerExecutionWhere(),
        },
        include: sessionInclude,
      });
      if (existing !== null) {
        const current = mapSession(existing);
        if (current.hashes.previewSessionHash !== session.hashes.previewSessionHash) {
          throw conflict('Já existe PreviewSession divergente para a execução.');
        }
        return immutableClone({ created: false, session: current });
      }

      const execution = await this.client.executionRecord.findFirst({
        where: this.executionWhere(session.executionId),
        select: executionBindingSelect,
      });
      if (execution === null) throw notFound('Execução da PreviewSession não encontrada.');
      const artifact = await this.client.previewArtifact.findFirst({
        where: { artifactId: session.artifactId, executionRecordId: execution.storageId },
        include: artifactInclude,
      });
      if (artifact === null) throw notFound('PreviewArtifact da sessão não encontrado.');
      const descriptor = mapArtifact(artifact);
      if (
        descriptor.status !== 'APPROVED' ||
        descriptor.approval === null ||
        descriptor.hashes.approvalHash === null ||
        descriptor.source.executionId !== session.executionId ||
        descriptor.hashes.artifactHash !== session.hashes.artifactHash ||
        descriptor.hashes.approvalHash !== session.hashes.artifactApprovalHash ||
        descriptor.approval.factoryResultHash !== session.hashes.factoryResultHash ||
        descriptor.approval.sandboxResultHash !== session.hashes.sandboxResultHash ||
        descriptor.source.sandboxRequestHash !== session.hashes.sandboxRequestHash ||
        descriptor.source.workspaceHash !== session.hashes.workspaceHash ||
        descriptor.metadata.profileId !== session.artifact.profileId ||
        descriptor.metadata.fileCount !== session.artifact.fileCount ||
        descriptor.metadata.totalBytes !== session.artifact.totalBytes ||
        descriptor.expiresAt !== session.artifact.expiresAt ||
        Date.parse(session.expiresAt) > Date.parse(descriptor.expiresAt)
      ) {
        throw conflict('A PreviewSession não corresponde ao PreviewArtifact aprovado.');
      }
      assertFactoryBinding(execution as unknown as RawExecutionBinding, descriptor);

      try {
        const created = await this.client.previewSession.create({
          data: {
            previewId: session.previewId,
            executionRecordId: execution.storageId,
            artifactId: session.artifactId,
            ...sessionData(session),
            provenance: { create: provenanceData(session) },
            events: { create: eventData(event) },
          },
          include: sessionInclude,
        });
        return immutableClone({ created: true, session: mapSession(created) });
      } catch (error) {
        if (persistenceCode(error) !== 'P2002') throw error;
        const concurrent = await this.client.previewSession.findFirst({
          where: {
            OR: [
              { previewId: session.previewId },
              { executionRecord: { is: { executionId: session.executionId } } },
            ],
            ...this.ownerExecutionWhere(),
          },
          include: sessionInclude,
        });
        if (concurrent !== null) {
          const persisted = mapSession(concurrent);
          if (persisted.hashes.previewSessionHash === session.hashes.previewSessionHash) {
            return immutableClone({ created: false, session: persisted });
          }
        }
        throw conflict('PreviewSession criada concorrentemente com metadata divergente.');
      }
    });
  }

  async getByPreviewId(rawPreviewId: string): Promise<PreviewSession | null> {
    this.assertSessionAccess();
    const parsed = previewIdSchema.safeParse(rawPreviewId);
    if (!parsed.success) throw invalidInput('PreviewId inválido.', parsed.error);
    return run(async () => {
      const session = await this.loadSessionByPreviewId(parsed.data);
      return session === null ? null : mapSession(session);
    });
  }

  async getByExecutionId(executionId: string): Promise<PreviewSession | null> {
    this.assertSessionAccess();
    return run(async () => {
      const session = await this.client.previewSession.findFirst({
        where: {
          executionRecord: {
            is: {
              executionId,
              ...(this.repositoryAccess.access === 'OWNER'
                ? { userId: this.repositoryAccess.userId }
                : {}),
            },
          },
        },
        include: sessionInclude,
      });
      return session === null ? null : mapSession(session);
    });
  }

  async replace(
    expectedRevision: number,
    rawSession: PreviewSession,
    rawEvent: PreviewSessionEvent,
  ): Promise<PreviewSession> {
    this.assertSessionAccess();
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw invalidInput('Revisão esperada da PreviewSession inválida.');
    }
    const parsedSession = previewSessionSchema.safeParse(rawSession);
    const parsedEvent = previewSessionEventSchema.safeParse(rawEvent);
    if (!parsedSession.success) throw invalidInput('PreviewSession inválida.', parsedSession.error);
    if (!parsedEvent.success) throw invalidInput('Evento de Preview inválido.', parsedEvent.error);
    const session = parsedSession.data;
    const event = parsedEvent.data;
    assertEventMatchesSession(event, session);

    return run(async () => {
      await this.client.$transaction(async (transaction) => {
        const currentRaw = await transaction.previewSession.findFirst({
          where: { previewId: session.previewId, ...this.ownerExecutionWhere() },
          include: sessionInclude,
        });
        if (currentRaw === null) throw notFound('PreviewSession não encontrada.');
        const current = mapSession(currentRaw);
        if (current.revision !== expectedRevision) {
          throw conflict('A revisão esperada da PreviewSession está desatualizada.');
        }
        assertSessionTransition(current, session);
        const updated = await transaction.previewSession.updateMany({
          where: { previewId: session.previewId, revision: expectedRevision },
          data: {
            status: session.status,
            health: session.health,
            startedAt: session.startedAt === null ? null : new Date(session.startedAt),
            stoppingAt: session.stoppingAt === null ? null : new Date(session.stoppingAt),
            stoppedAt: session.stoppedAt === null ? null : new Date(session.stoppedAt),
            revision: session.revision,
            provenanceHash: session.hashes.provenanceHash,
            failureCode: session.failure?.code ?? null,
            failureStage: session.failure?.stage ?? null,
            failureSourceCode: session.failure?.sourceCode ?? null,
          },
        });
        if (updated.count !== 1) throw conflict('Concorrência ao atualizar a PreviewSession.');
        await transaction.previewSessionProvenance.update({
          where: { previewSessionId: session.previewId },
          data: provenanceData(session),
        });
        await transaction.previewSessionEvent.create({
          data: { previewSessionId: session.previewId, ...eventData(event) },
        });
        if (['STOPPING', 'STOPPED', 'EXPIRED', 'FAILED'].includes(session.status)) {
          await transaction.previewAccessTicket.updateMany({
            where: { previewSessionId: session.previewId, revokedAt: null },
            data: { revokedAt: new Date(event.occurredAt) },
          });
        }
      });
      const saved = await this.loadSessionByPreviewId(session.previewId);
      if (saved === null) throw notFound('PreviewSession não encontrada após atualização.');
      return mapSession(saved);
    });
  }

  async listEvents(rawPreviewId: string): Promise<readonly PreviewSessionEvent[]> {
    this.assertSessionAccess();
    const parsed = previewIdSchema.safeParse(rawPreviewId);
    if (!parsed.success) throw invalidInput('PreviewId inválido.', parsed.error);
    return run(async () => {
      const session = await this.loadSessionByPreviewId(parsed.data);
      if (session === null) return immutableClone([]);
      return immutableClone(session.events.map((event) => mapEvent(event, session)));
    });
  }

  async issueAccessTicket(
    rawInput: PreviewAccessTicketIssueInput,
  ): Promise<PreviewAccessTicketMetadata> {
    this.assertTicketIssueAccess();
    const parsed = previewAccessTicketIssueInputSchema.safeParse(rawInput);
    if (!parsed.success) throw invalidInput('Emissão de ticket de Preview inválida.', parsed.error);
    const input = parsed.data;
    return run(async () => {
      try {
        return await this.client.$transaction(async (transaction) => {
          const session = await transaction.previewSession.findFirst({
            where: { previewId: input.previewId, ...this.ownerExecutionWhere() },
            select: { status: true, expiresAt: true },
          });
          if (session === null) throw notFound('PreviewSession do ticket não encontrada.');
          if (
            session.status !== 'RUNNING' ||
            Date.parse(input.expiresAt) > session.expiresAt.getTime()
          ) {
            throw conflict(
              'Ticket só pode ser emitido para PreviewSession RUNNING e dentro do TTL.',
            );
          }
          const existing = await transaction.previewAccessTicket.findUnique({
            where: { previewSessionId: input.previewId },
          });
          if (existing === null) {
            const ticket = await transaction.previewAccessTicket.create({
              data: {
                previewSessionId: input.previewId,
                ticketHash: input.ticketHash,
                issuedAt: new Date(input.issuedAt),
                expiresAt: new Date(input.expiresAt),
              },
            });
            return mapTicket(ticket as unknown as RawTicket);
          }

          const raw = existing as unknown as RawTicket & { ticketHash: string };
          if (
            raw.ticketHash === input.ticketHash &&
            raw.issuedAt.toISOString() === input.issuedAt &&
            raw.expiresAt.toISOString() === input.expiresAt
          ) {
            return mapTicket(raw);
          }
          const issuedAt = new Date(input.issuedAt);
          if (issuedAt < raw.issuedAt) {
            throw conflict('A rotação do ticket não pode retroceder o instante de emissão.');
          }
          if (raw.consumedAt === null && raw.revokedAt === null && raw.expiresAt > issuedAt) {
            throw conflict('Um ticket one-shot ainda válido não pode ser substituído.');
          }
          const rotated = await transaction.previewAccessTicket.updateMany({
            where: {
              previewSessionId: input.previewId,
              ticketHash: raw.ticketHash,
              OR: [
                { consumedAt: { not: null } },
                { revokedAt: { not: null } },
                { expiresAt: { lte: issuedAt } },
              ],
            },
            data: {
              ticketHash: input.ticketHash,
              issuedAt,
              expiresAt: new Date(input.expiresAt),
              consumedAt: null,
              revokedAt: null,
            },
          });
          if (rotated.count !== 1) {
            const concurrent = await transaction.previewAccessTicket.findUnique({
              where: { previewSessionId: input.previewId },
            });
            if (
              concurrent !== null &&
              concurrent.ticketHash === input.ticketHash &&
              concurrent.issuedAt.toISOString() === input.issuedAt &&
              concurrent.expiresAt.toISOString() === input.expiresAt
            ) {
              return mapTicket(concurrent as unknown as RawTicket);
            }
            throw conflict('Concorrência ao rotacionar o ticket one-shot.');
          }
          const ticket = await transaction.previewAccessTicket.findUnique({
            where: { previewSessionId: input.previewId },
          });
          return mapTicket(ticket as unknown as RawTicket);
        });
      } catch (error) {
        if (persistenceCode(error) !== 'P2002') throw error;
        const concurrent = await this.client.previewAccessTicket.findUnique({
          where: { previewSessionId: input.previewId },
        });
        if (
          concurrent !== null &&
          concurrent.ticketHash === input.ticketHash &&
          concurrent.issuedAt.toISOString() === input.issuedAt &&
          concurrent.expiresAt.toISOString() === input.expiresAt
        ) {
          return mapTicket(concurrent as unknown as RawTicket);
        }
        throw conflict('Ticket criado concorrentemente com metadata divergente.');
      }
    });
  }

  async consumeAccessTicket(
    rawInput: PreviewAccessTicketConsumeInput,
  ): Promise<PreviewAccessTicketRedemption | null> {
    if (this.repositoryAccess.access !== 'TICKET_REDEEM') {
      throw accessError('O consumo de ticket exige a capability TICKET_REDEEM.');
    }
    const parsed = previewAccessTicketConsumeInputSchema.safeParse(rawInput);
    if (!parsed.success) throw invalidInput('Consumo de ticket de Preview inválido.', parsed.error);
    const input = parsed.data;
    const consumedAt = new Date(input.consumedAt);
    return run(async () =>
      this.client.$transaction(async (transaction) => {
        const updated = await transaction.previewAccessTicket.updateMany({
          where: {
            ticketHash: input.ticketHash,
            consumedAt: null,
            revokedAt: null,
            expiresAt: { gt: consumedAt },
            previewSession: { is: { status: 'RUNNING', expiresAt: { gt: consumedAt } } },
          },
          data: { consumedAt },
        });
        if (updated.count !== 1) return null;
        const ticket = await transaction.previewAccessTicket.findUnique({
          where: { ticketHash: input.ticketHash },
          include: {
            previewSession: {
              select: {
                previewId: true,
                expiresAt: true,
                executionRecord: { select: { executionId: true, userId: true } },
              },
            },
          },
        });
        if (ticket?.previewSession.executionRecord.executionId === null || ticket === null) {
          throw new ExecutionRepositoryError('Ticket consumido sem vínculo de execução.', {
            code: EXECUTION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
          });
        }
        return immutableClone(
          previewAccessTicketRedemptionSchema.parse({
            previewId: ticket.previewSession.previewId,
            executionId: ticket.previewSession.executionRecord.executionId,
            ownerUserId: ticket.previewSession.executionRecord.userId,
            expiresAt: ticket.expiresAt.toISOString(),
          }),
        );
      }),
    );
  }

  async revokeAccessTicket(
    rawInput: PreviewAccessTicketRevokeInput,
  ): Promise<PreviewAccessTicketMetadata | null> {
    this.assertTicketIssueAccess();
    const parsed = previewAccessTicketRevokeInputSchema.safeParse(rawInput);
    if (!parsed.success)
      throw invalidInput('Revogação de ticket de Preview inválida.', parsed.error);
    const input = parsed.data;
    return run(async () => {
      const session = await this.loadSessionByPreviewId(input.previewId);
      if (session === null) return null;
      const ticket = await this.client.previewAccessTicket.findUnique({
        where: { previewSessionId: input.previewId },
      });
      if (ticket === null) return null;
      const raw = ticket as unknown as RawTicket;
      if (Date.parse(input.revokedAt) < raw.issuedAt.getTime()) {
        throw conflict('A revogação do ticket não pode anteceder sua emissão.');
      }
      if (raw.revokedAt !== null) return mapTicket(raw);
      const revoked = await this.client.previewAccessTicket.update({
        where: { previewSessionId: input.previewId },
        data: { revokedAt: new Date(input.revokedAt) },
      });
      return mapTicket(revoked as unknown as RawTicket);
    });
  }
}
