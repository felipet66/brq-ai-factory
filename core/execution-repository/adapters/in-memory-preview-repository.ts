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

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const GENERIC_FAILURE_MESSAGE = 'A sessão de Preview falhou.';

export interface InMemoryPreviewExecutionMetadata {
  readonly executionId: string;
  readonly ownerUserId: string;
  readonly status: string;
  readonly factoryResult: {
    readonly status: string;
    readonly sandboxStatus: string;
    readonly workspaceReleaseStatus: string;
    readonly factoryResultHash: string;
    readonly workspaceHash: string;
    readonly sandboxRequestHash: string;
    readonly sandboxResultHash: string;
  } | null;
}

export interface InMemoryPreviewRepositoryDatabase {
  repository(access: PreviewRepositoryAccess): PreviewPersistenceRepository;
}

interface StoredArtifact {
  readonly descriptor: PreviewArtifactDescriptor;
  readonly executionId: string;
  readonly revision: number;
}

interface StoredSession {
  readonly session: PreviewSession;
  readonly ownerUserId: string;
  readonly events: readonly PreviewSessionEvent[];
}

interface StoredTicket {
  readonly previewId: string;
  readonly ticketHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly revokedAt: string | null;
}

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
    access.userId.length <= 128
  ) {
    return Object.freeze({ access: 'OWNER', userId: access.userId });
  }
  throw accessError('Capability de persistência do Preview inválida.');
}

function parseExecution(raw: InMemoryPreviewExecutionMetadata): InMemoryPreviewExecutionMetadata {
  if (
    typeof raw.executionId !== 'string' ||
    raw.executionId.length === 0 ||
    raw.executionId.length > 128 ||
    typeof raw.ownerUserId !== 'string' ||
    raw.ownerUserId.trim() !== raw.ownerUserId ||
    raw.ownerUserId.length === 0 ||
    raw.ownerUserId.length > 128 ||
    typeof raw.status !== 'string' ||
    raw.status.length === 0
  ) {
    throw invalidInput('Seed de execução do Preview inválido.');
  }
  if (
    raw.factoryResult !== null &&
    (!HASH_PATTERN.test(raw.factoryResult.factoryResultHash) ||
      !HASH_PATTERN.test(raw.factoryResult.workspaceHash) ||
      !HASH_PATTERN.test(raw.factoryResult.sandboxRequestHash) ||
      !HASH_PATTERN.test(raw.factoryResult.sandboxResultHash))
  ) {
    throw invalidInput('Hashes do seed de FactoryResult inválidos.');
  }
  return immutableClone(raw);
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
  execution: InMemoryPreviewExecutionMetadata,
  artifact: PreviewArtifactDescriptor,
): void {
  if (artifact.approval === null) return;
  const factory = execution.factoryResult;
  if (
    execution.status !== 'SUCCESS' ||
    factory?.status !== 'SUCCESS' ||
    factory.sandboxStatus !== 'SUCCESS' ||
    factory.workspaceReleaseStatus !== 'RELEASED' ||
    factory.factoryResultHash !== artifact.approval.factoryResultHash ||
    factory.workspaceHash !== artifact.source.workspaceHash ||
    factory.sandboxRequestHash !== artifact.source.sandboxRequestHash ||
    factory.sandboxResultHash !== artifact.approval.sandboxResultHash
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

function sanitizeFailureSourceCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/gu, '_')
    .slice(0, 128);
  return sanitized.length === 0 ? null : sanitized;
}

