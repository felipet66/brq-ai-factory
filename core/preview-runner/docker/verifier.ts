import type { ApprovedPreviewStartRequest, PreviewRuntimeObservation } from '../contracts';
import type { PreviewLimits } from '../limits';
import type { DockerPreviewImageConfiguration } from './configuration';
import { PREVIEW_CONTAINER_USER, PREVIEW_IDLE_EXECUTABLE } from './command-builder';

function requiredObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_DOCKER_INSPECTION');
  }
  return value as Record<string, unknown>;
}

function exactArray(value: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(value) && JSON.stringify(value) === JSON.stringify(expected);
}

export function verifyDockerRuntimeAndImage(input: {
  readonly versionJson: string;
  readonly imageJson: string;
  readonly image: DockerPreviewImageConfiguration;
  readonly policy: ApprovedPreviewStartRequest['policy'];
}): PreviewRuntimeObservation {
  const version = requiredObject(JSON.parse(input.versionJson));
  const image = requiredObject(JSON.parse(input.imageJson));
  const client = requiredObject(version.Client);
  const server = requiredObject(version.Server);
  const config = requiredObject(image.Config);
  const labels = requiredObject(config.Labels);
  const expectedDigest = input.image.reference.slice(input.image.reference.indexOf('@') + 1);
  const platform = `${String(image.Os)}/${String(image.Architecture)}`;
  const requiredLabels = {
    'org.brq.preview.helper-abi': input.policy.serverAbiVersion,
    'org.brq.preview.runtime-node': input.policy.runtime.version,
    'org.brq.preview.profile': 'node-web-preview-24-v1',
    ...input.image.requiredLabels,
  };
  if (
    image.Id !== input.image.expectedImageId ||
    !Array.isArray(image.RepoDigests) ||
    !image.RepoDigests.includes(input.image.reference) ||
    expectedDigest !== input.image.reference.split('@')[1] ||
    platform !== input.image.platform ||
    Object.entries(requiredLabels).some(([key, value]) => labels[key] !== value) ||
    config.Volumes != null ||
    config.ExposedPorts != null ||
    config.Entrypoint != null ||
    config.Cmd != null ||
    !exactArray(config.Env, ['PATH=/usr/local/bin:/usr/bin:/bin']) ||
    typeof client.Version !== 'string' ||
    typeof server.Version !== 'string'
  ) {
    throw new Error('IMAGE_IDENTITY_MISMATCH');
  }
  return Object.freeze({
    adapter: 'DOCKER',
    engineName: 'DOCKER',
    engineVersion: server.Version,
    imageReference: input.image.reference,
    imageDigest: expectedDigest,
    imageId: input.image.expectedImageId,
    platform,
    runtimeName: 'NODE',
    runtimeVersion: '24.19.0',
    serverAbiVersion: input.policy.serverAbiVersion,
  });
}

export function verifyPreviewNetwork(input: {
  readonly inspectionJson: string;
  readonly ownershipToken: string;
  readonly previewId: string;
  readonly executionId: string;
  readonly artifactId: string;
}): void {
  const inspection = requiredObject(JSON.parse(input.inspectionJson));
  const labels = requiredObject(inspection.Labels);
  const options = requiredObject(inspection.Options);
  if (
    inspection.Driver !== 'bridge' ||
    inspection.Internal !== true ||
    inspection.Attachable !== false ||
    labels['org.brq.preview.managed'] !== '1' ||
    labels['org.brq.preview.ownership'] !== input.ownershipToken ||
    labels['org.brq.preview.id'] !== input.previewId ||
    labels['org.brq.preview.execution'] !== input.executionId ||
    labels['org.brq.preview.artifact'] !== input.artifactId ||
    options['com.docker.network.bridge.enable_icc'] !== 'false'
  ) {
    throw new Error('NETWORK_ISOLATION_MISMATCH');
  }
}

