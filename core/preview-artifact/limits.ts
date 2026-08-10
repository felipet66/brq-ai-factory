export interface PreviewArtifactLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxPathBytes: number;
  readonly maxPathSegments: number;
  readonly maxPathSegmentBytes: number;
}

export const PREVIEW_ARTIFACT_ABSOLUTE_LIMITS: PreviewArtifactLimits = Object.freeze({
  maxFiles: 128,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxPathBytes: 512,
  maxPathSegments: 20,
  maxPathSegmentBytes: 255,
});

export const DEFAULT_PREVIEW_ARTIFACT_LIMITS = PREVIEW_ARTIFACT_ABSOLUTE_LIMITS;
