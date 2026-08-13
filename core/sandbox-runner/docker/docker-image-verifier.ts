import type { SandboxRuntimeObservationInput } from '../result-projector';
import type { SandboxLimits } from '../limits';
import type { SandboxExecutionPolicy } from '../policies';
import {
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  SandboxRunnerError,
} from '../errors';
import type { DockerSandboxImageConfiguration } from './docker-configuration';
import {
  DOCKER_SANDBOX_DEPENDENCY_LABEL,
  DOCKER_SANDBOX_HELPER_LABEL,
  DOCKER_SANDBOX_NODE_LABEL,
  DOCKER_SANDBOX_PATH,
} from './helper-contract';

interface DockerVersionInspection {
  readonly Client?: { readonly Version?: unknown };
  readonly Server?: { readonly Version?: unknown };
}

interface DockerImageInspection {
  readonly Id?: unknown;
  readonly RepoDigests?: unknown;
  readonly Architecture?: unknown;
  readonly Os?: unknown;
  readonly Config?: {
    readonly Labels?: unknown;
    readonly Volumes?: unknown;
    readonly Env?: unknown;
    readonly Cmd?: unknown;
    readonly Entrypoint?: unknown;
  };
}

interface DockerContainerInspection {
  readonly Mounts?: unknown;
  readonly Config?: {
    readonly User?: unknown;
    readonly ExposedPorts?: unknown;
    readonly Entrypoint?: unknown;
    readonly Env?: unknown;
    readonly Labels?: unknown;
    readonly Cmd?: unknown;
  };
  readonly HostConfig?: {
    readonly NetworkMode?: unknown;
    readonly IpcMode?: unknown;
    readonly CgroupnsMode?: unknown;
    readonly PidMode?: unknown;
    readonly UTSMode?: unknown;
    readonly ReadonlyRootfs?: unknown;
    readonly Privileged?: unknown;
    readonly CapAdd?: unknown;
    readonly CapDrop?: unknown;
    readonly SecurityOpt?: unknown;
    readonly PidsLimit?: unknown;
    readonly CpuPeriod?: unknown;
    readonly CpuQuota?: unknown;
    readonly Memory?: unknown;
    readonly MemorySwap?: unknown;
    readonly MemorySwappiness?: unknown;
    readonly OomKillDisable?: unknown;
    readonly Binds?: unknown;
    readonly Mounts?: unknown;
    readonly PortBindings?: unknown;
    readonly Devices?: unknown;
    readonly DeviceRequests?: unknown;
    readonly Tmpfs?: unknown;
    readonly RestartPolicy?: { readonly Name?: unknown };
    readonly LogConfig?: { readonly Type?: unknown };
    readonly Init?: unknown;
    readonly Ulimits?: readonly {
      readonly Name?: unknown;
      readonly Soft?: unknown;
      readonly Hard?: unknown;
    }[];
  };
}

function parseObject<T>(value: string, sourceCode: string): T {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;
  } catch {
    // Mapped to a stable, content-free image error below.
  }
  throw new SandboxRunnerError('O Docker retornou metadados inválidos.', {
    code: SANDBOX_RUNNER_ERROR_CODES.IMAGE_ERROR,
    stage: SANDBOX_RUNNER_ERROR_STAGES.IMAGE,
    sourceCode,
  });
}

function imageError(sourceCode: string): never {
  throw new SandboxRunnerError('A imagem local não corresponde à configuração pinada.', {
    code: SANDBOX_RUNNER_ERROR_CODES.IMAGE_ERROR,
    stage: SANDBOX_RUNNER_ERROR_STAGES.IMAGE,
    sourceCode,
  });
}

