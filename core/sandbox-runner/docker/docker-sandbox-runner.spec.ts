import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFilesystemControlledWorkspace } from '@brq/controlled-workspace/filesystem';
import { createWorkspacePlanRequestFixture } from '@brq/controlled-workspace/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { SandboxRunRequest } from '../contracts';
import { SANDBOX_RUNNER_ERROR_CODES, SandboxRunnerError } from '../errors';
import { SANDBOX_ABSOLUTE_LIMITS } from '../limits';
import { createSandboxExecutionPolicyFixture } from '../testing/sandbox-runner-fixtures';
import type {
  DockerCommandExecutor,
  DockerCommandRequest,
  DockerCommandResult,
} from './docker-cli';
import type { DockerSandboxArtifactSink } from './artifact-capture';
import { resolveDockerSandboxRunnerOptions } from './docker-configuration';
import { createDockerSandboxRunner } from './docker-sandbox-runner';
import { createDockerSandboxRunnerWithDependencies } from './internal-factory';
import { readAndVerifyWorkspace } from './workspace-reader';

const IMAGE_DIGEST = `sha256:${'d'.repeat(64)}`;
const IMAGE_ID = `sha256:${'e'.repeat(64)}`;
const IMAGE_REFERENCE = `registry.example/brq/sandbox@${IMAGE_DIGEST}`;
const CONTAINER_ID = 'a'.repeat(64);
const roots: string[] = [];

function capture(value = '') {
  return Object.freeze({
    value,
    observedBytes: Buffer.byteLength(value, 'utf8'),
    observedLines: value.length === 0 ? 0 : value.split('\n').length,
    captureTruncated: false,
  });
}

function commandResult(overrides: Partial<DockerCommandResult> = {}): DockerCommandResult {
  return Object.freeze({
    exitCode: 0,
    stdout: capture(),
    stderr: capture(),
    timedOut: false,
    cancelled: false,
    outputLimitExceeded: false,
    sourceCode: null,
    ...overrides,
  });
}

class FakeDockerExecutor implements DockerCommandExecutor {
  readonly requests: DockerCommandRequest[] = [];
  readonly stepResults: DockerCommandResult[] = [];
  startResult: DockerCommandResult = commandResult();
  readinessResult: DockerCommandResult = commandResult();
  artifactExportResult: DockerCommandResult = commandResult({
    stdout: capture(
      JSON.stringify({
        abiVersion: '1.0.0',
        profileId: 'NODE_WEB_PREVIEW_24_V1',
        exporterVersion: '1.0.0',
        files: [{ path: 'index.html', content: '<main>ready</main>', mediaType: 'text/html' }],
      }),
    ),
  });
  cleanupResult: DockerCommandResult = commandResult();
  imageOverride: Record<string, unknown> = {};
  containerOverride: Record<string, unknown> = {};
  state = { OOMKilled: false };
  ownershipToken = '';
  removed = false;
  memoryBytes = SANDBOX_ABSOLUTE_LIMITS.memoryBytes;
  pidsLimit = SANDBOX_ABSOLUTE_LIMITS.pidsLimit;
  workspaceTmpfs = `rw,nosuid,nodev,noexec,size=${SANDBOX_ABSOLUTE_LIMITS.workspaceBytes},nr_inodes=${SANDBOX_ABSOLUTE_LIMITS.workspaceInodes},mode=0700,uid=65532,gid=65532`;
  temporaryTmpfs = `rw,nosuid,nodev,noexec,size=${SANDBOX_ABSOLUTE_LIMITS.temporaryBytes},nr_inodes=${SANDBOX_ABSOLUTE_LIMITS.temporaryInodes},mode=0700,uid=65532,gid=65532`;

