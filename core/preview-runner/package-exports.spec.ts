import {
  NODE_WEB_PREVIEW_24_V1_POLICY,
  PREVIEW_SESSION_STATUSES,
  createPreviewSessionCoordinator,
  previewSessionSchema,
  type PreviewRunner,
  type PreviewRuntimeGatewayLocator,
} from '@brq/preview-runner';
import { createRunningPreviewSessionFixture } from '@brq/preview-runner/testing';
import { describe, expect, it } from 'vitest';

describe('@brq/preview-runner package exports', () => {
  it('exposes provider-neutral contracts without an infrastructure adapter', () => {
    const runner: PreviewRunner | undefined = undefined;
    const locator: PreviewRuntimeGatewayLocator | undefined = undefined;
    expect(runner).toBeUndefined();
    expect(locator).toBeUndefined();
    expect(createPreviewSessionCoordinator).toBeTypeOf('function');
    expect(PREVIEW_SESSION_STATUSES).toContain('RUNNING');
    expect(NODE_WEB_PREVIEW_24_V1_POLICY.policyId).toBe('NODE_WEB_PREVIEW_24_V1');
    expect(previewSessionSchema.parse(createRunningPreviewSessionFixture())).toBeDefined();
  });
});
