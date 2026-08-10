import type { PreviewLimits } from '../limits';

export const PREVIEW_CONTAINER_USER = '65532:65532';
export const PREVIEW_IDLE_EXECUTABLE = '/opt/brq/preview/idle';
export const PREVIEW_PREPARE_EXECUTABLE = '/opt/brq/preview/prepare.mjs';
export const PREVIEW_SERVER_EXECUTABLE = '/opt/brq/preview/serve.mjs';
export const PREVIEW_RELAY_EXECUTABLE = '/opt/brq/preview/relay.mjs';
export const PREVIEW_INTERNAL_PORT = 8080;

function tmpfsSpecification(bytes: number, inodes: number): string {
  return `/preview:rw,nosuid,nodev,noexec,size=${bytes},nr_inodes=${inodes},mode=0700,uid=65532,gid=65532`;
}

export function buildCreateNetworkArguments(input: {
  readonly networkName: string;
  readonly ownershipToken: string;
  readonly previewId: string;
  readonly executionId: string;
  readonly artifactId: string;
}): readonly string[] {
  return Object.freeze([
    'network',
    'create',
    '--driver=bridge',
    '--internal',
    '--label',
    'org.brq.preview.managed=1',
    '--label',
    `org.brq.preview.ownership=${input.ownershipToken}`,
    '--label',
    `org.brq.preview.id=${input.previewId}`,
    '--label',
    `org.brq.preview.execution=${input.executionId}`,
    '--label',
    `org.brq.preview.artifact=${input.artifactId}`,
    '--opt',
    'com.docker.network.bridge.enable_icc=false',
    input.networkName,
  ]);
}

export function buildCreatePreviewContainerArguments(input: {
  readonly containerName: string;
  readonly networkName: string;
  readonly ownershipToken: string;
  readonly previewId: string;
  readonly executionId: string;
  readonly artifactId: string;
  readonly expiresAtEpochSeconds: number;
  readonly imageReference: string;
  readonly limits: PreviewLimits;
}): readonly string[] {
  const nanoCpus = Math.floor(input.limits.cpus * 1_000_000_000);
  const inodes = Math.max(256, input.limits.artifactFiles * 4 + 32);
  return Object.freeze([
    'container',
    'create',
    '--name',
    input.containerName,
    '--label',
    'org.brq.preview.managed=1',
    '--label',
    `org.brq.preview.ownership=${input.ownershipToken}`,
    '--label',
    `org.brq.preview.id=${input.previewId}`,
    '--label',
    `org.brq.preview.execution=${input.executionId}`,
    '--label',
    `org.brq.preview.artifact=${input.artifactId}`,
    '--label',
    `org.brq.preview.expires=${input.expiresAtEpochSeconds}`,
    '--pull=never',
    `--network=${input.networkName}`,
    '--ipc=none',
    '--cgroupns=private',
    '--read-only',
    `--user=${PREVIEW_CONTAINER_USER}`,
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges=true',
    '--security-opt=seccomp=builtin',
    `--pids-limit=${input.limits.pidsLimit}`,
    '--cpu-period=100000',
    `--cpu-quota=${Math.max(1, Math.floor(nanoCpus / 10_000))}`,
    `--memory=${input.limits.memoryBytes}`,
    `--memory-swap=${input.limits.memoryBytes}`,
    '--memory-swappiness=0',
    '--restart=no',
    '--no-healthcheck',
    '--log-driver=none',
    '--init',
    `--entrypoint=${PREVIEW_IDLE_EXECUTABLE}`,
    '--stop-timeout=2',
    `--ulimit=nofile=${input.limits.openFilesLimit}:${input.limits.openFilesLimit}`,
    `--tmpfs=${tmpfsSpecification(input.limits.temporaryBytes, inodes)}`,
    input.imageReference,
    '--hold',
  ]);
}

export function buildRelayArguments(containerId: string): readonly string[] {
  return Object.freeze([
    'container',
    'exec',
    '--interactive',
    '--workdir',
    '/',
    '--user',
    PREVIEW_CONTAINER_USER,
    '--env',
    'NODE_ENV=production',
    containerId,
    '/usr/local/bin/node',
    PREVIEW_RELAY_EXECUTABLE,
  ]);
}

export function buildPrepareArguments(containerId: string): readonly string[] {
  return Object.freeze([
    'container',
    'exec',
    '--interactive',
    '--workdir',
    '/',
    '--user',
    PREVIEW_CONTAINER_USER,
    '--env',
    'NODE_ENV=production',
    containerId,
    '/usr/local/bin/node',
    PREVIEW_PREPARE_EXECUTABLE,
  ]);
}

export function buildStartServerArguments(
  containerId: string,
  ttlSeconds: number,
): readonly string[] {
  return Object.freeze([
    'container',
    'exec',
    '--detach',
    '--workdir',
    '/',
    '--user',
    PREVIEW_CONTAINER_USER,
    '--env',
    'NODE_ENV=production',
    '--env',
    `BRQ_PREVIEW_TTL_SECONDS=${ttlSeconds}`,
    containerId,
    '/usr/local/bin/node',
    PREVIEW_SERVER_EXECUTABLE,
  ]);
}