export function verifyDockerRuntimeAndImage(input: {
  readonly versionJson: string;
  readonly imageJson: string;
  readonly image: DockerSandboxImageConfiguration;
  readonly policy: SandboxExecutionPolicy;
}): SandboxRuntimeObservationInput {
  const version = parseObject<DockerVersionInspection>(input.versionJson, 'DOCKER_VERSION_FORMAT');
  const image = parseObject<DockerImageInspection>(input.imageJson, 'DOCKER_IMAGE_FORMAT');
  const clientVersion = version.Client?.Version;
  const serverVersion = version.Server?.Version;
  if (typeof clientVersion !== 'string' || typeof serverVersion !== 'string') {
    imageError('DOCKER_VERSION_MISMATCH');
  }

  const expectedDigest = input.image.reference.slice(input.image.reference.indexOf('@') + 1);
  const repoDigests = Array.isArray(image.RepoDigests) ? image.RepoDigests : [];
  const platform = `${String(image.Os)}/${String(image.Architecture)}`;
  const labels =
    image.Config?.Labels !== null && typeof image.Config?.Labels === 'object'
      ? (image.Config.Labels as Record<string, unknown>)
      : {};
  const volumes = image.Config?.Volumes;
  const environment = Array.isArray(image.Config?.Env) ? image.Config.Env : null;
  const hasUnsafeVolumes =
    volumes !== undefined &&
    volumes !== null &&
    (typeof volumes !== 'object' || Array.isArray(volumes) || Object.keys(volumes).length > 0);
  const expectedLabels = {
    ...input.image.requiredLabels,
    [DOCKER_SANDBOX_HELPER_LABEL]: input.policy.helperAbiVersion,
    [DOCKER_SANDBOX_DEPENDENCY_LABEL]: input.policy.dependencySnapshotHash ?? 'none',
    [DOCKER_SANDBOX_NODE_LABEL]: input.policy.runtime.version,
  };
  const expectedToolchainLabels = Object.fromEntries(
    Object.entries(input.image.toolchainVersions).map(([name, version]) => [
      `org.brq.sandbox.toolchain.${name.toLowerCase()}`,
      version,
    ]),
  );
  if (input.image.toolchainVersions.NODE !== input.policy.runtime.version) {
    imageError('DOCKER_IMAGE_NODE_POLICY_MISMATCH');
  }
  if (image.Id !== input.image.expectedImageId) imageError('DOCKER_IMAGE_ID_MISMATCH');
  if (!repoDigests.includes(input.image.reference)) {
    imageError('DOCKER_IMAGE_REPOSITORY_DIGEST_MISMATCH');
  }
  if (platform !== input.image.platform) imageError('DOCKER_IMAGE_PLATFORM_MISMATCH');
  if (hasUnsafeVolumes) imageError('DOCKER_IMAGE_VOLUMES_MISMATCH');
  if (image.Config?.Cmd !== null && image.Config?.Cmd !== undefined) {
    imageError('DOCKER_IMAGE_COMMAND_MISMATCH');
  }
  if (image.Config?.Entrypoint !== null && image.Config?.Entrypoint !== undefined) {
    imageError('DOCKER_IMAGE_ENTRYPOINT_MISMATCH');
  }
  if (Object.entries(expectedLabels).some(([key, value]) => labels[key] !== value)) {
    imageError('DOCKER_IMAGE_REQUIRED_LABEL_MISMATCH');
  }
  if (Object.entries(expectedToolchainLabels).some(([key, value]) => labels[key] !== value)) {
    imageError('DOCKER_IMAGE_TOOLCHAIN_LABEL_MISMATCH');
  }
  if (
    environment === null ||
    environment.length !== 1 ||
    environment[0] !== `PATH=${DOCKER_SANDBOX_PATH}`
  ) {
    imageError('DOCKER_IMAGE_ENVIRONMENT_MISMATCH');
  }
  return Object.freeze({
    adapter: 'DOCKER',
    engineName: 'DOCKER_ENGINE',
    clientVersion,
    serverVersion,
    imageReference: input.image.reference,
    imageDigest: expectedDigest,
    imageId: input.image.expectedImageId,
    platform,
    runtimeName: input.policy.runtime.name,
    runtimeVersion: input.policy.runtime.version,
    toolchainVersions: Object.freeze({ ...input.image.toolchainVersions }),
  });
}

function hasString(values: unknown, expected: string): boolean {
  return Array.isArray(values) && values.includes(expected);
}

function expectedTmpfs(bytes: number, inodes: number): string {
  return `rw,nosuid,nodev,noexec,size=${bytes},nr_inodes=${inodes},mode=0700,uid=65532,gid=65532`;
}

function isPrivateNamespaceMode(value: unknown): boolean {
  return value === '' || value === 'private';
}

