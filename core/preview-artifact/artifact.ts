import type {
  ApprovePreviewArtifactInput,
  ApprovedPreviewArtifact,
  ApprovedPreviewArtifactDescriptor,
  CreatePreviewArtifactCandidateInput,
  PreviewArtifact,
  PreviewArtifactCandidate,
  PreviewArtifactDescriptor,
} from './contracts';
import { PREVIEW_ARTIFACT_ERROR_CODES, PreviewArtifactError } from './errors';
import {
  calculatePreviewArtifactApprovalHash,
  calculatePreviewArtifactContentHash,
  calculatePreviewArtifactFileContentHash,
  calculatePreviewArtifactHash,
  derivePreviewArtifactId,
} from './hashing';
import { immutableClone } from './immutability';
import {
  approvedPreviewArtifactSchema,
  previewArtifactCandidateSchema,
  previewArtifactDescriptorSchema,
} from './schemas';
import {
  PREVIEW_ARTIFACT_CONTRACT_VERSION,
  PREVIEW_ARTIFACT_HASH_ALGORITHM,
  PREVIEW_ARTIFACT_VERSION,
} from './version';

function errorForInvalidArtifact(message: string, cause: unknown): PreviewArtifactError {
  return new PreviewArtifactError(message, {
    code: PREVIEW_ARTIFACT_ERROR_CODES.INVALID_INPUT,
    cause,
  });
}

export function createPreviewArtifactCandidate(
  input: CreatePreviewArtifactCandidateInput,
): PreviewArtifactCandidate {
  const files = [...input.files]
    .map((file) => ({
      path: file.path,
      content: file.content,
      encoding: 'UTF-8' as const,
      mediaType: file.mediaType,
      byteLength: Buffer.byteLength(file.content, 'utf8'),
      contentHash: calculatePreviewArtifactFileContentHash(file.content),
    }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const source = {
    executionId: input.executionId,
    workspaceHash: input.workspaceHash,
    sandboxRequestHash: input.sandboxRequestHash,
  };
  const artifactContentHash = calculatePreviewArtifactContentHash(files);
  const artifactHash = calculatePreviewArtifactHash({
    profileId: input.profileId,
    exporterVersion: input.exporterVersion,
    source,
    files,
    artifactContentHash,
  });
  try {
    return immutableClone(
      previewArtifactCandidateSchema.parse({
        artifactId: derivePreviewArtifactId(artifactHash),
        status: 'CANDIDATE',
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        consumedAt: null,
        deletedAt: null,
        metadata: {
          artifactVersion: PREVIEW_ARTIFACT_VERSION,
          contractVersion: PREVIEW_ARTIFACT_CONTRACT_VERSION,
          hashAlgorithm: PREVIEW_ARTIFACT_HASH_ALGORITHM,
          profileId: input.profileId,
          exporterVersion: input.exporterVersion,
          fileCount: files.length,
          totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
        },
        source,
        approval: null,
        hashes: { artifactContentHash, artifactHash, approvalHash: null },
        files,
      }),
    );
  } catch (error) {
    throw errorForInvalidArtifact('O PreviewArtifact candidato é inválido.', error);
  }
}

export function approvePreviewArtifact(
  input: ApprovePreviewArtifactInput,
): ApprovedPreviewArtifact {
  let candidate: PreviewArtifactCandidate;
  try {
    candidate = previewArtifactCandidateSchema.parse(input.candidate);
  } catch (error) {
    throw errorForInvalidArtifact(
      'Somente um PreviewArtifact candidato íntegro pode ser aprovado.',
      error,
    );
  }
  if (Date.parse(input.approvedAt) >= Date.parse(candidate.expiresAt)) {
    throw new PreviewArtifactError('Um PreviewArtifact expirado não pode ser aprovado.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.EXPIRED,
      artifactId: candidate.artifactId,
    });
  }
  if (
    input.workspaceHash !== candidate.source.workspaceHash ||
    input.sandboxRequestHash !== candidate.source.sandboxRequestHash
  ) {
    throw new PreviewArtifactError('A aprovação não corresponde ao Workspace ou Sandbox request.', {
      code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
      artifactId: candidate.artifactId,
    });
  }
  const approval = {
    factoryStatus: input.factoryStatus,
    sandboxStatus: input.sandboxStatus,
    workspaceReleaseStatus: input.workspaceReleaseStatus,
    factoryResultHash: input.factoryResultHash,
    sandboxResultHash: input.sandboxResultHash,
    approvedAt: input.approvedAt,
  };
  const approvalHash = calculatePreviewArtifactApprovalHash({
    artifactId: candidate.artifactId,
    artifactHash: candidate.hashes.artifactHash,
    artifactContentHash: candidate.hashes.artifactContentHash,
    executionId: candidate.source.executionId,
    workspaceHash: candidate.source.workspaceHash,
    sandboxRequestHash: candidate.source.sandboxRequestHash,
    sandboxResultHash: input.sandboxResultHash,
    factoryResultHash: input.factoryResultHash,
  });
  try {
    return immutableClone(
      approvedPreviewArtifactSchema.parse({
        ...candidate,
        status: 'APPROVED',
        approval,
        hashes: { ...candidate.hashes, approvalHash },
      }),
    );
  } catch (error) {
    throw errorForInvalidArtifact('A aprovação do PreviewArtifact é inválida.', error);
  }
}

export function projectPreviewArtifactDescriptor(
  artifact: PreviewArtifact,
): PreviewArtifactDescriptor {
  const { files: _files, ...descriptor } = artifact;
  void _files;
  return immutableClone(previewArtifactDescriptorSchema.parse(descriptor));
}

export function projectApprovedPreviewArtifactDescriptor(
  artifact: ApprovedPreviewArtifact,
): ApprovedPreviewArtifactDescriptor {
  return projectPreviewArtifactDescriptor(artifact) as ApprovedPreviewArtifactDescriptor;
}
