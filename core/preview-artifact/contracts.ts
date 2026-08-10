import type { z } from 'zod';

import type {
  approvedPreviewArtifactDescriptorSchema,
  approvedPreviewArtifactSchema,
  previewArtifactCandidateSchema,
  previewArtifactDescriptorSchema,
  previewArtifactFileSchema,
  previewArtifactExportEnvelopeSchema,
  previewArtifactMediaTypeSchema,
  previewArtifactProfileIdSchema,
  previewArtifactSchema,
} from './schemas';

export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type PreviewArtifactProfileId = z.infer<typeof previewArtifactProfileIdSchema>;
export type PreviewArtifactMediaType = z.infer<typeof previewArtifactMediaTypeSchema>;
export type PreviewArtifactFile = DeepReadonly<z.infer<typeof previewArtifactFileSchema>>;
export type PreviewArtifactExportEnvelope = DeepReadonly<
  z.infer<typeof previewArtifactExportEnvelopeSchema>
>;
export type PreviewArtifact = DeepReadonly<z.infer<typeof previewArtifactSchema>>;
export type PreviewArtifactCandidate = DeepReadonly<z.infer<typeof previewArtifactCandidateSchema>>;
export type ApprovedPreviewArtifact = DeepReadonly<z.infer<typeof approvedPreviewArtifactSchema>>;
export type PreviewArtifactDescriptor = DeepReadonly<
  z.infer<typeof previewArtifactDescriptorSchema>
>;
export type ApprovedPreviewArtifactDescriptor = DeepReadonly<
  z.infer<typeof approvedPreviewArtifactDescriptorSchema>
>;

export interface PreviewArtifactSourceFileInput {
  readonly path: string;
  readonly content: string;
  readonly mediaType: PreviewArtifactMediaType;
}

export interface CreatePreviewArtifactCandidateInput {
  readonly executionId: string;
  readonly workspaceHash: string;
  readonly sandboxRequestHash: string;
  readonly profileId: PreviewArtifactProfileId;
  readonly exporterVersion: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly files: readonly PreviewArtifactSourceFileInput[];
}

export interface ApprovePreviewArtifactInput {
  readonly candidate: PreviewArtifactCandidate;
  readonly factoryStatus: 'SUCCESS';
  readonly sandboxStatus: 'SUCCESS';
  readonly workspaceReleaseStatus: 'RELEASED';
  readonly factoryResultHash: string;
  readonly sandboxResultHash: string;
  readonly sandboxRequestHash: string;
  readonly workspaceHash: string;
  readonly approvedAt: string;
}

export interface PreviewArtifactStoreOptions {
  readonly signal?: AbortSignal;
}

export interface PreviewArtifactContentStore {
  stage(
    candidate: PreviewArtifactCandidate,
    options?: PreviewArtifactStoreOptions,
  ): Promise<PreviewArtifactDescriptor>;
  approve(
    artifact: ApprovedPreviewArtifact,
    options?: PreviewArtifactStoreOptions,
  ): Promise<ApprovedPreviewArtifactDescriptor>;
  readApproved(
    artifactId: string,
    options?: PreviewArtifactStoreOptions,
  ): Promise<ApprovedPreviewArtifact | null>;
  consume(
    artifactId: string,
    consumedAt: string,
    options?: PreviewArtifactStoreOptions,
  ): Promise<PreviewArtifactDescriptor>;
  expire(
    artifactId: string,
    expiredAt: string,
    options?: PreviewArtifactStoreOptions,
  ): Promise<PreviewArtifactDescriptor>;
  remove(
    artifactId: string,
    deletedAt: string,
    options?: PreviewArtifactStoreOptions,
  ): Promise<PreviewArtifactDescriptor | null>;
}
