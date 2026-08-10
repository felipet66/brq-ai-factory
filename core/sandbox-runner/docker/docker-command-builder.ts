import type { SandboxLimits } from '../limits';
import type { SandboxCommandPolicy } from '../policies';
import {
  DOCKER_SANDBOX_IDLE_ARGUMENT,
  DOCKER_SANDBOX_IDLE_EXECUTABLE,
  DOCKER_SANDBOX_READY_EXECUTABLE,
} from './helper-contract';
import { DOCKER_SANDBOX_ARTIFACT_EXPORT_EXECUTABLE } from './artifact-capture';

export const SANDBOX_CONTAINER_USER = '65532:65532';
export const SANDBOX_WORKING_DIRECTORY = '/workspace/project';

const FIXED_STEP_ENVIRONMENT = Object.freeze({
  CI: '1',
  HOME: '/tmp/home',
  NO_COLOR: '1',
  TMPDIR: '/tmp',
});
const ALLOWED_POLICY_ENVIRONMENT = new Set(['CI', 'HOME', 'NODE_OPTIONS', 'NO_COLOR', 'TMPDIR']);

const FORBIDDEN_EXECUTABLE_NAMES = new Set([
  'bash',
  'corepack',
  'dash',
  'env',
  'npm',
  'npx',
  'pnpm',
  'sh',
  'yarn',
  'zsh',
]);
const FORBIDDEN_NODE_ARGUMENTS = new Set(['-e', '--eval', '-p', '--print']);

function executableName(executable: string): string {
  return executable.slice(executable.lastIndexOf('/') + 1).toLowerCase();
}

export function isStrictSandboxCommand(policy: SandboxCommandPolicy): boolean {
  if (FORBIDDEN_EXECUTABLE_NAMES.has(executableName(policy.executable))) return false;
  if (policy.executable !== '/usr/local/bin/node') return false;
  if (Object.keys(policy.environment).some((key) => !ALLOWED_POLICY_ENVIRONMENT.has(key))) {
    return false;
  }
  const helper = policy.args[0];
  if (helper === undefined || !/^\/opt\/brq\/runner\/[A-Za-z0-9._-]+\.mjs$/u.test(helper)) {
    return false;
  }
  return policy.args.every(
    (argument) =>
      !argument.includes('\u0000') &&
      !FORBIDDEN_NODE_ARGUMENTS.has(argument) &&
      !argument.includes('/var/run/docker.sock'),
  );
}

function tmpfsSpecification(target: '/workspace' | '/tmp', bytes: number, inodes: number): string {
  return `${target}:rw,nosuid,nodev,noexec,size=${bytes},nr_inodes=${inodes},mode=0700,uid=65532,gid=65532`;
}

export function buildCreateContainerArguments(input: {
  readonly containerName: string;
  readonly ownershipToken: string;
  readonly imageReference: string;
  readonly limits: SandboxLimits;
}): readonly string[] {
  const nanoCpus = Math.floor(input.limits.cpus * 1_000_000_000);
  // Docker's empty PID/UTS inspect modes are the private defaults. CLI 28 rejects
  // `--pid=private` and `--uts=private`, so the post-create verifier enforces the defaults.
  return Object.freeze([
    'container',
    'create',
    '--name',
    input.containerName,
    '--label',
    `org.brq.sandbox.ownership=${input.ownershipToken}`,
    '--pull=never',
    '--network=none',
    '--ipc=none',
    '--cgroupns=private',
    '--read-only',
    `--user=${SANDBOX_CONTAINER_USER}`,
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges=true',
    '--security-opt=seccomp=builtin',
    `--pids-limit=${input.limits.pidsLimit}`,
    `--cpu-period=100000`,
    `--cpu-quota=${Math.max(1, Math.floor(nanoCpus / 10_000))}`,
    `--memory=${input.limits.memoryBytes}`,
    `--memory-swap=${input.limits.memoryBytes}`,
    '--memory-swappiness=0',
    '--restart=no',
    '--no-healthcheck',
    '--log-driver=none',
    '--init',
    `--entrypoint=${DOCKER_SANDBOX_IDLE_EXECUTABLE}`,
    '--stop-timeout=2',
    `--ulimit=nofile=${input.limits.openFilesLimit}:${input.limits.openFilesLimit}`,
    `--tmpfs=${tmpfsSpecification(
      '/workspace',
      input.limits.workspaceBytes,
      input.limits.workspaceInodes,
    )}`,
    `--tmpfs=${tmpfsSpecification(
      '/tmp',
      input.limits.temporaryBytes,
      input.limits.temporaryInodes,
    )}`,
    input.imageReference,
    DOCKER_SANDBOX_IDLE_ARGUMENT,
  ]);
}

export function buildExecArguments(input: {
  readonly containerId: string;
  readonly policy: SandboxCommandPolicy;
  readonly interactive: boolean;
  readonly memoryBytes: number;
}): readonly string[] {
  const memoryMiB = Math.floor(input.memoryBytes / (1024 * 1024));
  const heapMiB = Math.min(1536, Math.max(64, Math.floor(memoryMiB * 0.75)));
  const environment = Object.entries({
    ...input.policy.environment,
    ...FIXED_STEP_ENVIRONMENT,
    NODE_OPTIONS: `--max-old-space-size=${heapMiB}`,
  })
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  return Object.freeze([
    'container',
    'exec',
    '--workdir',
    input.policy.workingDirectory,
    '--user',
    SANDBOX_CONTAINER_USER,
    ...(input.interactive ? ['--interactive'] : []),
    ...environment,
    input.containerId,
    input.policy.executable,
    ...input.policy.args,
  ]);
}

export function buildReadinessArguments(containerId: string): readonly string[] {
  return Object.freeze([
    'container',
    'exec',
    '--workdir',
    '/',
    '--user',
    SANDBOX_CONTAINER_USER,
    containerId,
    '/usr/local/bin/node',
    DOCKER_SANDBOX_READY_EXECUTABLE,
  ]);
}

/** Fixed, adapter-owned artifact export command; no generated value can select this executable. */
export function buildArtifactExportArguments(containerId: string): readonly string[] {
  return Object.freeze([
    'container',
    'exec',
    '--workdir',
    SANDBOX_WORKING_DIRECTORY,
    '--user',
    SANDBOX_CONTAINER_USER,
    '--env',
    'CI=1',
    '--env',
    'NO_COLOR=1',
    containerId,
    '/usr/local/bin/node',
    DOCKER_SANDBOX_ARTIFACT_EXPORT_EXECUTABLE,
    '--workspace',
    SANDBOX_WORKING_DIRECTORY,
  ]);
}
