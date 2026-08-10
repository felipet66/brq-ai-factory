import {
  PREVIEW_ARTIFACT_ABSOLUTE_LIMITS,
  createPreviewArtifactCandidate,
  previewArtifactSchema,
  type PreviewArtifactContentStore,
} from '@brq/preview-artifact';
import { createFilesystemPreviewArtifactStore } from '@brq/preview-artifact/filesystem';
import { createApprovedPreviewArtifactFixture } from '@brq/preview-artifact/testing';
import { describe, expect, it } from 'vitest';

describe('@brq/preview-artifact package exports', () => {
  it('exposes contracts, helpers, testing fixtures and explicit filesystem adapter', () => {
    const store: PreviewArtifactContentStore | undefined = undefined;
    expect(store).toBeUndefined();
    expect(createPreviewArtifactCandidate).toBeTypeOf('function');
    expect(createFilesystemPreviewArtifactStore).toBeTypeOf('function');
    expect(PREVIEW_ARTIFACT_ABSOLUTE_LIMITS.maxTotalBytes).toBe(1024 * 1024);
    expect(previewArtifactSchema.parse(createApprovedPreviewArtifactFixture())).toBeDefined();
  });
});
