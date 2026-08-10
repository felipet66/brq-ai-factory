import { isoDateTimeSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import { containsEvidentPreviewSecret, isWellFormedPreviewText } from './content-safety';
import {
  calculatePreviewArtifactApprovalHash,
  calculatePreviewArtifactContentHash,
  calculatePreviewArtifactFileContentHash,
  calculatePreviewArtifactHash,
  derivePreviewArtifactId,
} from './hashing';
import { PREVIEW_ARTIFACT_STATUSES } from './lifecycle';
import { PREVIEW_ARTIFACT_ABSOLUTE_LIMITS } from './limits';
import {
  assertNoPreviewArtifactPathCollisions,
  inspectSafePreviewArtifactPath,
  PREVIEW_ARTIFACT_MEDIA_TYPES,
} from './path-safety';
import {
  PREVIEW_ARTIFACT_CONTRACT_VERSION,
  PREVIEW_ARTIFACT_HASH_ALGORITHM,
  PREVIEW_ARTIFACT_VERSION,
} from './version';

const HASH = /^[a-f0-9]{64}$/u;
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/u;
const TECHNICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export const previewArtifactHashSchema = z.string().regex(HASH);
export const previewArtifactIdSchema = z.string().regex(/^preview-artifact-[a-f0-9]{32}$/u);
export const previewArtifactProfileIdSchema = z.literal('NODE_WEB_PREVIEW_24_V1');
export const previewArtifactStatusSchema = z.enum(PREVIEW_ARTIFACT_STATUSES);
export const previewArtifactMediaTypeSchema = z.enum(PREVIEW_ARTIFACT_MEDIA_TYPES);

export const previewArtifactExportEnvelopeSchema = z
  .object({
    abiVersion: z.literal('1.0.0'),
    profileId: previewArtifactProfileIdSchema,
    exporterVersion: z.string().regex(SEMANTIC_VERSION),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(PREVIEW_ARTIFACT_ABSOLUTE_LIMITS.maxPathBytes),
            content: z.string(),
            mediaType: previewArtifactMediaTypeSchema,
          })
          .strict(),
      )
      .min(1)
      .max(PREVIEW_ARTIFACT_ABSOLUTE_LIMITS.maxFiles),
  })
  .strict();

export const previewArtifactFileSchema = z
  .object({
    path: z.string().min(1).max(PREVIEW_ARTIFACT_ABSOLUTE_LIMITS.maxPathBytes),
    content: z
      .string()
      .refine(isWellFormedPreviewText, 'O artifact deve conter apenas texto UTF-8 seguro.')
      .refine(
        (value) => !containsEvidentPreviewSecret(value),
        'Conteúdo com padrão evidente de segredo não é permitido.',
      ),
    encoding: z.literal('UTF-8'),
    mediaType: previewArtifactMediaTypeSchema,
    byteLength: z.number().int().nonnegative().max(PREVIEW_ARTIFACT_ABSOLUTE_LIMITS.maxFileBytes),
    contentHash: previewArtifactHashSchema,
  })
  .strict()
  .superRefine((file, context) => {
    const byteLength = Buffer.byteLength(file.content, 'utf8');
    if (file.byteLength !== byteLength) {
      context.addIssue({ code: 'custom', path: ['byteLength'], message: 'Byte length inválido.' });
    }
    if (file.contentHash !== calculatePreviewArtifactFileContentHash(file.content)) {
      context.addIssue({
        code: 'custom',
        path: ['contentHash'],
        message: 'Content hash inválido.',
      });
    }
    try {
      inspectSafePreviewArtifactPath(file.path, file.mediaType, PREVIEW_ARTIFACT_ABSOLUTE_LIMITS);
    } catch {
      context.addIssue({ code: 'custom', path: ['path'], message: 'Path não permitido.' });
    }
  });

export const previewArtifactSourceSchema = z
  .object({
    executionId: z.string().regex(TECHNICAL_ID),
    workspaceHash: previewArtifactHashSchema,
    sandboxRequestHash: previewArtifactHashSchema,
  })
  .strict();

export const previewArtifactApprovalSchema = z
  .object({
    factoryStatus: z.literal('SUCCESS'),
    sandboxStatus: z.literal('SUCCESS'),
    workspaceReleaseStatus: z.literal('RELEASED'),
    factoryResultHash: previewArtifactHashSchema,
    sandboxResultHash: previewArtifactHashSchema,
    approvedAt: isoDateTimeSchema,
  })
  .strict();

const previewArtifactHashesSchema = z
  .object({
    artifactContentHash: previewArtifactHashSchema,
    artifactHash: previewArtifactHashSchema,
    approvalHash: previewArtifactHashSchema.nullable(),
  })
  .strict();

const previewArtifactMetadataSchema = z
  .object({
    artifactVersion: z.literal(PREVIEW_ARTIFACT_VERSION),
    contractVersion: z.literal(PREVIEW_ARTIFACT_CONTRACT_VERSION),
    hashAlgorithm: z.literal(PREVIEW_ARTIFACT_HASH_ALGORITHM),
    profileId: previewArtifactProfileIdSchema,
    exporterVersion: z.string().regex(SEMANTIC_VERSION),
    fileCount: z.number().int().positive().max(PREVIEW_ARTIFACT_ABSOLUTE_LIMITS.maxFiles),
    totalBytes: z.number().int().positive().max(PREVIEW_ARTIFACT_ABSOLUTE_LIMITS.maxTotalBytes),
  })
  .strict();