function projectFailureMessage(session: PreviewSession): PreviewSession {
  if (session.failure === null) return immutableClone(session);
  return immutableClone(
    previewSessionSchema.parse({
      ...session,
      failure: {
        ...session.failure,
        sourceCode: sanitizeFailureSourceCode(session.failure.sourceCode),
        message: GENERIC_FAILURE_MESSAGE,
      },
    }),
  );
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
  if (
    current.provenance.runtime !== null &&
    !isDeepStrictEqual(current.provenance.runtime, next.provenance.runtime)
  ) {
    throw conflict('A provenance de runtime da PreviewSession é imutável após observada.');
  }
  if (
    current.provenance.runtime === null &&
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

function ticketMetadata(ticket: StoredTicket): PreviewAccessTicketMetadata {
  return immutableClone(
    previewAccessTicketMetadataSchema.parse({
      previewId: ticket.previewId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      consumedAt: ticket.consumedAt,
      revokedAt: ticket.revokedAt,
    }),
  );
}

export function createInMemoryPreviewRepositoryDatabase(
  executionSeeds: readonly InMemoryPreviewExecutionMetadata[],
): InMemoryPreviewRepositoryDatabase {
  const executions = new Map<string, InMemoryPreviewExecutionMetadata>();
  for (const seed of executionSeeds) {
    const execution = parseExecution(seed);
    if (executions.has(execution.executionId)) {
      throw conflict('ExecutionId duplicado no seed de persistência do Preview.');
    }
    executions.set(execution.executionId, execution);
  }
  const artifacts = new Map<string, StoredArtifact>();
  const sessions = new Map<string, StoredSession>();
  const executionSessions = new Map<string, string>();
  const tickets = new Map<string, StoredTicket>();
  const ticketHashes = new Map<string, string>();

  const repository = (rawAccess: PreviewRepositoryAccess): PreviewPersistenceRepository => {
    const access = parseAccess(rawAccess);

    const assertSessionAccess = (): void => {
      if (access.access === 'TICKET_REDEEM') {
        throw accessError('A capability de redeem não permite operar PreviewSessions.');
      }
    };
    const assertTicketIssueAccess = (): void => {
      if (access.access === 'TICKET_REDEEM') {
        throw accessError('A capability de redeem não permite emitir ou revogar tickets.');
      }
    };
    const ownerCanAccess = (ownerUserId: string): boolean =>
      access.access !== 'OWNER' || access.userId === ownerUserId;
    const accessibleSession = (previewId: string): StoredSession | undefined => {
      const stored = sessions.get(previewId);
      return stored !== undefined && ownerCanAccess(stored.ownerUserId) ? stored : undefined;
    };

    return Object.freeze({
      async saveArtifactMetadata(
        rawArtifact: PreviewArtifactDescriptor,
      ): Promise<PreviewArtifactDescriptor> {
        if (access.access !== 'INTERNAL') {
          throw accessError('Somente a capability interna pode persistir metadata de artifact.');
        }
        const parsed = previewArtifactDescriptorSchema.safeParse(rawArtifact);
        if (!parsed.success)
          throw invalidInput('Descriptor de PreviewArtifact inválido.', parsed.error);
        const artifact = immutableClone(parsed.data);
        const execution = executions.get(artifact.source.executionId);
        if (execution === undefined) throw notFound('Execução do PreviewArtifact não encontrada.');
        const existing = artifacts.get(artifact.artifactId);
        if (existing === undefined) {
          if (artifact.status !== 'CANDIDATE') {
            throw conflict('O primeiro estado persistido do PreviewArtifact deve ser CANDIDATE.');
          }
          artifacts.set(artifact.artifactId, {
            descriptor: artifact,
            executionId: execution.executionId,
            revision: 0,
          });
          return immutableClone(artifact);
        }
        if (isDeepStrictEqual(existing.descriptor, artifact)) {
          return immutableClone(existing.descriptor);
        }
        assertArtifactTransition(existing.descriptor, artifact);
        assertFactoryBinding(execution, artifact);
        artifacts.set(artifact.artifactId, {
          descriptor: artifact,
          executionId: existing.executionId,
          revision: existing.revision + 1,
        });
        return immutableClone(artifact);
      },

      async findArtifactMetadataByArtifactId(rawArtifactId: string) {
        if (access.access === 'TICKET_REDEEM') {
          throw accessError('A capability de redeem não permite ler artifacts.');
        }
        const parsed = previewArtifactIdSchema.safeParse(rawArtifactId);
        if (!parsed.success) throw invalidInput('ArtifactId de Preview inválido.', parsed.error);
        const stored = artifacts.get(parsed.data);
        if (stored === undefined) return null;
        const execution = executions.get(stored.executionId)!;
        return ownerCanAccess(execution.ownerUserId) ? immutableClone(stored.descriptor) : null;
      },

      async findArtifactMetadataByExecutionId(executionId: string) {
        if (access.access === 'TICKET_REDEEM') {
          throw accessError('A capability de redeem não permite ler artifacts.');
        }
        const execution = executions.get(executionId);
        if (execution === undefined || !ownerCanAccess(execution.ownerUserId)) return null;
        const matches = [...artifacts.values()]
          .filter((artifact) => artifact.executionId === executionId)
          .sort(
            (left, right) =>
              Date.parse(right.descriptor.createdAt) - Date.parse(left.descriptor.createdAt),
          );
        return matches[0] === undefined ? null : immutableClone(matches[0].descriptor);
      },

      async createOrGet(
        rawSession: PreviewSession,
        rawEvent: PreviewSessionEvent,
      ): Promise<PreviewSessionStoreMutationResult> {
        assertSessionAccess();
        const parsedSession = previewSessionSchema.safeParse(rawSession);
        const parsedEvent = previewSessionEventSchema.safeParse(rawEvent);
        if (!parsedSession.success)
          throw invalidInput('PreviewSession inválida.', parsedSession.error);
        if (!parsedEvent.success)
          throw invalidInput('Evento inicial de Preview inválido.', parsedEvent.error);
        const session = projectFailureMessage(parsedSession.data);
        const event = immutableClone(parsedEvent.data);
        if (session.status !== 'CREATED' || session.revision !== 0 || event.sequence !== 1) {
          throw conflict('A criação da PreviewSession exige CREATED na revisão zero.');
        }
        assertEventMatchesSession(event, session);
        const indexedId = executionSessions.get(session.executionId);
        const existing =
          sessions.get(session.previewId) ??
          (indexedId === undefined ? undefined : sessions.get(indexedId));
        if (existing !== undefined) {
          if (!ownerCanAccess(existing.ownerUserId)) {
            throw notFound('Execução da PreviewSession não encontrada.');
          }
          if (existing.session.hashes.previewSessionHash !== session.hashes.previewSessionHash) {
            throw conflict('Já existe PreviewSession divergente para a execução.');
          }
          return immutableClone({ created: false, session: existing.session });
        }
        const execution = executions.get(session.executionId);
        if (execution === undefined || !ownerCanAccess(execution.ownerUserId)) {
          throw notFound('Execução da PreviewSession não encontrada.');
        }
        const storedArtifact = artifacts.get(session.artifactId);
        if (storedArtifact === undefined || storedArtifact.executionId !== session.executionId) {
          throw notFound('PreviewArtifact da sessão não encontrado.');
        }
        const descriptor = storedArtifact.descriptor;
        if (
          descriptor.status !== 'APPROVED' ||
          descriptor.approval === null ||
          descriptor.hashes.approvalHash === null ||
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
        assertFactoryBinding(execution, descriptor);
        sessions.set(session.previewId, {
          session,
          ownerUserId: execution.ownerUserId,
          events: [event],
        });
        executionSessions.set(session.executionId, session.previewId);
        return immutableClone({ created: true, session });
      },

      async getByPreviewId(rawPreviewId: string) {
        assertSessionAccess();
        const parsed = previewIdSchema.safeParse(rawPreviewId);
        if (!parsed.success) throw invalidInput('PreviewId inválido.', parsed.error);
        const stored = accessibleSession(parsed.data);
        return stored === undefined ? null : immutableClone(stored.session);
      },

      async getByExecutionId(executionId: string) {
        assertSessionAccess();
        const previewId = executionSessions.get(executionId);
        if (previewId === undefined) return null;
        const stored = accessibleSession(previewId);
        return stored === undefined ? null : immutableClone(stored.session);
      },

      async replace(
        expectedRevision: number,
        rawSession: PreviewSession,
        rawEvent: PreviewSessionEvent,
      ) {
        assertSessionAccess();
        if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
          throw invalidInput('Revisão esperada da PreviewSession inválida.');
        }
        const parsedSession = previewSessionSchema.safeParse(rawSession);
        const parsedEvent = previewSessionEventSchema.safeParse(rawEvent);
        if (!parsedSession.success)
          throw invalidInput('PreviewSession inválida.', parsedSession.error);
        if (!parsedEvent.success)
          throw invalidInput('Evento de Preview inválido.', parsedEvent.error);
        const session = projectFailureMessage(parsedSession.data);
        const event = immutableClone(parsedEvent.data);
        assertEventMatchesSession(event, session);
        const stored = accessibleSession(session.previewId);
        if (stored === undefined) throw notFound('PreviewSession não encontrada.');
        if (stored.session.revision !== expectedRevision) {
          throw conflict('A revisão esperada da PreviewSession está desatualizada.');
        }
        assertSessionTransition(stored.session, session);
        if (event.sequence !== stored.events.length + 1) {
          throw conflict('A sequência do evento de Preview é inválida.');
        }
        sessions.set(session.previewId, {
          session,
          ownerUserId: stored.ownerUserId,
          events: [...stored.events, event],
        });
        const ticket = tickets.get(session.previewId);
        if (
          ticket !== undefined &&
          ticket.revokedAt === null &&
          ['STOPPING', 'STOPPED', 'EXPIRED', 'FAILED'].includes(session.status)
        ) {
          tickets.set(
            session.previewId,
            immutableClone({ ...ticket, revokedAt: event.occurredAt }),
          );
        }
        return immutableClone(session);
      },

      async listEvents(rawPreviewId: string) {
        assertSessionAccess();
        const parsed = previewIdSchema.safeParse(rawPreviewId);
        if (!parsed.success) throw invalidInput('PreviewId inválido.', parsed.error);
        const stored = accessibleSession(parsed.data);
        return immutableClone(stored?.events ?? []);
      },

      async issueAccessTicket(
        rawInput: PreviewAccessTicketIssueInput,
      ): Promise<PreviewAccessTicketMetadata> {
        assertTicketIssueAccess();
        const parsed = previewAccessTicketIssueInputSchema.safeParse(rawInput);
        if (!parsed.success)
          throw invalidInput('Emissão de ticket de Preview inválida.', parsed.error);
        const input = parsed.data;
        const storedSession = accessibleSession(input.previewId);
        if (storedSession === undefined) throw notFound('PreviewSession do ticket não encontrada.');
        if (
          storedSession.session.status !== 'RUNNING' ||
          Date.parse(input.expiresAt) > Date.parse(storedSession.session.expiresAt)
        ) {
          throw conflict('Ticket só pode ser emitido para PreviewSession RUNNING e dentro do TTL.');
        }
        const existing = tickets.get(input.previewId);
        if (existing !== undefined) {
          if (
            existing.ticketHash === input.ticketHash &&
            existing.issuedAt === input.issuedAt &&
            existing.expiresAt === input.expiresAt
          ) {
            return ticketMetadata(existing);
          }
          if (Date.parse(input.issuedAt) < Date.parse(existing.issuedAt)) {
            throw conflict('A rotação do ticket não pode retroceder o instante de emissão.');
          }
          if (
            existing.consumedAt === null &&
            existing.revokedAt === null &&
            Date.parse(existing.expiresAt) > Date.parse(input.issuedAt)
          ) {
            throw conflict('Um ticket one-shot ainda válido não pode ser substituído.');
          }
          if (
            ticketHashes.has(input.ticketHash) &&
            ticketHashes.get(input.ticketHash) !== input.previewId
          ) {
            throw conflict('TicketHash de Preview duplicado.');
          }
          ticketHashes.delete(existing.ticketHash);
          const rotated = immutableClone({
            previewId: input.previewId,
            ticketHash: input.ticketHash,
            issuedAt: input.issuedAt,
            expiresAt: input.expiresAt,
            consumedAt: null,
            revokedAt: null,
          });
          tickets.set(input.previewId, rotated);
          ticketHashes.set(input.ticketHash, input.previewId);
          return ticketMetadata(rotated);
        }
        if (ticketHashes.has(input.ticketHash)) throw conflict('TicketHash de Preview duplicado.');
        const ticket: StoredTicket = immutableClone({
          previewId: input.previewId,
          ticketHash: input.ticketHash,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          consumedAt: null,
          revokedAt: null,
        });
        tickets.set(input.previewId, ticket);
        ticketHashes.set(input.ticketHash, input.previewId);
        return ticketMetadata(ticket);
      },

      async consumeAccessTicket(
        rawInput: PreviewAccessTicketConsumeInput,
      ): Promise<PreviewAccessTicketRedemption | null> {
        if (access.access !== 'TICKET_REDEEM') {
          throw accessError('O consumo de ticket exige a capability TICKET_REDEEM.');
        }
        const parsed = previewAccessTicketConsumeInputSchema.safeParse(rawInput);
        if (!parsed.success)
          throw invalidInput('Consumo de ticket de Preview inválido.', parsed.error);
        const input = parsed.data;
        const previewId = ticketHashes.get(input.ticketHash);
        if (previewId === undefined) return null;
        const ticket = tickets.get(previewId)!;
        const storedSession = sessions.get(previewId);
        if (
          ticket.consumedAt !== null ||
          ticket.revokedAt !== null ||
          Date.parse(input.consumedAt) >= Date.parse(ticket.expiresAt) ||
          storedSession === undefined ||
          storedSession.session.status !== 'RUNNING' ||
          Date.parse(input.consumedAt) >= Date.parse(storedSession.session.expiresAt)
        ) {
          return null;
        }
        tickets.set(previewId, immutableClone({ ...ticket, consumedAt: input.consumedAt }));
        return immutableClone(
          previewAccessTicketRedemptionSchema.parse({
            previewId,
            executionId: storedSession.session.executionId,
            ownerUserId: storedSession.ownerUserId,
            expiresAt: ticket.expiresAt,
          }),
        );
      },

      async revokeAccessTicket(
        rawInput: PreviewAccessTicketRevokeInput,
      ): Promise<PreviewAccessTicketMetadata | null> {
        assertTicketIssueAccess();
        const parsed = previewAccessTicketRevokeInputSchema.safeParse(rawInput);
        if (!parsed.success)
          throw invalidInput('Revogação de ticket de Preview inválida.', parsed.error);
        const input = parsed.data;
        if (accessibleSession(input.previewId) === undefined) return null;
        const ticket = tickets.get(input.previewId);
        if (ticket === undefined) return null;
        if (Date.parse(input.revokedAt) < Date.parse(ticket.issuedAt)) {
          throw conflict('A revogação do ticket não pode anteceder sua emissão.');
        }
        if (ticket.revokedAt !== null) return ticketMetadata(ticket);
        const revoked = immutableClone({ ...ticket, revokedAt: input.revokedAt });
        tickets.set(input.previewId, revoked);
        return ticketMetadata(revoked);
      },
    });
  };

  return Object.freeze({ repository });
}