export function verifyCreatedContainer(
  inspectionJson: string,
  limits: SandboxLimits,
  ownershipToken: string,
): void {
  const inspection = parseObject<DockerContainerInspection>(
    inspectionJson,
    'DOCKER_CONTAINER_FORMAT',
  );
  const host = inspection.HostConfig;
  const tmpfs =
    host?.Tmpfs !== null && typeof host?.Tmpfs === 'object'
      ? (host.Tmpfs as Record<string, unknown>)
      : {};
  const ulimit = host?.Ulimits?.find((value) => value.Name === 'nofile');
  const containerLabels =
    inspection.Config?.Labels !== null && typeof inspection.Config?.Labels === 'object'
      ? (inspection.Config.Labels as Record<string, unknown>)
      : {};
  const containerEnvironment = Array.isArray(inspection.Config?.Env) ? inspection.Config.Env : null;
  const expectedQuota = Math.max(1, Math.floor((limits.cpus * 1_000_000_000) / 10_000));
  if (
    inspection.Config?.User !== '65532:65532' ||
    inspection.Config.ExposedPorts != null ||
    !Array.isArray(inspection.Config.Entrypoint) ||
    inspection.Config.Entrypoint.length !== 1 ||
    inspection.Config.Entrypoint[0] !== '/opt/brq/sandbox/idle' ||
    !Array.isArray(inspection.Config.Cmd) ||
    inspection.Config.Cmd.length !== 1 ||
    inspection.Config.Cmd[0] !== '--hold' ||
    containerLabels['org.brq.sandbox.ownership'] !== ownershipToken ||
    containerEnvironment === null ||
    containerEnvironment.length !== 1 ||
    containerEnvironment[0] !== `PATH=${DOCKER_SANDBOX_PATH}` ||
    host?.NetworkMode !== 'none' ||
    host.IpcMode !== 'none' ||
    host.CgroupnsMode !== 'private' ||
    !isPrivateNamespaceMode(host.PidMode) ||
    !isPrivateNamespaceMode(host.UTSMode) ||
    host.ReadonlyRootfs !== true ||
    host.Privileged !== false ||
    (host.CapAdd !== null &&
      host.CapAdd !== undefined &&
      (!Array.isArray(host.CapAdd) || host.CapAdd.length > 0)) ||
    !Array.isArray(host.CapDrop) ||
    host.CapDrop.length !== 1 ||
    !hasString(host.CapDrop, 'ALL') ||
    !Array.isArray(host.SecurityOpt) ||
    host.SecurityOpt.length !== 2 ||
    !hasString(host.SecurityOpt, 'no-new-privileges=true') ||
    !hasString(host.SecurityOpt, 'seccomp=builtin') ||
    host.PidsLimit !== limits.pidsLimit ||
    host.CpuPeriod !== 100_000 ||
    host.CpuQuota !== expectedQuota ||
    host.Memory !== limits.memoryBytes ||
    host.MemorySwap !== limits.memoryBytes ||
    (host.MemorySwappiness !== 0 && host.MemorySwappiness !== null) ||
    host.OomKillDisable !== false ||
    (host.Binds !== null &&
      host.Binds !== undefined &&
      (!Array.isArray(host.Binds) || host.Binds.length > 0)) ||
    (host.Mounts !== null &&
      host.Mounts !== undefined &&
      (!Array.isArray(host.Mounts) || host.Mounts.length > 0)) ||
    (host.Devices !== null &&
      host.Devices !== undefined &&
      (!Array.isArray(host.Devices) || host.Devices.length > 0)) ||
    (host.DeviceRequests !== null &&
      host.DeviceRequests !== undefined &&
      (!Array.isArray(host.DeviceRequests) || host.DeviceRequests.length > 0)) ||
    !Array.isArray(inspection.Mounts) ||
    inspection.Mounts.length > 0 ||
    (host.PortBindings !== undefined &&
      host.PortBindings !== null &&
      (typeof host.PortBindings !== 'object' ||
        Array.isArray(host.PortBindings) ||
        Object.keys(host.PortBindings).length > 0)) ||
    tmpfs['/workspace'] !== expectedTmpfs(limits.workspaceBytes, limits.workspaceInodes) ||
    tmpfs['/tmp'] !== expectedTmpfs(limits.temporaryBytes, limits.temporaryInodes) ||
    host.RestartPolicy?.Name !== 'no' ||
    host.LogConfig?.Type !== 'none' ||
    host.Init !== true ||
    ulimit?.Soft !== limits.openFilesLimit ||
    ulimit.Hard !== limits.openFilesLimit
  ) {
    throw new SandboxRunnerError('O container criado não preserva as restrições exigidas.', {
      code: SANDBOX_RUNNER_ERROR_CODES.START_FAILED,
      stage: SANDBOX_RUNNER_ERROR_STAGES.START,
      sourceCode: 'DOCKER_CONTAINER_POLICY_MISMATCH',
    });
  }
}
