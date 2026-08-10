import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  calculateWorkspaceBundleContentHash,
  calculateWorkspaceContentHash,
  type WorkspacePlanRequest,
} from '@brq/controlled-workspace';
import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import { createDockerSandboxRunner } from '@brq/sandbox-runner/docker';
import { afterAll, describe, expect, it } from 'vitest';

import {
  FACTORY_PIPELINE_CONFIGURATION,
  resolveFactorySandboxRuntimeConfiguration,
} from '../../../apps/web/src/server/factory-sandbox-runtime-configuration';
import { createExecutionRequestFixture } from '../../execution-engine/testing/execution-engine-fixtures';
import { projectWorkspaceToSandboxRunRequest } from '../projections';

const roots: string[] = [];

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`O teste Factory Docker opt-in exige ${name}.`);
  }
  return value;
}

function workspaceRequest(): WorkspacePlanRequest {
  const rawFiles = [
    {
      path: 'src/math.ts',
      content:
        'export function add(left: number, right: number): number { return left + right; }\n',
      mediaType: 'text/typescript' as const,
      purpose: 'SOURCE' as const,
    },
    {
      path: 'test/math.test.ts',
      content:
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/math';\ntest('adds values', () => assert.equal(add(2, 3), 5));\n",
      mediaType: 'text/typescript' as const,
      purpose: 'TEST' as const,
    },
    {
      path: 'package.json',
      content: '{"name":"factory-profile-fixture","private":true}\n',
      mediaType: 'application/json' as const,
      purpose: 'CONFIGURATION' as const,
    },
  ];
  const files = rawFiles.map((file) => ({
    ...file,
    encoding: 'UTF-8' as const,
    byteLength: Buffer.byteLength(file.content, 'utf8'),
    contentHash: calculateWorkspaceContentHash(file.content),
  }));
  return {
    source: {
      technicalSpecificationHash: `sha256:${'a'.repeat(64)}`,
      generationHash: 'b'.repeat(64),
      bundleHash: 'c'.repeat(64),
      bundleContentHash: calculateWorkspaceBundleContentHash(files),
      bundleVersion: '1.0.0',
      contractVersion: '1.0.0',
    },
    files,
  };
}

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Factory Docker profile real opt-in', () => {
  it('materializes, runs the fixed Factory profile and releases the workspace', async () => {
    expect(requiredEnvironment('BRQ_FACTORY_SANDBOX_INTEGRATION')).toBe('1');
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'brq-factory-integration-')));
    roots.push(root);
    const environment = {
      ...process.env,
      BRQ_FACTORY_WORKSPACE_ROOT: root,
    };
    const configuration = resolveFactorySandboxRuntimeConfiguration(environment);
    const workspace = createFilesystemControlledWorkspace({ rootPath: root });
    const materialization = await workspace.materialize(workspace.plan(workspaceRequest()));
    const runner = createDockerSandboxRunner({
      workspaceRoot: root,
      dockerExecutable: configuration.dockerExecutable,
      dockerHost: configuration.dockerHost,
      image: configuration.image,
      policies: [configuration.policy],
    });

    try {
      const request = createExecutionRequestFixture();
      const result = await runner.run(
        projectWorkspaceToSandboxRunRequest(
          materialization,
          'execution-factory-docker-opt-in',
          request,
          FACTORY_PIPELINE_CONFIGURATION.sandbox,
        ),
      );

      expect(result.status).toBe('SUCCESS');
      expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
        ['PREPARE', 'SUCCESS'],
        ['TYPECHECK', 'SUCCESS'],
        ['BUILD', 'SUCCESS'],
        ['TEST', 'SUCCESS'],
      ]);
      expect(result.failure).toBeNull();
    } finally {
      expect((await workspace.release(materialization)).status).toBe('RELEASED');
    }

    expect(await readdir(root)).toEqual([]);
  });
});
