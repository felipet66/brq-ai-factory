import { describe, expect, it } from 'vitest';

import {
  resolvePreviewArtifactRuntimeConfiguration,
  previewIdFromRequestUrl,
  previewOriginForId,
  resolvePreviewRuntimeConfiguration,
} from './configuration';

const previewId = `preview-${'1'.repeat(32)}`;
const template = 'http://{previewId}.preview.localhost:3000';

describe('Preview runtime configuration', () => {
  it('resolves the artifact store independently from Docker/origin configuration', () => {
    expect(
      resolvePreviewArtifactRuntimeConfiguration({
        BRQ_PREVIEW_ARTIFACT_ROOT: '/tmp/brq-preview-artifacts',
      }),
    ).toEqual({ artifactRoot: '/tmp/brq-preview-artifacts' });
    expect(() =>
      resolvePreviewArtifactRuntimeConfiguration({ BRQ_PREVIEW_ARTIFACT_ROOT: '/' }),
    ).toThrow(TypeError);
    expect(() =>
      resolvePreviewArtifactRuntimeConfiguration({
        BRQ_PREVIEW_ARTIFACT_ROOT: '/tmp/shared-artifacts',
      }),
    ).toThrow(TypeError);
  });
  it('resolves a unique local origin and extracts only a canonical Preview ID', () => {
    expect(previewOriginForId(template, previewId)).toBe(
      `http://${previewId}.preview.localhost:3000`,
    );
    expect(
      previewIdFromRequestUrl(template, `http://${previewId}.preview.localhost:3000/assets/app.js`),
    ).toBe(previewId);
    expect(previewIdFromRequestUrl(template, 'http://localhost:3000/api/auth/session')).toBeNull();
    expect(
      previewIdFromRequestUrl(template, `http://${previewId}.preview.localhost:4000/`),
    ).toBeNull();
  });

  it('fails closed for shared hosts, paths, credentials and insecure non-local origins', () => {
    expect(() => previewOriginForId('http://preview.localhost:3000', previewId)).toThrow();
    expect(() =>
      previewOriginForId('https://user:pass@{previewId}.example.test', previewId),
    ).toThrow();
    expect(() => previewOriginForId('https://{previewId}.example.test/path', previewId)).toThrow();
    expect(() => previewOriginForId('http://{previewId}.example.test', previewId)).toThrow();
  });

  it('requires explicit digest-pinned Docker and private storage configuration', () => {
    const configuration = resolvePreviewRuntimeConfiguration({
      BRQ_PREVIEW_MODE: 'DOCKER',
      BRQ_PREVIEW_ORIGIN_TEMPLATE: template,
      BRQ_PREVIEW_COOKIE_SECRET: 's'.repeat(64),
      BRQ_PREVIEW_ARTIFACT_ROOT: '/tmp/brq-preview-artifacts',
      BRQ_PREVIEW_DOCKER_EXECUTABLE: '/usr/local/bin/docker',
      BRQ_PREVIEW_DOCKER_HOST: 'unix:///var/run/docker.sock',
      BRQ_PREVIEW_IMAGE_REFERENCE: `brq-preview@sha256:${'a'.repeat(64)}`,
      BRQ_PREVIEW_IMAGE_ID: `sha256:${'b'.repeat(64)}`,
      BRQ_PREVIEW_IMAGE_PLATFORM: 'linux/arm64',
    });
    expect(configuration.image.reference).toMatch(/@sha256:/u);
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(() => resolvePreviewRuntimeConfiguration({ BRQ_PREVIEW_MODE: 'DOCKER' })).toThrow(
      /configuração Docker/u,
    );
  });
});
