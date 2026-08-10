import {
  createInMemoryPreviewArtifactContentStore,
  type PreviewArtifactContentStore,
} from '@brq/preview-artifact';
import {
  createApprovedPreviewArtifactFixture,
  createPreviewArtifactCandidateFixture,
} from '@brq/preview-artifact/testing';
import { describe, expect, it } from 'vitest';

import { createResolvedPreviewFixture } from '../testing/preview-runner-fixtures';
import type {
  DockerCommandExecutor,
  DockerCommandRequest,
  DockerCommandResult,
} from './docker-cli';
import { resolveDockerPreviewRunnerOptions } from './configuration';
import type { PreviewHealthProbe } from './health-probe';
import { createDockerPreviewRunnerWithDependencies } from './internal-factory';
import type { PreviewLoopbackRelayFactory } from './loopback-relay';

const IMAGE_DIGEST = `sha256:${'d'.repeat(64)}`;
const IMAGE_ID = `sha256:${'e'.repeat(64)}`;
const IMAGE_REFERENCE = `registry.example/brq/preview@${IMAGE_DIGEST}`;
const CONTAINER_ID = 'a'.repeat(64);
const NETWORK_ID = 'b'.repeat(64);

function commandResult(overrides: Partial<DockerCommandResult> = {}): DockerCommandResult {
  return Object.freeze({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    cancelled: false,
    outputLimitExceeded: false,
    sourceCode: null,
    ...overrides,
  });
}

class FakeDockerExecutor implements DockerCommandExecutor {
  readonly requests: DockerCommandRequest[] = [];
  containerRemoved = false;
  networkRemoved = false;
  containerAbsenceIsIndeterminate = false;
  started = false;
  ownershipToken = '';
  networkOwnershipToken = '';
  networkName = '';
  previewId = '';
  executionId = '';
  artifactId = '';
  imageId = IMAGE_ID;

  async execute(request: DockerCommandRequest): Promise<DockerCommandResult> {
    this.requests.push(request);
    const args = request.args;
    if (args[0] === 'version') {
      return commandResult({
        stdout: JSON.stringify({ Client: { Version: '28.0.0' }, Server: { Version: '28.0.0' } }),
      });
    }
    if (args[0] === 'image') {
      return commandResult({
        stdout: JSON.stringify({
          Id: this.imageId,
          RepoDigests: [IMAGE_REFERENCE],
          Architecture: 'arm64',
          Os: 'linux',
          Config: {
            Labels: {
              'org.brq.preview.helper-abi': '1.0.0',
              'org.brq.preview.runtime-node': '24.19.0',
              'org.brq.preview.profile': 'node-web-preview-24-v1',
            },
            Volumes: null,
            ExposedPorts: null,
            Env: ['PATH=/usr/local/bin:/usr/bin:/bin'],
            Cmd: null,
            Entrypoint: null,
          },
        }),
      });
    }
    if (args[0] === 'network' && args[1] === 'create') {
      this.networkName = args.at(-1) ?? '';
      const labelValues = this.labelsFrom(args);
      this.networkOwnershipToken = labelValues['org.brq.preview.ownership'] ?? '';
      this.previewId = labelValues['org.brq.preview.id'] ?? '';
      this.executionId = labelValues['org.brq.preview.execution'] ?? '';
      this.artifactId = labelValues['org.brq.preview.artifact'] ?? '';
      return commandResult({ stdout: `${NETWORK_ID}\n` });
    }
    if (args[0] === 'network' && args[1] === 'inspect') {
      if (this.networkRemoved) {
        return commandResult({
          exitCode: 1,
          stdout: '[]\n',
          stderr: `Error response from daemon: {"message":"network ${String(args.at(-1))} not found"}\n`,
        });
      }
      return commandResult({
        stdout: JSON.stringify({
          Driver: 'bridge',
          Internal: true,
          Attachable: false,
          Labels: {
            'org.brq.preview.managed': '1',
            'org.brq.preview.ownership': this.networkOwnershipToken,
            'org.brq.preview.id': this.previewId,
            'org.brq.preview.execution': this.executionId,
            'org.brq.preview.artifact': this.artifactId,
          },
          Options: { 'com.docker.network.bridge.enable_icc': 'false' },
        }),
      });
    }
    if (args[0] === 'network' && args[1] === 'rm') {
      this.networkRemoved = true;
      return commandResult({ stdout: `${this.networkName}\n` });
    }
    if (args[0] === 'container' && args[1] === 'create') {
      const labelValues = this.labelsFrom(args);
      this.ownershipToken = labelValues['org.brq.preview.ownership'] ?? '';
      this.previewId = labelValues['org.brq.preview.id'] ?? '';
      this.executionId = labelValues['org.brq.preview.execution'] ?? '';
      this.artifactId = labelValues['org.brq.preview.artifact'] ?? '';
      return commandResult({ stdout: `${CONTAINER_ID}\n` });
    }
    if (args[0] === 'container' && args[1] === 'start') {
      this.started = true;
      return commandResult({ stdout: `${CONTAINER_ID}\n` });
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      if (this.containerRemoved) {
        return this.containerAbsenceIsIndeterminate
          ? commandResult({ exitCode: 1, stderr: 'permission denied\n' })
          : commandResult({
              exitCode: 1,
              stdout: '[]\n',
              stderr: `Error response from daemon: {"message":"No such container: ${String(args.at(-1))}"}\n`,
            });
      }
      return commandResult({ stdout: JSON.stringify(this.containerInspection()) });
    }
    if (args[0] === 'container' && args[1] === 'exec') {
      if (args.includes('/opt/brq/preview/prepare.mjs')) {
        return commandResult({ stdout: 'BRQ_PREVIEW_PREPARE_OK files=3 bytes=256\n' });
      }
      if (args.includes('/opt/brq/preview/serve.mjs')) return commandResult();
    }
    if (args[0] === 'container' && args[1] === 'rm') {
      this.containerRemoved = true;
      return commandResult({ stdout: `${CONTAINER_ID}\n` });
    }
    throw new Error(`Unexpected Docker request: ${args.join(' ')}`);
  }

