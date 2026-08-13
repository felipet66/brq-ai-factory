import { describe, expect, it } from 'vitest';

import { SANDBOX_RUNNER_ERROR_CODES, SANDBOX_RUNNER_ERROR_STAGES } from '../errors';
import { SANDBOX_ABSOLUTE_LIMITS } from '../limits';
import { sanitizeSandboxOutput } from '../output-sanitizer';
import { createSandboxExecutionPolicyFixture } from '../testing/sandbox-runner-fixtures';
import {
  buildCreateContainerArguments,
  buildExecArguments,
  buildReadinessArguments,
  isStrictSandboxCommand,
} from './docker-command-builder';
import { verifyCreatedContainer, verifyDockerRuntimeAndImage } from './docker-image-verifier';
import { BoundedDockerOutputCollector } from './output-collector';

const imageReference = `registry.example/sandbox@sha256:${'a'.repeat(64)}`;
const imageId = `sha256:${'b'.repeat(64)}`;
const requiredImageLabel = 'org.brq.sandbox.execution-profile';
const requiredImageLabelValue = 'node-web-preview-24-v1';

function validImageInspection() {
  return {
    Id: imageId,
    RepoDigests: [imageReference],
    Architecture: 'arm64',
    Os: 'linux',
    Config: {
      Labels: {
        'org.brq.sandbox.helper-abi': '1.1.0',
        'org.brq.sandbox.dependency-snapshot': 'none',
        'org.brq.sandbox.runtime-node': '24.19.0',
        'org.brq.sandbox.toolchain.node': '24.19.0',
      },
      Volumes: null,
      Env: ['PATH=/usr/local/bin:/usr/bin:/bin'],
      Cmd: null,
      Entrypoint: null,
    },
  };
}

type DockerImageVerificationInput = Parameters<typeof verifyDockerRuntimeAndImage>[0];

function validLabeledImageInspection() {
  const inspection = validImageInspection();
  return {
    ...inspection,
    Config: {
      ...inspection.Config,
      Labels: {
        ...inspection.Config.Labels,
        [requiredImageLabel]: requiredImageLabelValue,
      },
    },
  };
}

function validDockerImageVerificationInput(options?: {
  readonly inspection?: unknown;
  readonly image?: Partial<DockerImageVerificationInput['image']>;
}): DockerImageVerificationInput {
  return {
    versionJson: JSON.stringify({
      Client: { Version: '28.0.0' },
      Server: { Version: '28.0.0' },
    }),
    imageJson: JSON.stringify(options?.inspection ?? validLabeledImageInspection()),
    image: {
      reference: imageReference,
      expectedImageId: imageId,
      platform: 'linux/arm64',
      requiredLabels: { [requiredImageLabel]: requiredImageLabelValue },
      toolchainVersions: { NODE: '24.19.0' },
      ...options?.image,
    },
    policy: createSandboxExecutionPolicyFixture(),
  };
}

function expectDockerImageMismatch(input: DockerImageVerificationInput, sourceCode: string): void {
  let thrown: unknown;
  try {
    verifyDockerRuntimeAndImage(input);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toMatchObject({
    code: SANDBOX_RUNNER_ERROR_CODES.IMAGE_ERROR,
    stage: SANDBOX_RUNNER_ERROR_STAGES.IMAGE,
    sourceCode,
  });
}

function validContainerInspection() {
  const limits = SANDBOX_ABSOLUTE_LIMITS;
  return {
    Config: {
      User: '65532:65532',
      ExposedPorts: null,
      Entrypoint: ['/opt/brq/sandbox/idle'],
      Cmd: ['--hold'],
      Env: ['PATH=/usr/local/bin:/usr/bin:/bin'],
      Labels: { 'org.brq.sandbox.ownership': 'attempt-a' },
    },
    Mounts: [],
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
      PidsLimit: limits.pidsLimit,
      CpuPeriod: 100_000,
      CpuQuota: 100_000,
      Memory: limits.memoryBytes,
      MemorySwap: limits.memoryBytes,
      MemorySwappiness: null,
      OomKillDisable: false,
      Binds: [],
      Mounts: [],
      Devices: [],
      DeviceRequests: [],
      PortBindings: {},
      Tmpfs: {
        '/workspace': `rw,nosuid,nodev,noexec,size=${limits.workspaceBytes},nr_inodes=${limits.workspaceInodes},mode=0700,uid=65532,gid=65532`,
        '/tmp': `rw,nosuid,nodev,noexec,size=${limits.temporaryBytes},nr_inodes=${limits.temporaryInodes},mode=0700,uid=65532,gid=65532`,
      },
      RestartPolicy: { Name: 'no' },
      LogConfig: { Type: 'none' },
      Init: true,
      Ulimits: [{ Name: 'nofile', Soft: limits.openFilesLimit, Hard: limits.openFilesLimit }],
    },
  };
}

