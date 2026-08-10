// @vitest-environment node

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FACTORY_SANDBOX_NODE_VERSION,
  FACTORY_SANDBOX_POLICY,
  FACTORY_SANDBOX_POLICY_ID,
  resolveFactorySandboxRuntimeConfiguration,
} from './factory-sandbox-runtime-configuration';

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
      'org.brq.sandbox.factory-profile': 'node-typescript-24-v1',
    });
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