  private containerInspection(): Record<string, unknown> {
    return {
      Id: CONTAINER_ID,
      Config: {
        User: '65532:65532',
        ExposedPorts: null,
        Entrypoint: ['/opt/brq/preview/idle'],
        Cmd: ['--hold'],
        Env: ['PATH=/usr/local/bin:/usr/bin:/bin'],
        Labels: {
          'org.brq.preview.managed': '1',
          'org.brq.preview.ownership': this.ownershipToken,
          'org.brq.preview.id': this.previewId,
          'org.brq.preview.execution': this.executionId,
          'org.brq.preview.artifact': this.artifactId,
        },
      },
      State: { Running: this.started },
      HostConfig: {
        NetworkMode: this.networkName,
        IpcMode: 'none',
        CgroupnsMode: 'private',
        PidMode: '',
        UTSMode: '',
        ReadonlyRootfs: true,
        Privileged: false,
        CapAdd: null,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges=true', 'seccomp=builtin'],
        PidsLimit: 32,
        CpuPeriod: 100_000,
        CpuQuota: 50_000,
        Memory: 256 * 1024 * 1024,
        MemorySwap: 256 * 1024 * 1024,
        MemorySwappiness: null,
        OomKillDisable: false,
        Binds: null,
        Mounts: null,
        Devices: null,
        DeviceRequests: null,
        RestartPolicy: { Name: 'no' },
        LogConfig: { Type: 'none' },
        Init: true,
        Ulimits: [{ Name: 'nofile', Soft: 256, Hard: 256 }],
        Tmpfs: {
          '/preview':
            'rw,nosuid,nodev,noexec,size=16777216,nr_inodes=544,mode=0700,uid=65532,gid=65532',
        },
        PortBindings: null,
      },
      Mounts: [],
      NetworkSettings: {
        Ports: {},
        Networks: { [this.networkName]: {} },
      },
    };
  }

  private labelsFrom(args: readonly string[]): Record<string, string> {
    return args
      .flatMap((value, index) => (value === '--label' ? [args[index + 1] ?? ''] : []))
      .reduce<Record<string, string>>((result, value) => {
        const separator = value.indexOf('=');
        result[value.slice(0, separator)] = value.slice(separator + 1);
        return result;
      }, {});
  }
}

async function approvedStore(): Promise<PreviewArtifactContentStore> {
  const store = createInMemoryPreviewArtifactContentStore();
  await store.stage(createPreviewArtifactCandidateFixture());
  await store.approve(createApprovedPreviewArtifactFixture());
  return store;
}