describe('Docker command policy', () => {
  it('pins every isolation flag and exposes only tmpfs-backed writable locations', () => {
    const args = buildCreateContainerArguments({
      containerName: 'brq-sandbox-a',
      ownershipToken: 'attempt-a',
      imageReference: `registry.example/sandbox@sha256:${'a'.repeat(64)}`,
      limits: SANDBOX_ABSOLUTE_LIMITS,
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '--pull=never',
        '--network=none',
        '--ipc=none',
        '--cgroupns=private',
        '--read-only',
        '--user=65532:65532',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges=true',
        '--security-opt=seccomp=builtin',
        '--pids-limit=128',
        '--memory=2147483648',
        '--memory-swap=2147483648',
        '--ulimit=nofile=1024:1024',
        '--entrypoint=/opt/brq/sandbox/idle',
      ]),
    );
    expect(args.filter((value) => value.startsWith('--tmpfs='))).toEqual([
      expect.stringContaining('size=536870912,nr_inodes=32768'),
      expect.stringContaining('size=134217728,nr_inodes=16384'),
    ]);
    expect(args.slice(-2)).toEqual([`registry.example/sandbox@sha256:${'a'.repeat(64)}`, '--hold']);
    expect(args).not.toEqual(
      expect.arrayContaining([
        '--privileged',
        '--mount',
        '--volume',
        '-v',
        '--pid=private',
        '--uts=private',
      ]),
    );
  });

  it('accepts only pinned node helpers without traversal, eval, shell, or package managers', () => {
    const policy = createSandboxExecutionPolicyFixture().steps.TEST;
    expect(isStrictSandboxCommand(policy)).toBe(true);
    expect(
      isStrictSandboxCommand({
        ...policy,
        args: ['/opt/brq/runner/../../../tmp/untrusted.mjs'],
      }),
    ).toBe(false);
    expect(isStrictSandboxCommand({ ...policy, args: ['-e', 'process.exit()'] })).toBe(false);
    expect(isStrictSandboxCommand({ ...policy, executable: '/bin/sh', args: ['-c', 'true'] })).toBe(
      false,
    );
    expect(
      isStrictSandboxCommand({ ...policy, executable: '/usr/local/bin/npm', args: ['test'] }),
    ).toBe(false);
  });

  it('builds exec argv without a shell and fixes user, workdir, and environment', () => {
    const policy = createSandboxExecutionPolicyFixture().steps.BUILD;
    const args = buildExecArguments({
      containerId: 'a'.repeat(64),
      policy,
      interactive: false,
      memoryBytes: SANDBOX_ABSOLUTE_LIMITS.memoryBytes,
    });
    expect(args).toEqual(
      expect.arrayContaining([
        '--workdir',
        '/workspace/project',
        '--user',
        '65532:65532',
        '--env',
        'HOME=/tmp/home',
        '--env',
        'NODE_OPTIONS=--max-old-space-size=1536',
        '/usr/local/bin/node',
      ]),
    );
    expect(args).not.toEqual(expect.arrayContaining(['sh', '-c', 'npm', 'npx']));
  });

  it('uses a fixed root-workdir readiness helper before policy steps', () => {
    const args = buildReadinessArguments('a'.repeat(64));

    expect(args).toEqual([
      'container',
      'exec',
      '--workdir',
      '/',
      '--user',
      '65532:65532',
      'a'.repeat(64),
      '/usr/local/bin/node',
      '/opt/brq/runner/ready.mjs',
    ]);
    expect(args).not.toEqual(expect.arrayContaining(['sh', '-c', 'npm', 'npx']));
  });
});

