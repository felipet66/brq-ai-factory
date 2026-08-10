import { isDeepStrictEqual } from 'node:util';

import type { PreviewSession, PreviewSessionEvent, PreviewSessionStore } from './contracts';
import {
  PREVIEW_RUNNER_ERROR_CODES,
  PREVIEW_RUNNER_ERROR_STAGES,
  PreviewRunnerError,
} from './errors';
import { immutableClone } from './immutability';
import { canTransitionPreviewSession } from './lifecycle';
import { previewSessionEventSchema, previewSessionSchema } from './schemas';

function conflict(message: string, previewId?: string): PreviewRunnerError {
  return new PreviewRunnerError(message, {
    code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT,
    stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
    ...(previewId === undefined ? {} : { previewId }),
  });
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
    throw conflict('O evento não corresponde à revisão da PreviewSession.', session.previewId);
  }
}

function assertSessionTransition(current: PreviewSession, next: PreviewSession): void {
  if (!isDeepStrictEqual(sessionIdentity(current), sessionIdentity(next))) {
    throw conflict(
      'A identidade imutável da PreviewSession não pode ser alterada.',
      current.previewId,
    );
  }
  if (
    current.provenance.runtime !== null &&
    !isDeepStrictEqual(current.provenance.runtime, next.provenance.runtime)
  ) {
    throw conflict(
      'A provenance de runtime da PreviewSession é imutável após observada.',
      current.previewId,
    );
  }
  if (
    current.provenance.runtime === null &&
    next.provenance.runtime === null &&
    current.hashes.provenanceHash !== next.hashes.provenanceHash
  ) {
    throw conflict(
      'O provenanceHash não pode mudar sem nova observação de runtime.',
      current.previewId,
    );
  }
  if (!canTransitionPreviewSession(current.status, next.status)) {
    throw conflict(
      `Transição de PreviewSession inválida: ${current.status} -> ${next.status}.`,
      current.previewId,
    );
  }
  if (next.revision !== current.revision + 1) {
    throw conflict(
      'A revisão da PreviewSession deve avançar exatamente uma unidade.',
      current.previewId,
    );
  }
}

export function createInMemoryPreviewSessionStore(): PreviewSessionStore {
  const sessions = new Map<string, PreviewSession>();
  const executionIndex = new Map<string, string>();
  const events = new Map<string, PreviewSessionEvent[]>();

  return {
    async createOrGet(session, event) {
      const parsedSession = immutableClone(previewSessionSchema.parse(session));
      const parsedEvent = immutableClone(previewSessionEventSchema.parse(event));
      if (
        parsedSession.status !== 'CREATED' ||
        parsedSession.revision !== 0 ||
        parsedEvent.sequence !== 1
      ) {
        throw conflict(
          'A criação da PreviewSession exige CREATED na revisão zero.',
          parsedSession.previewId,
        );
      }
      assertEventMatchesSession(parsedEvent, parsedSession);
      const indexedId = executionIndex.get(parsedSession.executionId);
      const existing =
        sessions.get(parsedSession.previewId) ??
        (indexedId === undefined ? undefined : sessions.get(indexedId));
      if (existing !== undefined) {
        if (existing.hashes.previewSessionHash !== parsedSession.hashes.previewSessionHash) {
          throw conflict(
            'Já existe PreviewSession divergente para a execução.',
            parsedSession.previewId,
          );
        }
        return immutableClone({ created: false, session: existing });
      }
      sessions.set(parsedSession.previewId, parsedSession);
      executionIndex.set(parsedSession.executionId, parsedSession.previewId);
      events.set(parsedSession.previewId, [parsedEvent]);
      return immutableClone({ created: true, session: parsedSession });
    },

    async getByPreviewId(previewId) {
      const session = sessions.get(previewId);
      return session === undefined ? null : immutableClone(session);
    },

    async getByExecutionId(executionId) {
      const previewId = executionIndex.get(executionId);
      if (previewId === undefined) return null;
      return immutableClone(sessions.get(previewId)!);
    },

    async replace(expectedRevision, session, event) {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw conflict('A revisão esperada da PreviewSession é inválida.', session.previewId);
      }
      const parsedSession = immutableClone(previewSessionSchema.parse(session));
      const parsedEvent = immutableClone(previewSessionEventSchema.parse(event));
      assertEventMatchesSession(parsedEvent, parsedSession);
      const existing = sessions.get(parsedSession.previewId);
      if (existing === undefined) {
        throw new PreviewRunnerError('A PreviewSession não foi encontrada.', {
          code: PREVIEW_RUNNER_ERROR_CODES.NOT_FOUND,
          stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
          previewId: parsedSession.previewId,
        });
      }
      if (existing.revision !== expectedRevision) {
        throw conflict(
          'A PreviewSession foi modificada concorrentemente.',
          parsedSession.previewId,
        );
      }
      assertSessionTransition(existing, parsedSession);
      const sessionEvents = events.get(parsedSession.previewId) ?? [];
      if (parsedEvent.sequence !== sessionEvents.length + 1) {
        throw conflict('A sequência do evento de Preview é inválida.', parsedSession.previewId);
      }
      sessions.set(parsedSession.previewId, parsedSession);
      sessionEvents.push(parsedEvent);
      events.set(parsedSession.previewId, sessionEvents);
      return immutableClone(parsedSession);
    },

    async listEvents(previewId) {
      return immutableClone(events.get(previewId) ?? []);
    },
  };
}
