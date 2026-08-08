export interface ControlledWorkspaceLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxBundleBytes: number;
  readonly maxPathBytes: number;
  readonly maxPathSegments: number;
  readonly maxPathSegmentBytes: number;
}

export const CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS: ControlledWorkspaceLimits = Object.freeze({
  maxFiles: 96,
  maxFileBytes: 64 * 1024,
  maxBundleBytes: 384 * 1024,
  maxPathBytes: 512,
  maxPathSegments: 20,
  maxPathSegmentBytes: 255,
});

export const DEFAULT_CONTROLLED_WORKSPACE_LIMITS = CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS;