describe('bounded Docker output collector', () => {
  it('retains head and tail with exact observed metrics', () => {
    const collector = new BoundedDockerOutputCollector(80 * 1024);
    const chunk = Buffer.from(`${'a'.repeat(70 * 1024)}\n${'b'.repeat(70 * 1024)}`, 'utf8');
    collector.append(chunk.subarray(0, 50_001));
    collector.append(chunk.subarray(50_001));

    const output = collector.finish();

    expect(output.captureTruncated).toBe(true);
    expect(output.observedBytes).toBe(chunk.byteLength);
    expect(output.observedLines).toBe(2);
    expect(output.value).toContain('...[OUTPUT TRUNCATED]...');
    expect(output.value.startsWith('aaaa')).toBe(true);
    expect(output.value.endsWith('bbbb')).toBe(true);
  });

  it('never introduces replacement characters at UTF-8 retention boundaries', () => {
    const collector = new BoundedDockerOutputCollector(65_540);
    collector.append(Buffer.from(`${'a'.repeat(65_535)}😀${'b'.repeat(20_000)}`, 'utf8'));

    expect(collector.finish().value).not.toContain('\uFFFD');
  });

  it('retains complete sub-hard-limit output so redaction spans stream chunks', () => {
    const collector = new BoundedDockerOutputCollector(32, 1024);
    collector.append(Buffer.from('prefix sk-proj-abcdefgh', 'utf8'));
    collector.append(Buffer.from('ijklmnop suffix', 'utf8'));

    const captured = collector.finish();
    const sanitized = sanitizeSandboxOutput(captured.value, {
      maxBytes: 32,
      maxLines: 10,
      maxLineBytes: 64,
    });

    expect(captured.captureTruncated).toBe(true);
    expect(captured.value).not.toContain('OUTPUT TRUNCATED');
    expect(sanitized.summary).not.toContain('sk-proj-abcdefghijklmnop');
  });
});