async function createHarness(
  overrides: {
    readonly executor?: FakeDockerExecutor;
    readonly healthProbe?: PreviewHealthProbe;
    readonly createRelay?: PreviewLoopbackRelayFactory;
    readonly contentStore?: PreviewArtifactContentStore;
  } = {},
) {
  const executor = overrides.executor ?? new FakeDockerExecutor();
  const healthProbe = overrides.healthProbe ?? { check: async () => true };
  let relayCloseCalls = 0;
  const createRelay: PreviewLoopbackRelayFactory =
    overrides.createRelay ??
    (async () => ({
      host: '127.0.0.1',
      port: 43_210,
      accessToken: 'R'.repeat(43),
      async close() {
        relayCloseCalls += 1;
        return true;
      },
    }));
  const contentStore = overrides.contentStore ?? (await approvedStore());
  let tick = Date.parse('2026-08-10T12:01:01.000Z');
  const options = resolveDockerPreviewRunnerOptions({
    dockerExecutable: '/usr/local/bin/docker',
    dockerHost: 'unix:///var/run/docker.sock',
    image: {
      reference: IMAGE_REFERENCE,
      expectedImageId: IMAGE_ID,
      platform: 'linux/arm64',
      requiredLabels: {},
    },
    contentStore,
    now: () => tick++,
  });
  const runner = createDockerPreviewRunnerWithDependencies(options, {
    executor,
    healthProbe,
    createRelay,
    randomId: () => 'fixed-ownership',
    sleep: async () => undefined,
  });
  return {
    contentStore,
    executor,
    healthProbe,
    createRelay,
    relayCloseCalls: () => relayCloseCalls,
    options,
    runner,
    request: createResolvedPreviewFixture().request,
  };
}