  async execute(request: DockerCommandRequest): Promise<DockerCommandResult> {
    this.requests.push(request);
    const args = request.args;
    if (args[0] === 'version') {
      return commandResult({
        stdout: capture(
          JSON.stringify({ Client: { Version: '28.0.0' }, Server: { Version: '28.0.0' } }),
        ),
      });
    }
    if (args[0] === 'image') {
      return commandResult({
        stdout: capture(
          JSON.stringify({
            Id: IMAGE_ID,
            RepoDigests: [IMAGE_REFERENCE],
            Architecture: 'arm64',
            Os: 'linux',
            Config: {
              Labels: {
                'org.brq.sandbox.helper-abi': '1.1.0',
                'org.brq.sandbox.dependency-snapshot': 'none',
                'org.brq.sandbox.runtime-node': '24.19.0',
                'org.brq.sandbox.toolchain.node': '24.19.0',
                'org.brq.sandbox.toolchain.typescript': '5.9.3',
              },
              Volumes: null,
              Env: ['PATH=/usr/local/bin:/usr/bin:/bin'],
              Cmd: null,
              Entrypoint: null,
            },
            ...this.imageOverride,
          }),
        ),
      });
    }
    if (args[0] === 'container' && args[1] === 'create') {
      const labelIndex = args.indexOf('--label');
      this.ownershipToken = (args[labelIndex + 1] ?? '').replace('org.brq.sandbox.ownership=', '');
      this.memoryBytes = Number(
        args.find((value) => value.startsWith('--memory='))?.slice('--memory='.length),
      );
      this.pidsLimit = Number(
        args.find((value) => value.startsWith('--pids-limit='))?.slice('--pids-limit='.length),
      );
      const tmpfs = args
        .filter((value) => value.startsWith('--tmpfs='))
        .map((value) => value.slice('--tmpfs='.length));
      this.workspaceTmpfs = (tmpfs[0] ?? '').slice('/workspace:'.length);
      this.temporaryTmpfs = (tmpfs[1] ?? '').slice('/tmp:'.length);
      return commandResult({ stdout: capture(`${CONTAINER_ID}\n`) });
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      if (args.includes('{{json .State}}')) {
        return commandResult({ stdout: capture(JSON.stringify(this.state)) });
      }
      return commandResult({
        stdout: capture(
          JSON.stringify({
            Id: CONTAINER_ID,
            Config: {
              User: '65532:65532',
              ExposedPorts: null,
              Entrypoint: ['/opt/brq/sandbox/idle'],
              Cmd: ['--hold'],
              Env: ['PATH=/usr/local/bin:/usr/bin:/bin'],
              Labels: { 'org.brq.sandbox.ownership': this.ownershipToken },
            },
            HostConfig: {
              NetworkMode: 'none',
              IpcMode: 'none',
              CgroupnsMode: 'private',
              PidMode: '',
              UTSMode: '',
              ReadonlyRootfs: true,
              Privileged: false,
              CapAdd: [],
              CapDrop: ['ALL'],
              SecurityOpt: ['no-new-privileges=true', 'seccomp=builtin'],
              PidsLimit: this.pidsLimit,
              CpuPeriod: 100_000,
              CpuQuota: 100_000,
              Memory: this.memoryBytes,
              MemorySwap: this.memoryBytes,
              MemorySwappiness: null,
              OomKillDisable: false,
              Binds: [],
              Mounts: [],
              Devices: [],
              DeviceRequests: [],
              PortBindings: {},
              Tmpfs: {
                '/workspace': this.workspaceTmpfs,
                '/tmp': this.temporaryTmpfs,
              },
              RestartPolicy: { Name: 'no' },
              LogConfig: { Type: 'none' },
              Init: true,
              Ulimits: [
                {
                  Name: 'nofile',
                  Soft: SANDBOX_ABSOLUTE_LIMITS.openFilesLimit,
                  Hard: SANDBOX_ABSOLUTE_LIMITS.openFilesLimit,
                },
              ],
            },
            Mounts: [],
            ...this.containerOverride,
          }),
        ),
      });
    }
    if (args[0] === 'container' && args[1] === 'start') return this.startResult;
    if (args[0] === 'container' && args[1] === 'ls') {
      return commandResult({ stdout: capture(this.removed ? '' : `${CONTAINER_ID}\n`) });
    }
    if (args[0] === 'container' && args[1] === 'exec') {
      if (args.includes('/opt/brq/runner/ready.mjs')) return this.readinessResult;
      if (args.includes('/opt/brq/runner/export.mjs')) return this.artifactExportResult;
      return this.stepResults.shift() ?? commandResult();
    }
    if (args[0] === 'container' && args[1] === 'rm') {
      if (this.cleanupResult.exitCode === 0) this.removed = true;
      return this.cleanupResult;
    }
    throw new Error(`Unexpected fake command: ${args.join(' ')}`);
  }
}