describe('Docker inspect verification', () => {
  it('accepts both Docker default and normalized private namespace metadata', () => {
    expect(() =>
      verifyCreatedContainer(
        JSON.stringify(validContainerInspection()),
        SANDBOX_ABSOLUTE_LIMITS,
        'attempt-a',
      ),
    ).not.toThrow();
    const normalized = validContainerInspection();
    expect(() =>
      verifyCreatedContainer(
        JSON.stringify({
          ...normalized,
          HostConfig: {
            ...normalized.HostConfig,
            PidMode: 'private',
            UTSMode: 'private',
            MemorySwappiness: 0,
          },
        }),
        SANDBOX_ABSOLUTE_LIMITS,
        'attempt-a',
      ),
    ).not.toThrow();
  });

  it.each([
    ['environment', { Env: ['PATH=/workspace/bin'] }],
    ['declared volume', { Volumes: { '/data': {} } }],
    ['invalid volume metadata', { Volumes: 'host:/data' }],
    ['missing helper label', { Labels: {} }],
    ['default command', { Cmd: ['node', 'server.js'] }],
    ['default entrypoint', { Entrypoint: ['/bin/sh'] }],
    [
      'altered toolchain label',
      {
        Labels: {
          ...validImageInspection().Config.Labels,
          'org.brq.sandbox.toolchain.node': '23.0.0',
        },
      },
    ],
  ])('rejects an image with unsafe %s', (_name, configOverride) => {
    const image = validImageInspection();
    expect(() =>
      verifyDockerRuntimeAndImage({
        versionJson: JSON.stringify({
          Client: { Version: '28.0.0' },
          Server: { Version: '28.0.0' },
        }),
        imageJson: JSON.stringify({
          ...image,
          Config: { ...image.Config, ...configOverride },
        }),
        image: {
          reference: imageReference,
          expectedImageId: imageId,
          platform: 'linux/arm64',
          requiredLabels: {},
          toolchainVersions: { NODE: '24.19.0' },
        },
        policy: createSandboxExecutionPolicyFixture(),
      }),
    ).toThrow(/imagem local/u);
  });

  it.each([
    [
      'image ID',
      'DOCKER_IMAGE_ID_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: { ...inspection, Id: `sha256:${'c'.repeat(64)}` },
        });
      },
    ],
    [
      'repository digest',
      'DOCKER_IMAGE_REPOSITORY_DIGEST_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: { ...inspection, RepoDigests: [] },
        });
      },
    ],
    [
      'platform',
      'DOCKER_IMAGE_PLATFORM_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: { ...inspection, Architecture: 'amd64' },
        });
      },
    ],
    [
      'declared volumes',
      'DOCKER_IMAGE_VOLUMES_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: {
            ...inspection,
            Config: { ...inspection.Config, Volumes: { '/data': {} } },
          },
        });
      },
    ],
    [
      'default command',
      'DOCKER_IMAGE_COMMAND_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: {
            ...inspection,
            Config: { ...inspection.Config, Cmd: ['node', 'server.js'] },
          },
        });
      },
    ],
    [
      'default entrypoint',
      'DOCKER_IMAGE_ENTRYPOINT_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: {
            ...inspection,
            Config: { ...inspection.Config, Entrypoint: ['/bin/sh'] },
          },
        });
      },
    ],
    [
      'required label',
      'DOCKER_IMAGE_REQUIRED_LABEL_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: {
            ...inspection,
            Config: {
              ...inspection.Config,
              Labels: { ...inspection.Config.Labels, [requiredImageLabel]: 'other-profile' },
            },
          },
        });
      },
    ],
    [
      'helper label',
      'DOCKER_IMAGE_REQUIRED_LABEL_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: {
            ...inspection,
            Config: {
              ...inspection.Config,
              Labels: {
                ...inspection.Config.Labels,
                'org.brq.sandbox.helper-abi': '1.0.0',
              },
            },
          },
        });
      },
    ],
    [
      'toolchain label',
      'DOCKER_IMAGE_TOOLCHAIN_LABEL_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: {
            ...inspection,
            Config: {
              ...inspection.Config,
              Labels: {
                ...inspection.Config.Labels,
                'org.brq.sandbox.toolchain.node': '23.0.0',
              },
            },
          },
        });
      },
    ],
    [
      'environment',
      'DOCKER_IMAGE_ENVIRONMENT_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: {
            ...inspection,
            Config: { ...inspection.Config, Env: ['PATH=/workspace/bin'] },
          },
        });
      },
    ],
    [
      'Node policy',
      'DOCKER_IMAGE_NODE_POLICY_MISMATCH',
      () => {
        const inspection = validLabeledImageInspection();
        return validDockerImageVerificationInput({
          inspection: {
            ...inspection,
            Config: {
              ...inspection.Config,
              Labels: {
                ...inspection.Config.Labels,
                'org.brq.sandbox.toolchain.node': '23.0.0',
              },
            },
          },
          image: { toolchainVersions: { NODE: '23.0.0' } },
        });
      },
    ],
  ] satisfies readonly [string, string, () => DockerImageVerificationInput][])(
    'reports the specific source code for an image %s mismatch',
    (_name, sourceCode, createInput) => {
      expectDockerImageMismatch(createInput(), sourceCode);
    },
  );

  it.each([
    [
      'privileged',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, Privileged: true },
      }),
    ],
    [
      'mount',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        Mounts: [{ Type: 'bind', Source: '/host' }],
      }),
    ],
    [
      'host network',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, NetworkMode: 'host' },
      }),
    ],
    [
      'host IPC',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, IpcMode: 'host' },
      }),
    ],
    [
      'host PID namespace',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, PidMode: 'host' },
      }),
    ],
    [
      'host UTS namespace',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, UTSMode: 'host' },
      }),
    ],
    [
      'nonzero memory swappiness',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, MemorySwappiness: 1 },
      }),
    ],
    [
      'host-config mount',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, Mounts: [{ Type: 'bind', Source: '/host' }] },
      }),
    ],
    [
      'device',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, Devices: [{ PathOnHost: '/dev/kvm' }] },
      }),
    ],
    [
      'device request',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, DeviceRequests: [{ Capabilities: [['gpu']] }] },
      }),
    ],
    [
      'published port',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: {
          ...value.HostConfig,
          PortBindings: { '3000/tcp': [{ HostPort: '3000' }] },
        },
      }),
    ],
    [
      'primitive port bindings',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: { ...value.HostConfig, PortBindings: 'host-network' },
      }),
    ],
    [
      'altered entrypoint',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        Config: { ...value.Config, Entrypoint: ['/bin/sh'] },
      }),
    ],
    [
      'altered idle argument',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        Config: { ...value.Config, Cmd: ['--serve'] },
      }),
    ],
    [
      'extra security option',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: {
          ...value.HostConfig,
          SecurityOpt: [...value.HostConfig.SecurityOpt, 'apparmor=unconfined'],
        },
      }),
    ],
    [
      'altered tmpfs',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: {
          ...value.HostConfig,
          Tmpfs: { ...value.HostConfig.Tmpfs, '/tmp': 'rw,size=999999999' },
        },
      }),
    ],
    [
      'altered nofile',
      (value: ReturnType<typeof validContainerInspection>) => ({
        ...value,
        HostConfig: {
          ...value.HostConfig,
          Ulimits: [{ Name: 'nofile', Soft: 4096, Hard: 4096 }],
        },
      }),
    ],
  ])('rejects a container with %s', (_name, mutate) => {
    expect(() =>
      verifyCreatedContainer(
        JSON.stringify(mutate(validContainerInspection())),
        SANDBOX_ABSOLUTE_LIMITS,
        'attempt-a',
      ),
    ).toThrow(/restrições exigidas/u);
  });
});