describe('DockerPreviewRunner', () => {
  it('imports the approved artifact, reaches health and exposes only a private target', async () => {
    const { executor, runner, request } = await createHarness();

    const result = await runner.start(request);

    expect(result.status).toBe('RUNNING');
    expect(result.health.status).toBe('HEALTHY');
    expect(result.runtime).toMatchObject({
      adapter: 'DOCKER',
      imageDigest: IMAGE_DIGEST,
      runtimeVersion: '24.19.0',
    });
    const inspectionRequest = {
      previewId: request.previewId,
      executionId: request.executionId,
    };
    expect(runner.resolveGatewayTarget(inspectionRequest)).toEqual({
      host: '127.0.0.1',
      port: 43_210,
      expiresAt: request.expiresAt,
      accessToken: 'R'.repeat(43),
    });
    const creation = executor.requests.find(
      (call) => call.args[1] === 'create' && call.args[0] === 'container',
    );
    expect(creation?.args).toContain('--read-only');
    expect(creation?.args).toContain('--cap-drop=ALL');
    expect(creation?.args.some((value) => value.startsWith('--publish'))).toBe(false);
    expect(creation?.args).not.toContain('--privileged');
    expect(creation?.args.some((value) => ['--mount', '--volume', '-v'].includes(value))).toBe(
      false,
    );
    expect(creation?.args.join(' ')).not.toContain('docker.sock');
    const prepare = executor.requests.find((call) =>
      call.args.includes('/opt/brq/preview/prepare.mjs'),
    );
    const envelope = JSON.parse(prepare?.input?.toString('utf8') ?? '{}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(envelope).sort()).toEqual([
      'abiVersion',
      'exporterVersion',
      'files',
      'profileId',
    ]);
    expect(JSON.stringify(envelope)).not.toContain('factoryResultHash');
  });

  it('stops idempotently and confirms container plus network cleanup exactly once', async () => {
    const { executor, relayCloseCalls, runner, request } = await createHarness();
    await runner.start(request);

    const first = await runner.stop({
      previewId: request.previewId,
      executionId: request.executionId,
      reason: 'MANUAL',
    });
    const second = await runner.stop({
      previewId: request.previewId,
      executionId: request.executionId,
      reason: 'MANUAL',
    });

    expect(first).toMatchObject({ cleanupConfirmed: true, alreadyAbsent: false });
    expect(second).toMatchObject({ cleanupConfirmed: true, alreadyAbsent: true });
    expect(
      executor.requests.filter((call) => call.args[0] === 'container' && call.args[1] === 'rm'),
    ).toHaveLength(1);
    expect(
      executor.requests.filter((call) => call.args[0] === 'network' && call.args[1] === 'rm'),
    ).toHaveLength(1);
    expect(relayCloseCalls()).toBe(1);
    expect(
      runner.resolveGatewayTarget({
        previewId: request.previewId,
        executionId: request.executionId,
      }),
    ).toBeNull();
  });

  it('reconciles an owned orphan after runner restart and removes its artifact', async () => {
    const baseStore = await approvedStore();
    let removalCalls = 0;
    const trackedStore: PreviewArtifactContentStore = {
      ...baseStore,
      async remove(...args) {
        removalCalls += 1;
        return baseStore.remove(...args);
      },
    };
    const { createRelay, executor, healthProbe, options, runner, request } = await createHarness({
      contentStore: trackedStore,
    });
    await runner.start(request);
    const restartedRunner = createDockerPreviewRunnerWithDependencies(options, {
      executor,
      healthProbe,
      createRelay,
      randomId: () => 'unused-after-restart',
      sleep: async () => undefined,
    });

    expect(
      await restartedRunner.inspect({
        previewId: request.previewId,
        executionId: request.executionId,
      }),
    ).toMatchObject({ status: 'MISSING' });
    await expect(
      restartedRunner.stop({
        previewId: request.previewId,
        executionId: request.executionId,
        reason: 'RECONCILIATION',
      }),
    ).resolves.toMatchObject({ cleanupConfirmed: true, alreadyAbsent: false });

    expect(removalCalls).toBe(1);
    expect(
      executor.requests.filter((call) => call.args[0] === 'container' && call.args[1] === 'rm'),
    ).toHaveLength(1);
    expect(
      executor.requests.filter((call) => call.args[0] === 'network' && call.args[1] === 'rm'),
    ).toHaveLength(1);
  });

  it('fails closed instead of removing orphan resources with divergent ownership', async () => {
    const { createRelay, executor, healthProbe, options, runner, request } = await createHarness();
    await runner.start(request);
    executor.networkOwnershipToken = 'foreign-preview-ownership-0001';
    const restartedRunner = createDockerPreviewRunnerWithDependencies(options, {
      executor,
      healthProbe,
      createRelay,
      randomId: () => 'unused-after-restart',
      sleep: async () => undefined,
    });

    await expect(
      restartedRunner.stop({
        previewId: request.previewId,
        executionId: request.executionId,
        reason: 'RECONCILIATION',
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_CLEANUP_FAILED',
      stage: 'RECONCILIATION',
    });
    expect(
      executor.requests.filter((call) => call.args[0] === 'container' && call.args[1] === 'rm'),
    ).toHaveLength(0);
    expect(
      executor.requests.filter((call) => call.args[0] === 'network' && call.args[1] === 'rm'),
    ).toHaveLength(0);
  });

  it('fails closed on an image identity mismatch before creating a network', async () => {
    const executor = new FakeDockerExecutor();
    executor.imageId = `sha256:${'f'.repeat(64)}`;
    const { runner, request } = await createHarness({ executor });

    await expect(runner.start(request)).rejects.toMatchObject({
      code: 'PREVIEW_IMAGE_VERIFICATION_FAILED',
      stage: 'IMAGE',
    });
    expect(executor.requests.some((call) => call.args[0] === 'network')).toBe(false);
  });

  it('does not confirm cleanup when ephemeral artifact removal fails and stays idempotent', async () => {
    const baseStore = await approvedStore();
    let removalCalls = 0;
    const contentStore: PreviewArtifactContentStore = {
      ...baseStore,
      async remove() {
        removalCalls += 1;
        throw new Error('STORE_UNAVAILABLE');
      },
    };
    const { executor, runner, request } = await createHarness({ contentStore });
    await runner.start(request);
    const stopRequest = {
      previewId: request.previewId,
      executionId: request.executionId,
      reason: 'MANUAL' as const,
    };

    await expect(runner.stop(stopRequest)).rejects.toMatchObject({
      code: 'PREVIEW_CLEANUP_FAILED',
      stage: 'CLEANUP',
    });
    await expect(runner.stop(stopRequest)).rejects.toMatchObject({
      code: 'PREVIEW_CLEANUP_FAILED',
      stage: 'CLEANUP',
    });
    expect(removalCalls).toBe(1);
    expect(
      executor.requests.filter((call) => call.args[0] === 'container' && call.args[1] === 'rm'),
    ).toHaveLength(1);
    expect(
      executor.requests.filter((call) => call.args[0] === 'network' && call.args[1] === 'rm'),
    ).toHaveLength(1);
  });

  it('attempts every cleanup boundary when relay shutdown rejects', async () => {
    const contentStore = await approvedStore();
    const { executor, runner, request } = await createHarness({
      contentStore,
      createRelay: async () => ({
        host: '127.0.0.1',
        port: 43_210,
        accessToken: 'R'.repeat(43),
        async close() {
          throw new Error('RELAY_CLOSE_REJECTED');
        },
      }),
    });
    await runner.start(request);

    await expect(
      runner.stop({
        previewId: request.previewId,
        executionId: request.executionId,
        reason: 'MANUAL',
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_CLEANUP_FAILED',
      stage: 'CLEANUP',
    });

    expect(executor.containerRemoved).toBe(true);
    expect(executor.networkRemoved).toBe(true);
    await expect(contentStore.readApproved(request.artifact.artifactId)).resolves.toBeNull();
  });

  it('fails closed on an indeterminate post-removal inspection while continuing cleanup', async () => {
    const contentStore = await approvedStore();
    const executor = new FakeDockerExecutor();
    const { runner, request } = await createHarness({ contentStore, executor });
    await runner.start(request);
    executor.containerAbsenceIsIndeterminate = true;

    await expect(
      runner.stop({
        previewId: request.previewId,
        executionId: request.executionId,
        reason: 'MANUAL',
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_CLEANUP_FAILED',
      stage: 'CLEANUP',
    });

    expect(executor.containerRemoved).toBe(true);
    expect(executor.networkRemoved).toBe(true);
    await expect(contentStore.readApproved(request.artifact.artifactId)).resolves.toBeNull();
  });

  it('fails closed when orphan absence cannot be established conclusively', async () => {
    const executor = new FakeDockerExecutor();
    executor.containerRemoved = true;
    executor.networkRemoved = true;
    executor.containerAbsenceIsIndeterminate = true;
    const { runner, request } = await createHarness({ executor });

    await expect(
      runner.stop({
        previewId: request.previewId,
        executionId: request.executionId,
        reason: 'RECONCILIATION',
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_CLEANUP_FAILED',
      stage: 'RECONCILIATION',
      sourceCode: 'ORPHAN_INSPECTION_INDETERMINATE',
    });

    expect(executor.requests.some((call) => call.args[1] === 'rm')).toBe(false);
  });

  it('removes the ephemeral artifact on a pre-aborted start without touching Docker', async () => {
    const contentStore = await approvedStore();
    const { executor, runner, request } = await createHarness({ contentStore });
    const controller = new AbortController();
    controller.abort();

    await expect(runner.start(request, { signal: controller.signal })).rejects.toMatchObject({
      code: 'PREVIEW_CANCELLED',
      stage: 'REQUEST_VALIDATION',
    });

    expect(executor.requests).toEqual([]);
    await expect(contentStore.readApproved(request.artifact.artifactId)).resolves.toBeNull();
  });

  it('fails closed when a pre-aborted start cannot remove its ephemeral artifact', async () => {
    const baseStore = await approvedStore();
    const contentStore: PreviewArtifactContentStore = {
      ...baseStore,
      async remove() {
        throw new Error('STORE_UNAVAILABLE');
      },
    };
    const { executor, runner, request } = await createHarness({ contentStore });
    const controller = new AbortController();
    controller.abort();

    await expect(runner.start(request, { signal: controller.signal })).rejects.toMatchObject({
      code: 'PREVIEW_CLEANUP_FAILED',
      stage: 'CLEANUP',
      sourceCode: 'ARTIFACT_REMOVAL_NOT_CONFIRMED',
    });

    expect(executor.requests).toEqual([]);
  });

  it('rejects tampered approved content before any Docker operation', async () => {
    const executor = new FakeDockerExecutor();
    const { runner, request } = await createHarness({ executor });
    const tampered = {
      ...request,
      artifact: {
        ...request.artifact,
        hashes: { ...request.artifact.hashes, artifactHash: '0'.repeat(64) },
      },
    };

    await expect(runner.start(tampered)).rejects.toMatchObject({
      code: 'PREVIEW_INVALID_REQUEST',
      stage: 'REQUEST_VALIDATION',
    });
    expect(executor.requests).toEqual([]);
  });
});
