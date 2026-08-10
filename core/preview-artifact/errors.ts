export const PREVIEW_ARTIFACT_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'PREVIEW_ARTIFACT_INVALID_INPUT',
  UNSUPPORTED_PROFILE: 'PREVIEW_ARTIFACT_UNSUPPORTED_PROFILE',
  LIMIT_EXCEEDED: 'PREVIEW_ARTIFACT_LIMIT_EXCEEDED',
  UNSAFE_PATH: 'PREVIEW_ARTIFACT_UNSAFE_PATH',
  SECRET_DETECTED: 'PREVIEW_ARTIFACT_SECRET_DETECTED',
  INTEGRITY_MISMATCH: 'PREVIEW_ARTIFACT_INTEGRITY_MISMATCH',
  INVALID_TRANSITION: 'PREVIEW_ARTIFACT_INVALID_TRANSITION',
  NOT_FOUND: 'PREVIEW_ARTIFACT_NOT_FOUND',
  EXPIRED: 'PREVIEW_ARTIFACT_EXPIRED',
  STORE_FAILURE: 'PREVIEW_ARTIFACT_STORE_FAILURE',
} as const);

export type PreviewArtifactErrorCode =
  (typeof PREVIEW_ARTIFACT_ERROR_CODES)[keyof typeof PREVIEW_ARTIFACT_ERROR_CODES];

export class PreviewArtifactError extends Error {
  readonly code: PreviewArtifactErrorCode;
  readonly artifactId: string | undefined;
  readonly sourceCode: string | undefined;

  constructor(
    message: string,
    options: {
      readonly code: PreviewArtifactErrorCode;
      readonly artifactId?: string;
      readonly sourceCode?: string;
      readonly cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PreviewArtifactError';
    this.code = options.code;
    this.artifactId = options.artifactId;
    this.sourceCode = options.sourceCode;
  }
}
