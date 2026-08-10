import {
  approvePreviewArtifact,
  createInMemoryPreviewArtifactContentStore,
  createPreviewArtifactCandidate,
  projectApprovedPreviewArtifactDescriptor,
  type PreviewArtifactContentStore,
} from '@brq/preview-artifact';
import { createPreviewArtifactFilesFixture } from '@brq/preview-artifact/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { NODE_WEB_PREVIEW_24_V1_POLICY } from '../policies';
import { PREVIEW_RUNTIME_GATEWAY_ACCESS_HEADER } from '../contracts';
import { resolvePreviewStart } from '../session';
import {
  createDockerPreviewRunner,
  type DockerPreviewRunner,
} from '../docker/docker-preview-runner';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`O teste Docker opt-in de Preview exige ${name}.`);
  }
  return value;
}

const active: { runner: DockerPreviewRunner; previewId: string; executionId: string }[] = [];

afterAll(async () => {
  await Promise.all(
    active.splice(0).map(async ({ runner, previewId, executionId }) => {
      try {
        await runner.stop({ previewId, executionId, reason: 'RECONCILIATION' });
      } catch {
        // The primary test reports cleanup failures; this is a final defensive attempt only.
      }
    }),
  );
});

describe('DockerPreviewRunner real opt-in', () => {
  it('serves an approved artifact and confirms stop plus cleanup', async () => {
    expect(requiredEnvironment('BRQ_PREVIEW_INTEGRATION')).toBe('1');
    const hash = (character: string) => character.repeat(64);
    const now = Date.now();
    const executionId = 'execution-preview-docker-integration';
    const candidate = createPreviewArtifactCandidate({
      executionId,
      workspaceHash: hash('a'),
      sandboxRequestHash: hash('b'),
      profileId: 'NODE_WEB_PREVIEW_24_V1',
      exporterVersion: '1.0.0',
      createdAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
      files: createPreviewArtifactFilesFixture(),
    });
    const approved = approvePreviewArtifact({
      candidate,
      factoryStatus: 'SUCCESS',
      sandboxStatus: 'SUCCESS',
      workspaceReleaseStatus: 'RELEASED',
      factoryResultHash: hash('c'),
      sandboxResultHash: hash('d'),
      sandboxRequestHash: hash('b'),
      workspaceHash: hash('a'),
      approvedAt: new Date(now).toISOString(),
    });
    const baseStore = createInMemoryPreviewArtifactContentStore();
    let artifactRemovalCalls = 0;
    const contentStore: PreviewArtifactContentStore = {
      ...baseStore,
      async remove(...args) {
        artifactRemovalCalls += 1;
        return baseStore.remove(...args);
      },
    };
    await contentStore.stage(candidate);
    await contentStore.approve(approved);
    const resolved = resolvePreviewStart({
      request: {
        executionId,
        artifact: projectApprovedPreviewArtifactDescriptor(approved),
        policyId: 'NODE_WEB_PREVIEW_24_V1',
        limits: { ttlSeconds: 60 },
      },
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      observedAt: new Date(now + 1).toISOString(),
    });
    const runner = createDockerPreviewRunner({
      dockerExecutable: requiredEnvironment('BRQ_PREVIEW_DOCKER_EXECUTABLE'),
      dockerHost: requiredEnvironment('BRQ_PREVIEW_DOCKER_HOST'),
      image: {
        reference: requiredEnvironment('BRQ_PREVIEW_IMAGE_REFERENCE'),
        expectedImageId: requiredEnvironment('BRQ_PREVIEW_IMAGE_ID'),
        platform: requiredEnvironment('BRQ_PREVIEW_IMAGE_PLATFORM') as
          'linux/amd64' | 'linux/arm64',
        requiredLabels: {},
      },
      contentStore,
    });
    active.push({ runner, previewId: resolved.request.previewId, executionId });

    const started = await runner.start(resolved.request);
    expect(started.status).toBe('RUNNING');
    expect(started.health.status).toBe('HEALTHY');
    const target = runner.resolveGatewayTarget({
      previewId: resolved.request.previewId,
      executionId,
    });
    expect(target).not.toBeNull();
    const response = await fetch(`http://${target!.host}:${target!.port}/`, {
      method: 'GET',
      headers: {
        [PREVIEW_RUNTIME_GATEWAY_ACCESS_HEADER]: target!.accessToken,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('BRQ Preview');

    const stopped = await runner.stop({
      previewId: resolved.request.previewId,
      executionId,
      reason: 'MANUAL',
    });
    expect(stopped).toMatchObject({ cleanupConfirmed: true, alreadyAbsent: false });
    expect(artifactRemovalCalls).toBe(1);
    expect(
      await runner.inspect({ previewId: resolved.request.previewId, executionId }),
    ).toMatchObject({ status: 'MISSING', health: 'NOT_APPLICABLE' });
    active.splice(0);
  });
});
