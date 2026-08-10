import { isDeepStrictEqual } from 'node:util';

import type {
  PreviewArtifact,
  PreviewArtifactCandidate,
  PreviewArtifactContentStore,
  PreviewArtifactStoreOptions,
} from './contracts';
import {
  projectApprovedPreviewArtifactDescriptor,
  projectPreviewArtifactDescriptor,
} from './artifact';
import { PREVIEW_ARTIFACT_ERROR_CODES, PreviewArtifactError } from './errors';
import { immutableClone } from './immutability';
import {
  approvedPreviewArtifactSchema,
  previewArtifactCandidateSchema,
  previewArtifactSchema,
} from './schemas';

function assertNotAborted(options: PreviewArtifactStoreOptions | undefined): void {
  if (options?.signal?.aborted) {
    throw new PreviewArtifactError('A operação do PreviewArtifact foi cancelada.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.STORE_FAILURE,
    });
  }
}

function required(entries: Map<string, PreviewArtifact>, artifactId: string): PreviewArtifact {
  const artifact = entries.get(artifactId);
  if (artifact === undefined) {
    throw new PreviewArtifactError('O PreviewArtifact não foi encontrado.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.NOT_FOUND,
      artifactId,
    });
  }
  return artifact;
}

export function createInMemoryPreviewArtifactContentStore(): PreviewArtifactContentStore {
  const entries = new Map<string, PreviewArtifact>();
  return {
    async stage(candidate, options) {
      assertNotAborted(options);
      const parsed = previewArtifactCandidateSchema.parse(candidate) as PreviewArtifactCandidate;
      const existing = entries.get(parsed.artifactId);
      if (existing !== undefined && existing.hashes.artifactHash !== parsed.hashes.artifactHash) {
        throw new PreviewArtifactError('ArtifactId já existe com conteúdo divergente.', {
          code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
          artifactId: parsed.artifactId,
        });
      }
      if (existing === undefined) entries.set(parsed.artifactId, immutableClone(parsed));
      return projectPreviewArtifactDescriptor(entries.get(parsed.artifactId)!);
    },

    async approve(artifact, options) {
      assertNotAborted(options);
      const parsed = immutableClone(approvedPreviewArtifactSchema.parse(artifact));
      const existing = required(entries, parsed.artifactId);
      if (existing.hashes.artifactHash !== parsed.hashes.artifactHash) {
        throw new PreviewArtifactError('A aprovação não corresponde ao artifact staged.', {
          code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
          artifactId: parsed.artifactId,
        });
      }
      if (existing.status !== 'CANDIDATE' && existing.status !== 'APPROVED') {
        throw new PreviewArtifactError('Transição de aprovação inválida.', {
          code: PREVIEW_ARTIFACT_ERROR_CODES.INVALID_TRANSITION,
          artifactId: parsed.artifactId,
        });
      }
      if (existing.status === 'APPROVED') {
        if (!isDeepStrictEqual(existing, parsed)) {
          throw new PreviewArtifactError('A aprovação existente é imutável.', {
            code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
            artifactId: parsed.artifactId,
          });
        }
        return projectApprovedPreviewArtifactDescriptor(existing);
      }
      const stagedCandidate = previewArtifactCandidateSchema.parse({
        ...parsed,
        status: 'CANDIDATE',
        approval: null,
        hashes: { ...parsed.hashes, approvalHash: null },
      });
      if (!isDeepStrictEqual(existing, stagedCandidate)) {
        throw new PreviewArtifactError('A aprovação diverge do artifact staged.', {
          code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
          artifactId: parsed.artifactId,
        });
      }
      entries.set(parsed.artifactId, parsed);
      return projectApprovedPreviewArtifactDescriptor(parsed);
    },

    async readApproved(artifactId, options) {
      assertNotAborted(options);
      const artifact = entries.get(artifactId);
      if (artifact?.status !== 'APPROVED') return null;
      return immutableClone(approvedPreviewArtifactSchema.parse(artifact));
    },

    async consume(artifactId, consumedAt, options) {
      assertNotAborted(options);
      const artifact = required(entries, artifactId);
      if (artifact.status !== 'APPROVED') {
        throw new PreviewArtifactError('Somente um artifact aprovado pode ser consumido.', {
          code: PREVIEW_ARTIFACT_ERROR_CODES.INVALID_TRANSITION,
          artifactId,
        });
      }
      const consumed = immutableClone(
        previewArtifactSchema.parse({ ...artifact, status: 'CONSUMED', consumedAt }),
      );
      entries.set(artifactId, consumed);
      return projectPreviewArtifactDescriptor(consumed);
    },

    async expire(artifactId, _expiredAt, options) {
      assertNotAborted(options);
      const artifact = required(entries, artifactId);
      if (!['CANDIDATE', 'APPROVED'].includes(artifact.status)) {
        throw new PreviewArtifactError('O artifact não pode expirar neste estado.', {
          code: PREVIEW_ARTIFACT_ERROR_CODES.INVALID_TRANSITION,
          artifactId,
        });
      }
      const expired = immutableClone(
        previewArtifactSchema.parse({ ...artifact, status: 'EXPIRED' }),
      );
      entries.set(artifactId, expired);
      return projectPreviewArtifactDescriptor(expired);
    },

    async remove(artifactId, deletedAt, options) {
      assertNotAborted(options);
      const artifact = entries.get(artifactId);
      if (artifact === undefined) return null;
      if (artifact.status === 'DELETED') return projectPreviewArtifactDescriptor(artifact);
      const deleted = immutableClone(
        previewArtifactSchema.parse({
          ...artifact,
          status: 'DELETED',
          consumedAt: null,
          deletedAt,
        }),
      );
      entries.set(artifactId, deleted);
      return projectPreviewArtifactDescriptor(deleted);
    },
  };
}
