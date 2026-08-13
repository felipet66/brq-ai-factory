// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE } from '@brq/factory-execution-profile';
import { describe, expect, it } from 'vitest';

import {
  FACTORY_SANDBOX_NODE_VERSION,
  FACTORY_SANDBOX_POLICY,
  FACTORY_SANDBOX_POLICY_ID,
  FACTORY_SANDBOX_EXECUTION_PROFILE_SNAPSHOT,
  FACTORY_SANDBOX_TYPESCRIPT_VERSION,
  resolveFactorySandboxRuntimeConfiguration,
} from './factory-sandbox-runtime-configuration';

const FACTORY_WEB_PREVIEW_ROOT = path.resolve(process.cwd(), 'docker/factory-web-preview');

function factoryWebPreviewFile(relativePath: string): Promise<string> {
  return readFile(path.join(FACTORY_WEB_PREVIEW_ROOT, relativePath), 'utf8');
}

function environment(): Record<string, string> {
  return {
    BRQ_FACTORY_SANDBOX_MODE: 'DOCKER',
    BRQ_FACTORY_WORKSPACE_ROOT: path.resolve('/tmp', 'brq-factory-workspaces'),
    BRQ_FACTORY_SANDBOX_DOCKER_EXECUTABLE: '/usr/local/bin/docker',
    BRQ_FACTORY_SANDBOX_DOCKER_HOST: 'unix:///var/run/docker.sock',
    BRQ_FACTORY_SANDBOX_IMAGE_REFERENCE: `brq-ai-factory/factory-sandbox@sha256:${'a'.repeat(64)}`,
    BRQ_FACTORY_SANDBOX_IMAGE_ID: `sha256:${'b'.repeat(64)}`,
    BRQ_FACTORY_SANDBOX_IMAGE_PLATFORM: 'linux/arm64',
  };
}

describe('Factory Sandbox host configuration', () => {
  it('defines a fixed Node profile without package-manager authority', () => {
    expect(FACTORY_SANDBOX_POLICY).toMatchObject({
      policyId: FACTORY_SANDBOX_POLICY_ID,
      packageManager: 'NONE',
      runtime: { name: 'NODE', version: FACTORY_SANDBOX_NODE_VERSION },
      dependencySnapshotHash: null,
    });
    expect(
      Object.values(FACTORY_SANDBOX_POLICY.steps).every(
        (step) =>
          step.executable === '/usr/local/bin/node' &&
          step.args[0]?.startsWith('/opt/brq/runner/') === true,
      ),
    ).toBe(true);
  });

  it('requires explicit Docker configuration and preserves the pinned image identity', () => {
    const configuration = resolveFactorySandboxRuntimeConfiguration(environment());

    expect(configuration.policy.policyId).toBe(FACTORY_SANDBOX_POLICY_ID);
    expect(configuration.image.reference).toContain('@sha256:');
    expect(configuration.image.requiredLabels).toEqual({
      'org.brq.sandbox.factory-profile': 'node-web-preview-24-v1',
      'org.brq.sandbox.execution-profile-hash':
        NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE.identity.profileHash,
      'org.brq.sandbox.execution-profile-snapshot-hash':
        FACTORY_SANDBOX_EXECUTION_PROFILE_SNAPSHOT.snapshotHash,
    });
  });

  it('keeps the checked-in execution-profile snapshot identical to the host projection', async () => {
    const checkedInSnapshot = JSON.parse(
      await factoryWebPreviewFile('runner/execution-profile.snapshot.json'),
    ) as unknown;

    expect(checkedInSnapshot).toEqual(FACTORY_SANDBOX_EXECUTION_PROFILE_SNAPSHOT);
  });

  it('keeps every verified Docker image label aligned with the host configuration', async () => {
    const configuration = resolveFactorySandboxRuntimeConfiguration(environment());
    const dockerfile = await factoryWebPreviewFile('Dockerfile');
    const requiredLabels = {
      'org.brq.sandbox.helper-abi': configuration.policy.helperAbiVersion,
      'org.brq.sandbox.dependency-snapshot': configuration.policy.dependencySnapshotHash ?? 'none',
      'org.brq.sandbox.runtime-node': configuration.policy.runtime.version,
      'org.brq.sandbox.toolchain.node': FACTORY_SANDBOX_NODE_VERSION,
      'org.brq.sandbox.toolchain.typescript': FACTORY_SANDBOX_TYPESCRIPT_VERSION,
      ...configuration.image.requiredLabels,
    };

    for (const [label, value] of Object.entries(requiredLabels)) {
      expect(dockerfile).toContain(`${label}="${value}"`);
    }
  });

  it('includes the immutable execution-profile snapshot in the Docker build context', async () => {
    const [dockerfile, dockerignore] = await Promise.all([
      factoryWebPreviewFile('Dockerfile'),
      factoryWebPreviewFile('.dockerignore'),
    ]);

    expect(dockerignore.split(/\r?\n/u)).toContain('!runner/execution-profile.snapshot.json');
    expect(dockerfile).toContain(
      'COPY --chown=0:0 --chmod=0444 runner/execution-profile.snapshot.json /opt/brq/runner/execution-profile.snapshot.json',
    );
  });

  it('fails closed instead of selecting a fake runner or an implicit image', () => {
    expect(() => resolveFactorySandboxRuntimeConfiguration({ NODE_ENV: 'test' })).toThrow(
      'configuração Docker explícita',
    );
    expect(() =>
      resolveFactorySandboxRuntimeConfiguration({
        ...environment(),
        BRQ_FACTORY_WORKSPACE_ROOT: 'relative/workspace',
      }),
    ).toThrow('caminho absoluto');
  });
});