async function createHarness(
  overrides: {
    readonly executor?: FakeDockerExecutor;
    readonly policy?: ReturnType<typeof createSandboxExecutionPolicyFixture>;
    readonly artifactSink?: DockerSandboxArtifactSink;
  } = {},
) {
  const workspaceRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), 'brq-sandbox-workspaces-')),
  );
  roots.push(workspaceRoot);
  const controlled = createFilesystemControlledWorkspace({ rootPath: workspaceRoot });
  const workspace = await controlled.materialize(
    controlled.plan(createWorkspacePlanRequestFixture()),
  );
  const policy = overrides.policy ?? createSandboxExecutionPolicyFixture();
  const executor = overrides.executor ?? new FakeDockerExecutor();
  let tick = Date.parse('2026-08-10T00:00:00.000Z');
  const options = resolveDockerSandboxRunnerOptions({
    workspaceRoot,
    dockerExecutable: '/usr/local/bin/docker',
    dockerHost: 'unix:///var/run/docker.sock',
    image: {
      reference: IMAGE_REFERENCE,
      expectedImageId: IMAGE_ID,
      platform: 'linux/arm64',
      requiredLabels: {},
      toolchainVersions: { NODE: '24.19.0', TYPESCRIPT: '5.9.3' },
    },
    policies: [policy],
    now: () => tick++,
  });
  const runner = createDockerSandboxRunnerWithDependencies(options, {
    executor,
    ...(overrides.artifactSink === undefined ? {} : { artifactSink: overrides.artifactSink }),
  });
  const request: SandboxRunRequest = {
    context: { executionId: 'execution-sandbox-test' },
    workspace,
    policyId: policy.policyId,
  };
  return { runner, request, executor, workspaceRoot };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DockerSandboxRunner', () => {
  it('preflights only the Docker runtime and pinned image without reading or creating a workspace', async () => {
    const { runner, request, executor } = await createHarness();

    await expect(runner.preflight?.({ policyId: request.policyId })).resolves.toBeUndefined();

    expect(executor.requests.map((call) => call.args.slice(0, 2))).toEqual([
      ['version', '--format'],
      ['image', 'inspect'],
    ]);
    expect(executor.requests.some((call) => call.args.includes('create'))).toBe(false);
  });

  it('fails preflight with a specific safe mismatch and never creates a container', async () => {
    const executor = new FakeDockerExecutor();
    executor.imageOverride = { Id: `sha256:${'f'.repeat(64)}` };
    const { runner, request } = await createHarness({ executor });

    await expect(runner.preflight?.({ policyId: request.policyId })).rejects.toMatchObject({
      code: SANDBOX_RUNNER_ERROR_CODES.IMAGE_ERROR,
      sourceCode: 'DOCKER_IMAGE_ID_MISMATCH',
    });
    expect(executor.requests.some((call) => call.args.includes('create'))).toBe(false);
  });

  it('rejects an unknown preflight policy without invoking Docker', async () => {
    const { runner, executor } = await createHarness();

    await expect(runner.preflight?.({ policyId: 'UNKNOWN_POLICY' })).rejects.toMatchObject({
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
    });
    expect(executor.requests).toEqual([]);
  });

  it('revalidates the image during run after a successful preflight', async () => {
    const { runner, request, executor } = await createHarness();

    await runner.preflight?.({ policyId: request.policyId });
    executor.imageOverride = { Id: `sha256:${'f'.repeat(64)}` };

    await expect(runner.run(request)).rejects.toMatchObject({
      code: SANDBOX_RUNNER_ERROR_CODES.IMAGE_ERROR,
      sourceCode: 'DOCKER_IMAGE_ID_MISMATCH',
    });
    expect(executor.requests.filter((call) => call.args[0] === 'image')).toHaveLength(2);
    expect(executor.requests.some((call) => call.args.includes('create'))).toBe(false);
  });

  it('captures an opt-in canonical artifact after TEST and before cleanup', async () => {
    const captured: Parameters<DockerSandboxArtifactSink['captured']>[0][] = [];
    const unavailable: Parameters<DockerSandboxArtifactSink['unavailable']>[0][] = [];
    const artifactSink: DockerSandboxArtifactSink = {
      captured: (artifact) => {
        captured.push(artifact);
      },
      unavailable: (outcome) => {
        unavailable.push(outcome);
      },
    };
    const { runner, request, executor } = await createHarness({ artifactSink });

    const result = await runner.run(request);

    expect(result.status).toBe('SUCCESS');
    expect(captured).toHaveLength(1);
    expect(unavailable).toEqual([]);
    expect(captured[0]).toMatchObject({
      executionId: request.context.executionId,
      workspaceId: request.workspace.workspaceId,
      workspaceHash: request.workspace.metadata.workspaceHash,
      policyId: request.policyId,
      sandboxRequestHash: result.hashes.sandboxRequestHash,
    });
    expect(JSON.parse(captured[0]!.envelope)).toMatchObject({
      abiVersion: '1.0.0',
      profileId: 'NODE_WEB_PREVIEW_24_V1',
    });
    const exportIndex = executor.requests.findIndex((call) =>
      call.args.includes('/opt/brq/runner/export.mjs'),
    );
    const cleanupIndex = executor.requests.findIndex(
      (call) => call.args[0] === 'container' && call.args[1] === 'rm',
    );
    expect(exportIndex).toBeGreaterThan(-1);
    expect(exportIndex).toBeLessThan(cleanupIndex);
    expect(result).not.toHaveProperty('artifact');
  });

  it('keeps the Sandbox outcome authoritative when optional artifact export is invalid', async () => {
    const unavailable: Parameters<DockerSandboxArtifactSink['unavailable']>[0][] = [];
    const executor = new FakeDockerExecutor();
    executor.artifactExportResult = commandResult({ stdout: capture('{}') });
    const { runner, request } = await createHarness({
      executor,
      artifactSink: {
        captured: () => undefined,
        unavailable: (outcome) => {
          unavailable.push(outcome);
        },
      },
    });

    const result = await runner.run(request);

    expect(result.status).toBe('SUCCESS');
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.code).toBe('EXPORT_INVALID_OUTPUT');
    expect(executor.requests.filter((call) => call.args[1] === 'rm')).toHaveLength(1);
  });

  it('runs the fixed pipeline with a stdin workspace envelope and no host mount', async () => {
    const { runner, request, executor, workspaceRoot } = await createHarness();

    const result = await runner.run(request);

    expect(result.status).toBe('SUCCESS');
    expect(result.steps.map((step) => step.stepId)).toEqual([
      'PREPARE',
      'TYPECHECK',
      'BUILD',
      'TEST',
    ]);
    const create = executor.requests.find((call) => call.args[1] === 'create');
    expect(create?.args).toContain('--network=none');
    expect(create?.args).toContain('--read-only');
    expect(create?.args).toContain('--cap-drop=ALL');
    expect(create?.args).toContain('--security-opt=no-new-privileges=true');
    expect(create?.args).toContain('--entrypoint=/opt/brq/sandbox/idle');
    expect(
      create?.args.some(
        (argument) => argument === '--mount' || argument === '--volume' || argument === '-v',
      ),
    ).toBe(false);
    expect(create?.args.join(' ')).not.toContain(workspaceRoot);
    expect(create?.args.join(' ')).not.toContain('docker.sock');
    const prepare = executor.requests.find(
      (call) => call.args[1] === 'exec' && call.args.includes('/opt/brq/runner/prepare.mjs'),
    );
    expect(prepare?.input).toBeInstanceOf(Buffer);
    const envelope = JSON.parse(prepare?.input?.toString('utf8') ?? '{}') as {
      readonly abi?: string;
      readonly files?: readonly { readonly content?: string }[];
    };
    expect(envelope.abi).toBe('brq.sandbox.workspace.v1');
    expect(envelope.files?.every((file) => typeof file.content === 'string')).toBe(true);
    expect(executor.requests.filter((call) => call.args[1] === 'rm')).toHaveLength(1);
    expect(executor.requests.at(-1)?.args).toContain('--filter');
  });

  it('uses only the trusted node wrappers and never invokes package scripts or a shell', async () => {
    const { runner, request, executor } = await createHarness();
    await runner.run(request);
    const executions = executor.requests.filter((call) => call.args[1] === 'exec');
    expect(executions).toHaveLength(5);
    expect(executions.every((call) => call.args.includes('/usr/local/bin/node'))).toBe(true);
    expect(executions.flatMap((call) => call.args)).not.toEqual(
      expect.arrayContaining(['sh', 'bash', 'npm', 'npx', 'pnpm', 'yarn']),
    );
    expect(executions.every((call) => call.args.includes('--workdir'))).toBe(true);
    expect(executions[0]?.args).toEqual(
      expect.arrayContaining(['--workdir', '/', '/opt/brq/runner/ready.mjs']),
    );
    expect(executions.slice(1).every((call) => call.args.includes('/workspace/project'))).toBe(
      true,
    );
  });

  it('fails closed before PREPARE when the fixed readiness helper fails', async () => {
    const executor = new FakeDockerExecutor();
    executor.readinessResult = commandResult({ exitCode: 1 });
    const { runner, request } = await createHarness({ executor });

    const result = await runner.run(request);

    expect(result.status).toBe('FAILED');
    expect(result.failure?.stage).toBe('START');
    expect(result.steps.every((step) => step.status === 'SKIPPED')).toBe(true);
    expect(
      executor.requests.filter(
        (call) => call.args[1] === 'exec' && !call.args.includes('/opt/brq/runner/ready.mjs'),
      ),
    ).toHaveLength(0);
    expect(executor.requests.filter((call) => call.args[1] === 'rm')).toHaveLength(1);
  });

  it('stops after a failed step, marks later steps skipped and performs no retry', async () => {
    const executor = new FakeDockerExecutor();
    executor.stepResults.push(
      commandResult(),
      commandResult({ exitCode: 2, stderr: capture('type error') }),
    );
    const { runner, request } = await createHarness({ executor });

    const result = await runner.run(request);

    expect(result.status).toBe('FAILED');
    expect(result.steps.map((step) => step.status)).toEqual([
      'SUCCESS',
      'FAILED',
      'SKIPPED',
      'SKIPPED',
    ]);
    expect(executor.requests.filter((call) => call.args[1] === 'exec')).toHaveLength(3);
    expect(executor.requests.filter((call) => call.args[1] === 'rm')).toHaveLength(1);
  });

  it('maps timeout and cancellation while always removing the owned container once', async () => {
    for (const terminal of ['timedOut', 'cancelled'] as const) {
      const executor = new FakeDockerExecutor();
      executor.stepResults.push(commandResult({ [terminal]: true, exitCode: null }));
      const { runner, request } = await createHarness({ executor });

      const result = await runner.run(request);

      expect(result.status).toBe(terminal === 'timedOut' ? 'TIMEOUT' : 'CANCELLED');
      expect(result.steps[0]?.status).toBe(terminal === 'timedOut' ? 'TIMEOUT' : 'CANCELLED');
      expect(executor.requests.filter((call) => call.args[1] === 'rm')).toHaveLength(1);
    }
  });

  it('propagates the exact AbortSignal to setup and every active step', async () => {
    const { runner, request, executor } = await createHarness();
    const controller = new AbortController();

    await runner.run(request, { signal: controller.signal });

    const cancellable = executor.requests.filter(
      (call) =>
        call.args[0] === 'version' ||
        call.args[1] === 'inspect' ||
        call.args[1] === 'start' ||
        call.args[1] === 'exec',
    );
    expect(cancellable.length).toBeGreaterThan(4);
    expect(cancellable.every((call) => call.signal === controller.signal)).toBe(true);
    expect(executor.requests.find((call) => call.args[1] === 'rm')?.signal).toBeUndefined();
  });

  it('removes an owned container when startup is cancelled', async () => {
    const executor = new FakeDockerExecutor();
    executor.startResult = commandResult({ cancelled: true, exitCode: null });
    const { runner, request } = await createHarness({ executor });

    const result = await runner.run(request);

    expect(result.status).toBe('CANCELLED');
    expect(result.steps[0]?.status).toBe('CANCELLED');
    expect(executor.requests.filter((call) => call.args[1] === 'rm')).toHaveLength(1);
  });

  it('applies caller reductions to Docker flags and Node heap without expanding limits', async () => {
    const { runner, request, executor } = await createHarness();
    await runner.run({
      ...request,
      limits: {
        memoryBytes: 512 * 1024 * 1024,
        pidsLimit: 64,
        workspaceBytes: 128 * 1024 * 1024,
        temporaryBytes: 32 * 1024 * 1024,
      },
    });

    const create = executor.requests.find((call) => call.args[1] === 'create');
    expect(create?.args).toEqual(
      expect.arrayContaining(['--memory=536870912', '--memory-swap=536870912', '--pids-limit=64']),
    );
    const exec = executor.requests.find(
      (call) => call.args[1] === 'exec' && call.args.includes('/opt/brq/runner/prepare.mjs'),
    );
    expect(exec?.args).toContain('NODE_OPTIONS=--max-old-space-size=384');
  });

  it('treats the output hard limit as a terminal resource failure and sanitizes summaries', async () => {
    const executor = new FakeDockerExecutor();
    executor.stepResults.push(
      commandResult({
        exitCode: null,
        outputLimitExceeded: true,
        stdout: capture(
          `Bearer abcdefghijklmnopqrstuvwxyz\n/private/workspaces\nsk-abcdefghijklmnopqrstuv`,
        ),
      }),
    );
    const { runner, request, workspaceRoot } = await createHarness({ executor });
    executor.stepResults[0] = commandResult({
      exitCode: null,
      outputLimitExceeded: true,
      stdout: capture(
        [
          'Bearer abcdefghijklmnopqrstuvwxyz',
          workspaceRoot,
          'sk-abcdefghijklmnopqrstuv',
          'unix:///var/run/docker.sock',
          '/var/run/docker.sock',
        ].join('\n'),
      ),
      stderr: capture('Docker CLI failed at /usr/local/bin/docker'),
    });

    const result = await runner.run(request);

    expect(result.failure?.code).toBe(SANDBOX_RUNNER_ERROR_CODES.OUTPUT_LIMIT);
    expect(result.resourceOutcome).toBe('OUTPUT_LIMIT');
    expect(result.steps[0]?.stdout?.summary).not.toContain(workspaceRoot);
    expect(result.steps[0]?.stdout?.summary).not.toContain('abcdefghijklmnopqrstuv');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('unix:///var/run/docker.sock');
    expect(serialized).not.toContain('/var/run/docker.sock');
    expect(serialized).not.toContain('/usr/local/bin/docker');
  });

  it('rejects a tampered workspace before contacting Docker', async () => {
    const { runner, request, executor, workspaceRoot } = await createHarness();
    await writeFile(
      path.join(workspaceRoot, request.workspace.workspaceId, 'src/index.ts'),
      'tampered',
    );

    await expect(runner.run(request)).rejects.toMatchObject({
      code: SANDBOX_RUNNER_ERROR_CODES.INTEGRITY_MISMATCH,
    });
    expect(executor.requests).toHaveLength(0);
  });

  it('honors cancellation checkpoints while reading the controlled workspace', async () => {
    const { request, workspaceRoot } = await createHarness();
    const controller = new AbortController();
    controller.abort();

    await expect(
      readAndVerifyWorkspace(workspaceRoot, request.workspace, controller.signal),
    ).rejects.toMatchObject({ code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED });
  });

  it('rejects unexpected files and symlinks before contacting Docker', async () => {
    for (const attack of ['EXTRA_FILE', 'SYMLINK'] as const) {
      const { runner, request, executor, workspaceRoot } = await createHarness();
      const directory = path.join(workspaceRoot, request.workspace.workspaceId);
      if (attack === 'EXTRA_FILE') {
        await writeFile(path.join(directory, 'unexpected.txt'), 'unexpected');
      } else {
        const source = path.join(directory, 'src/index.ts');
        await rm(source);
        await symlink(path.join(directory, 'package.json'), source);
      }

      await expect(runner.run(request)).rejects.toMatchObject({
        code: SANDBOX_RUNNER_ERROR_CODES.INTEGRITY_MISMATCH,
      });
      expect(executor.requests).toHaveLength(0);
    }
  });

  it('rejects an unpinned or altered image before creating a container', async () => {
    const executor = new FakeDockerExecutor();
    executor.imageOverride = { Id: `sha256:${'f'.repeat(64)}` };
    const { runner, request } = await createHarness({ executor });

    await expect(runner.run(request)).rejects.toMatchObject({
      code: SANDBOX_RUNNER_ERROR_CODES.IMAGE_ERROR,
    });
    expect(executor.requests.some((call) => call.args[1] === 'create')).toBe(false);
  });

  it('rejects a command policy that could invoke package lifecycle scripts', async () => {
    const policy = createSandboxExecutionPolicyFixture();
    const unsafe = {
      ...policy,
      steps: {
        ...policy.steps,
        TEST: { ...policy.steps.TEST, executable: '/usr/local/bin/npm', args: ['test'] },
      },
    };
    const { runner, request, executor } = await createHarness({ policy: unsafe });

    await expect(runner.run(request)).rejects.toMatchObject({
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
    });
    expect(executor.requests).toHaveLength(0);
  });

  it('exposes cleanup failure at the top level while preserving the primary step failure', async () => {
    const executor = new FakeDockerExecutor();
    executor.stepResults.push(commandResult({ exitCode: 1 }));
    executor.cleanupResult = commandResult({ exitCode: 1 });
    const { runner, request } = await createHarness({ executor });

    const result = await runner.run(request);

    expect(result.failure?.code).toBe(SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED);
    expect(result.failure?.sourceCode).toBe(SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED);
    expect(result.steps[0]?.failure?.code).toBe(SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED);
    expect(executor.requests.filter((call) => call.args[1] === 'rm')).toHaveLength(1);
  });

  it('keeps EXIT_1 internal while projecting an allowlisted helper reason separately', async () => {
    const executor = new FakeDockerExecutor();
    executor.stepResults.push(
      commandResult({
        exitCode: 1,
        stderr: capture('generated diagnostic\nBRQ_PREPARE_FAILED code=INLINE_ACTIVE_CONTENT\n'),
      }),
    );
    const policy = {
      ...createSandboxExecutionPolicyFixture(),
      policyId: 'NODE_WEB_PREVIEW_24_V1',
    } as const;
    const { runner, request } = await createHarness({ executor, policy });

    const result = await runner.run(request);

    expect(result.failure).toMatchObject({
      code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
      sourceCode: 'EXIT_1',
      reasonCode: 'INLINE_ACTIVE_CONTENT',
    });
    expect(result.steps[0]?.failure).toMatchObject({
      code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
      sourceCode: 'EXIT_1',
      reasonCode: 'INLINE_ACTIVE_CONTENT',
      diagnosticSummary: null,
    });
  });

  it('projects only safe bounded TypeScript metadata from the TYPECHECK helper', async () => {
    const executor = new FakeDockerExecutor();
    executor.stepResults.push(
      commandResult(),
      commandResult({
        exitCode: 1,
        stderr: capture(
          [
            'generated source detail must not enter metadata',
            'BRQ_TYPECHECK_DIAGNOSTICS count=3 codes=2304,7006 truncated=false',
            'BRQ_TYPECHECK_FAILED code=TYPESCRIPT_DIAGNOSTICS',
            '',
          ].join('\n'),
        ),
      }),
    );
    const policy = {
      ...createSandboxExecutionPolicyFixture(),
      policyId: 'NODE_WEB_PREVIEW_24_V1',
    } as const;
    const { runner, request } = await createHarness({ executor, policy });

    const result = await runner.run(request);

    expect(result.failure).toMatchObject({
      code: SANDBOX_RUNNER_ERROR_CODES.STEP_FAILED,
      stage: 'TYPECHECK',
      sourceCode: 'EXIT_1',
      reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
      diagnosticSummary: {
        diagnosticCount: 3,
        diagnosticCodes: [2304, 7006],
        truncated: false,
      },
    });
    expect(result.steps[1]?.failure?.diagnosticSummary).toEqual(result.failure?.diagnosticSummary);
    expect(JSON.stringify(result.failure?.diagnosticSummary)).not.toContain('generated source');
  });

  it('fails a successful pipeline when cleanup absence cannot be confirmed', async () => {
    const executor = new FakeDockerExecutor();
    executor.cleanupResult = commandResult({ exitCode: 1 });
    const { runner, request } = await createHarness({ executor });

    const result = await runner.run(request);

    expect(result.status).toBe('FAILED');
    expect(result.failure?.code).toBe(SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED);
  });

  it('surfaces cleanup failure while preserving a timed out or cancelled step', async () => {
    for (const primary of ['timedOut', 'cancelled'] as const) {
      const executor = new FakeDockerExecutor();
      executor.stepResults.push(commandResult({ [primary]: true, exitCode: null }));
      executor.cleanupResult = commandResult({ exitCode: 1 });
      const { runner, request } = await createHarness({ executor });

      const result = await runner.run(request);

      expect(result.status).toBe('FAILED');
      expect(result.failure?.code).toBe(SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED);
      expect(result.failure?.sourceCode).toBe(
        primary === 'timedOut'
          ? SANDBOX_RUNNER_ERROR_CODES.TIMEOUT
          : SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
      );
      expect(result.steps[0]?.status).toBe(primary === 'timedOut' ? 'TIMEOUT' : 'CANCELLED');
    }
  });

  it('never removes a pre-existing container and exposes unconfirmed ownership', async () => {
    const executor = new FakeDockerExecutor();
    const original = executor.execute.bind(executor);
    executor.execute = async (request) => {
      if (request.args[1] === 'create') return commandResult({ exitCode: 1 });
      if (
        request.args[0] === 'container' &&
        request.args[1] === 'inspect' &&
        request.args.includes('{{json .}}')
      ) {
        return commandResult({
          stdout: capture(
            JSON.stringify({
              Id: CONTAINER_ID,
              Config: { Labels: { 'org.brq.sandbox.ownership': 'another-attempt' } },
            }),
          ),
        });
      }
      return original(request);
    };
    const { runner, request } = await createHarness({ executor });

    const result = await runner.run(request);

    expect(result.status).toBe('FAILED');
    expect(result.failure?.code).toBe(SANDBOX_RUNNER_ERROR_CODES.RUNTIME_UNAVAILABLE);
    expect(executor.requests.filter((call) => call.args[1] === 'rm')).toHaveLength(0);
  });

  it('reports cleanup failure when create may have side effects but ownership is unconfirmed', async () => {
    const executor = new FakeDockerExecutor();
    const original = executor.execute.bind(executor);
    executor.execute = async (request) => {
      if (request.args[1] === 'create') {
        await original(request);
        return commandResult({ timedOut: true, exitCode: null });
      }
      if (
        request.args[0] === 'container' &&
        request.args[1] === 'inspect' &&
        request.args.includes('{{json .}}')
      ) {
        executor.requests.push(request);
        return commandResult({ exitCode: 1 });
      }
      if (
        request.args[0] === 'container' &&
        request.args[1] === 'ls' &&
        request.args.some((argument) => argument.startsWith('label=org.brq.sandbox.ownership='))
      ) {
        executor.requests.push(request);
        return commandResult({ exitCode: 1 });
      }
      return original(request);
    };
    const { runner, request } = await createHarness({ executor });

    const result = await runner.run(request);

    expect(result.status).toBe('FAILED');
    expect(result.failure?.code).toBe(SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED);
    expect(result.failure?.sourceCode).toBe(SANDBOX_RUNNER_ERROR_CODES.TIMEOUT);
    expect(result.steps[0]?.status).toBe('TIMEOUT');
    expect(executor.requests.filter((call) => call.args[1] === 'rm')).toHaveLength(0);
  });
});

