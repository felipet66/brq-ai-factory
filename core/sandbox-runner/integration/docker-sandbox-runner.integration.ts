import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import { createWorkspacePlanRequestFixture } from '@brq/controlled-workspace/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { createDockerSandboxRunner } from '../docker/docker-sandbox-runner';
import { createSandboxExecutionPolicyFixture } from '../testing';

const roots: string[] = [];

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`O teste Docker opt-in exige ${name}.`);
  }
  return value;
}

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DockerSandboxRunner real opt-in', () => {
  it('runs the fixed pipeline in a preloaded digest-pinned image and confirms cleanup', async () => {
    expect(requiredEnvironment('BRQ_SANDBOX_INTEGRATION')).toBe('1');
    const workspaceRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), 'brq-sandbox-integration-')),
    );
    roots.push(workspaceRoot);
    const controlledWorkspace = createFilesystemControlledWorkspace({ rootPath: workspaceRoot });
    const workspace = await controlledWorkspace.materialize(
      controlledWorkspace.plan(createWorkspacePlanRequestFixture()),
    );
    const policy = createSandboxExecutionPolicyFixture();
    const runner = createDockerSandboxRunner({
      workspaceRoot,
      dockerExecutable: requiredEnvironment('BRQ_SANDBOX_DOCKER_EXECUTABLE'),
      dockerHost: requiredEnvironment('BRQ_SANDBOX_DOCKER_HOST'),
      image: {
        reference: requiredEnvironment('BRQ_SANDBOX_IMAGE_REFERENCE'),
        expectedImageId: requiredEnvironment('BRQ_SANDBOX_IMAGE_ID'),
        platform: requiredEnvironment('BRQ_SANDBOX_IMAGE_PLATFORM'),
        requiredLabels: {},
        toolchainVersions: { NODE: policy.runtime.version, TYPESCRIPT: '6.0.3' },
      },
      policies: [policy],
    });

    const result = await runner.run({
      context: { executionId: 'execution-sandbox-integration' },
      workspace,
      policyId: policy.policyId,
    });

    expect(result.failure).toBeNull();
    expect(result.steps.map((step) => step.stderr?.summary.trim())).toEqual(['', '', '', '']);
    expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
      ['PREPARE', 'SUCCESS'],
      ['TYPECHECK', 'SUCCESS'],
      ['BUILD', 'SUCCESS'],
      ['TEST', 'SUCCESS'],
    ]);
    expect(result.steps.map((step) => step.stdout?.summary.trim())).toEqual([
      'BRQ_PREPARE_OK files=2 bytes=67',
      'BRQ_TYPECHECK_OK files=1',
      'BRQ_BUILD_OK files=1',
      'BRQ_TEST_OK ready=true',
    ]);
    expect(result.status).toBe('SUCCESS');
    expect(result.provenance.runtime.imageReference).toBe(
      requiredEnvironment('BRQ_SANDBOX_IMAGE_REFERENCE'),
    );
  });
});
