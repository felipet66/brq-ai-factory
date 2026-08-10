export const PREVIEW_ARTIFACT_STATUSES = [
  'CANDIDATE',
  'APPROVED',
  'CONSUMED',
  'EXPIRED',
  'DELETED',
] as const;

export type PreviewArtifactStatus = (typeof PREVIEW_ARTIFACT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Readonly<
  Record<PreviewArtifactStatus, readonly PreviewArtifactStatus[]>
> = Object.freeze({
  CANDIDATE: ['APPROVED', 'EXPIRED', 'DELETED'],
  APPROVED: ['CONSUMED', 'EXPIRED', 'DELETED'],
  CONSUMED: ['DELETED'],
  EXPIRED: ['DELETED'],
  DELETED: [],
});

export function canTransitionPreviewArtifact(
  from: PreviewArtifactStatus,
  to: PreviewArtifactStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