export function verifyCreatedPreviewContainer(input: {
  readonly inspectionJson: string;
  readonly networkName: string;
  readonly ownershipToken: string;
  readonly previewId: string;
  readonly executionId: string;
  readonly artifactId: string;
  readonly limits: PreviewLimits;
}): void {
  const inspection = requiredObject(JSON.parse(input.inspectionJson));
  const config = requiredObject(inspection.Config);
  const host = requiredObject(inspection.HostConfig);
  const labels = requiredObject(config.Labels);
  const portBindings = host.PortBindings;
  const tmpfs = requiredObject(host.Tmpfs);
  const security = Array.isArray(host.SecurityOpt) ? host.SecurityOpt : [];
  const environment = Array.isArray(config.Env) ? config.Env : null;
  const ulimits = Array.isArray(host.Ulimits) ? host.Ulimits : [];
  const nofile = ulimits.find(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      (entry as { readonly Name?: unknown }).Name === 'nofile',
  );
  const nofileRecord = nofile === undefined ? {} : requiredObject(nofile);
  const expectedQuota = Math.max(1, Math.floor((input.limits.cpus * 1_000_000_000) / 10_000));
  if (
    config.User !== PREVIEW_CONTAINER_USER ||
    !exactArray(config.Entrypoint, [PREVIEW_IDLE_EXECUTABLE]) ||
    !exactArray(config.Cmd, ['--hold']) ||
    config.ExposedPorts != null ||
    !exactArray(environment, ['PATH=/usr/local/bin:/usr/bin:/bin']) ||
    labels['org.brq.preview.managed'] !== '1' ||
    labels['org.brq.preview.ownership'] !== input.ownershipToken ||
    labels['org.brq.preview.id'] !== input.previewId ||
    labels['org.brq.preview.execution'] !== input.executionId ||
    labels['org.brq.preview.artifact'] !== input.artifactId ||
    host.NetworkMode !== input.networkName ||
    host.IpcMode !== 'none' ||
    host.CgroupnsMode !== 'private' ||
    !['', 'private'].includes(String(host.PidMode ?? '')) ||
    !['', 'private'].includes(String(host.UTSMode ?? '')) ||
    host.ReadonlyRootfs !== true ||
    host.Privileged !== false ||
    (host.CapAdd !== null && host.CapAdd !== undefined && !exactArray(host.CapAdd, [])) ||
    !exactArray(host.CapDrop, ['ALL']) ||
    !security.includes('no-new-privileges=true') ||
    !security.includes('seccomp=builtin') ||
    host.PidsLimit !== input.limits.pidsLimit ||
    host.CpuPeriod !== 100_000 ||
    host.CpuQuota !== expectedQuota ||
    host.Memory !== input.limits.memoryBytes ||
    host.MemorySwap !== input.limits.memoryBytes ||
    ![0, null].includes(host.MemorySwappiness as number | null) ||
    host.OomKillDisable !== false ||
    host.RestartPolicy === null ||
    requiredObject(host.RestartPolicy).Name !== 'no' ||
    host.LogConfig === null ||
    requiredObject(host.LogConfig).Type !== 'none' ||
    host.Init !== true ||
    (host.Binds !== null && host.Binds !== undefined && !exactArray(host.Binds, [])) ||
    (host.Mounts !== null && host.Mounts !== undefined && !exactArray(host.Mounts, [])) ||
    (host.Devices !== null && host.Devices !== undefined && !exactArray(host.Devices, [])) ||
    (host.DeviceRequests !== null &&
      host.DeviceRequests !== undefined &&
      !exactArray(host.DeviceRequests, [])) ||
    !Array.isArray(inspection.Mounts) ||
    inspection.Mounts.length !== 0 ||
    nofileRecord.Soft !== input.limits.openFilesLimit ||
    nofileRecord.Hard !== input.limits.openFilesLimit ||
    typeof tmpfs['/preview'] !== 'string' ||
    !tmpfs['/preview'].includes('nosuid,nodev,noexec') ||
    (portBindings !== null &&
      portBindings !== undefined &&
      Object.keys(requiredObject(portBindings)).length !== 0)
  ) {
    throw new Error('CONTAINER_ISOLATION_MISMATCH');
  }
}

export function verifyRunningPreviewContainer(inspectionJson: string, networkName: string): void {
  const inspection = requiredObject(JSON.parse(inspectionJson));
  const state = requiredObject(inspection.State);
  const networkSettings = requiredObject(inspection.NetworkSettings);
  const networks = requiredObject(networkSettings.Networks);
  const ports = networkSettings.Ports;
  if (
    state.Running !== true ||
    !exactArray(Object.keys(networks), [networkName]) ||
    (ports !== null && ports !== undefined && Object.keys(requiredObject(ports)).length !== 0)
  ) {
    throw new Error('RUNNING_CONTAINER_ISOLATION_MISMATCH');
  }
}