describe('Docker adapter configuration', () => {
  it('constructs the public adapter without contacting Docker', async () => {
    const workspaceRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), 'brq-sandbox-constructor-')),
    );
    roots.push(workspaceRoot);
    const policy = createSandboxExecutionPolicyFixture();

    const runner = createDockerSandboxRunner({
      workspaceRoot,
      dockerExecutable: '/usr/local/bin/docker',
      dockerHost: 'unix:///var/run/docker.sock',
      image: {
        reference: IMAGE_REFERENCE,
        expectedImageId: IMAGE_ID,
        platform: 'linux/arm64',
        requiredLabels: {},
        toolchainVersions: { NODE: policy.runtime.version },
      },
      policies: [policy],
    });

    expect(runner.run).toBeTypeOf('function');
  });

  it('requires an absolute CLI, local unix socket, digest-only image and safe root', () => {
    expect(() =>
      resolveDockerSandboxRunnerOptions({
        workspaceRoot: '/',
        dockerExecutable: 'docker',
        dockerHost: 'tcp://remote.example:2375',
        image: {
          reference: 'registry.example/brq/sandbox:latest',
          expectedImageId: IMAGE_ID,
          platform: 'linux/arm64',
          requiredLabels: {},
          toolchainVersions: { NODE: '24.19.0' },
        },
        policies: [createSandboxExecutionPolicyFixture()],
      }),
    ).toThrowError(SandboxRunnerError);
  });
});

describe('workspace envelope secrecy', () => {
  it('keeps source bytes only in stdin, never in Docker argv', async () => {
    const { runner, request, executor } = await createHarness();
    await runner.run(request);
    expect(executor.requests.filter((call) => call.input !== undefined)).toHaveLength(1);
    expect(executor.requests.flatMap((call) => call.args).join(' ')).not.toContain(
      'export const ready',
    );
  });
});