const previewArtifactBaseShape = {
  artifactId: previewArtifactIdSchema,
  status: previewArtifactStatusSchema,
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  consumedAt: isoDateTimeSchema.nullable(),
  deletedAt: isoDateTimeSchema.nullable(),
  metadata: previewArtifactMetadataSchema,
  source: previewArtifactSourceSchema,
  approval: previewArtifactApprovalSchema.nullable(),
  hashes: previewArtifactHashesSchema,
} as const;

interface ArtifactCrossFieldValue {
  readonly artifactId: string;
  readonly status: (typeof PREVIEW_ARTIFACT_STATUSES)[number];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly deletedAt: string | null;
  readonly metadata: z.infer<typeof previewArtifactMetadataSchema>;
  readonly source: z.infer<typeof previewArtifactSourceSchema>;
  readonly approval: z.infer<typeof previewArtifactApprovalSchema> | null;
  readonly hashes: z.infer<typeof previewArtifactHashesSchema>;
}

function validateArtifactLifecycle(
  artifact: ArtifactCrossFieldValue,
  context: z.core.$RefinementCtx,
): void {
  if (Date.parse(artifact.expiresAt) <= Date.parse(artifact.createdAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiração inválida.' });
  }
  const approved = artifact.approval !== null && artifact.hashes.approvalHash !== null;
  if ((artifact.approval === null) !== (artifact.hashes.approvalHash === null)) {
    context.addIssue({ code: 'custom', message: 'Approval e approvalHash devem coexistir.' });
  }
  if (artifact.status === 'CANDIDATE' && approved) {
    context.addIssue({ code: 'custom', message: 'Candidate não pode estar aprovado.' });
  }
  if (['APPROVED', 'CONSUMED'].includes(artifact.status) && !approved) {
    context.addIssue({ code: 'custom', message: 'Status exige aprovação íntegra.' });
  }
  if ((artifact.status === 'CONSUMED') !== (artifact.consumedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['consumedAt'], message: 'Consumo inconsistente.' });
  }
  if ((artifact.status === 'DELETED') !== (artifact.deletedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['deletedAt'], message: 'Remoção inconsistente.' });
  }
  if (artifact.approval !== null && artifact.hashes.approvalHash !== null) {
    const expected = calculatePreviewArtifactApprovalHash({
      artifactId: artifact.artifactId,
      artifactHash: artifact.hashes.artifactHash,
      artifactContentHash: artifact.hashes.artifactContentHash,
      executionId: artifact.source.executionId,
      workspaceHash: artifact.source.workspaceHash,
      sandboxRequestHash: artifact.source.sandboxRequestHash,
      sandboxResultHash: artifact.approval.sandboxResultHash,
      factoryResultHash: artifact.approval.factoryResultHash,
    });
    if (artifact.hashes.approvalHash !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['hashes', 'approvalHash'],
        message: 'Approval hash inválido.',
      });
    }
  }
}

export const previewArtifactDescriptorSchema = z
  .object(previewArtifactBaseShape)
  .strict()
  .superRefine(validateArtifactLifecycle);

export const previewArtifactSchema = z
  .object({
    ...previewArtifactBaseShape,
    files: z.array(previewArtifactFileSchema).min(1).max(PREVIEW_ARTIFACT_ABSOLUTE_LIMITS.maxFiles),
  })
  .strict()
  .superRefine((artifact, context) => {
    validateArtifactLifecycle(artifact, context);
    const inspected = [];
    let totalBytes = 0;
    let previousPath: string | undefined;
    for (const [index, file] of artifact.files.entries()) {
      totalBytes += file.byteLength;
      if (previousPath !== undefined && previousPath >= file.path) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: 'Files devem estar ordenados.',
        });
      }
      previousPath = file.path;
      try {
        inspected.push(
          inspectSafePreviewArtifactPath(
            file.path,
            file.mediaType,
            PREVIEW_ARTIFACT_ABSOLUTE_LIMITS,
          ),
        );
      } catch {
        // The file schema reports the precise path issue.
      }
    }
    try {
      assertNoPreviewArtifactPathCollisions(inspected);
    } catch {
      context.addIssue({ code: 'custom', path: ['files'], message: 'Path collision detectada.' });
    }
    if (
      !artifact.files.some((file) => file.path === 'index.html' && file.mediaType === 'text/html')
    ) {
      context.addIssue({ code: 'custom', path: ['files'], message: 'index.html é obrigatório.' });
    }
    const contentHash = calculatePreviewArtifactContentHash(artifact.files);
    const artifactHash = calculatePreviewArtifactHash({
      profileId: artifact.metadata.profileId,
      exporterVersion: artifact.metadata.exporterVersion,
      source: artifact.source,
      files: artifact.files,
      artifactContentHash: contentHash,
    });
    if (
      artifact.metadata.fileCount !== artifact.files.length ||
      artifact.metadata.totalBytes !== totalBytes ||
      totalBytes > PREVIEW_ARTIFACT_ABSOLUTE_LIMITS.maxTotalBytes
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Metadata de tamanho inválida.',
      });
    }
    if (
      artifact.hashes.artifactContentHash !== contentHash ||
      artifact.hashes.artifactHash !== artifactHash ||
      artifact.artifactId !== derivePreviewArtifactId(artifactHash)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hashes'],
        message: 'Integridade do artifact inválida.',
      });
    }
  });

export const previewArtifactCandidateSchema = previewArtifactSchema.refine(
  (artifact) => artifact.status === 'CANDIDATE',
  'O artifact deve ser candidato.',
);

export const approvedPreviewArtifactSchema = previewArtifactSchema.refine(
  (artifact) => artifact.status === 'APPROVED',
  'O artifact deve estar aprovado.',
);

export const approvedPreviewArtifactDescriptorSchema = previewArtifactDescriptorSchema.refine(
  (artifact) => artifact.status === 'APPROVED',
  'O descriptor deve estar aprovado.',
);
