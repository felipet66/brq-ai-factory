import type { PreviewArtifactDescriptor } from '@brq/preview-artifact';
import type { PreviewSessionStore } from '@brq/preview-runner';
import type { z } from 'zod';

import type {
  previewAccessTicketConsumeInputSchema,
  previewAccessTicketIssueInputSchema,
  previewAccessTicketMetadataSchema,
  previewAccessTicketRedemptionSchema,
  previewAccessTicketRevokeInputSchema,
} from './preview-persistence-schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type PreviewRepositoryAccess =
  | { readonly access: 'OWNER'; readonly userId: string }
  | { readonly access: 'INTERNAL' }
  | { readonly access: 'GLOBAL_PREVIEW' }
  | { readonly access: 'TICKET_REDEEM' };

export type PreviewAccessTicketIssueInput = DeepReadonly<
  z.infer<typeof previewAccessTicketIssueInputSchema>
>;
export type PreviewAccessTicketConsumeInput = DeepReadonly<
  z.infer<typeof previewAccessTicketConsumeInputSchema>
>;
export type PreviewAccessTicketRevokeInput = DeepReadonly<
  z.infer<typeof previewAccessTicketRevokeInputSchema>
>;
export type PreviewAccessTicketMetadata = DeepReadonly<
  z.infer<typeof previewAccessTicketMetadataSchema>
>;
export type PreviewAccessTicketRedemption = DeepReadonly<
  z.infer<typeof previewAccessTicketRedemptionSchema>
>;

export interface PreviewArtifactMetadataRepository {
  saveArtifactMetadata(artifact: PreviewArtifactDescriptor): Promise<PreviewArtifactDescriptor>;
  findArtifactMetadataByArtifactId(artifactId: string): Promise<PreviewArtifactDescriptor | null>;
  findArtifactMetadataByExecutionId(executionId: string): Promise<PreviewArtifactDescriptor | null>;
}

export interface PreviewAccessTicketRepository {
  issueAccessTicket(input: PreviewAccessTicketIssueInput): Promise<PreviewAccessTicketMetadata>;
  consumeAccessTicket(
    input: PreviewAccessTicketConsumeInput,
  ): Promise<PreviewAccessTicketRedemption | null>;
  revokeAccessTicket(
    input: PreviewAccessTicketRevokeInput,
  ): Promise<PreviewAccessTicketMetadata | null>;
}

export interface PreviewPersistenceRepository
  extends PreviewSessionStore, PreviewArtifactMetadataRepository, PreviewAccessTicketRepository {}
