export const DOCKER_SANDBOX_HELPER_ABI = 'brq.sandbox.workspace.v1';
export const DOCKER_SANDBOX_IDLE_EXECUTABLE = '/opt/brq/sandbox/idle';
export const DOCKER_SANDBOX_IDLE_ARGUMENT = '--hold';
export const DOCKER_SANDBOX_READY_EXECUTABLE = '/opt/brq/runner/ready.mjs';
export const DOCKER_SANDBOX_HELPER_LABEL = 'org.brq.sandbox.helper-abi';
export const DOCKER_SANDBOX_DEPENDENCY_LABEL = 'org.brq.sandbox.dependency-snapshot';
export const DOCKER_SANDBOX_NODE_LABEL = 'org.brq.sandbox.runtime-node';
export const DOCKER_SANDBOX_PATH = '/usr/local/bin:/usr/bin:/bin';

export interface DockerSandboxWorkspaceEnvelope {
  readonly abi: typeof DOCKER_SANDBOX_HELPER_ABI;
  readonly workspaceId: string;
  readonly workspaceHash: string;
  readonly totalBytes: number;
  readonly files: readonly {
    readonly path: string;
    readonly encoding: 'BASE64';
    readonly byteLength: number;
    readonly contentHash: string;
    readonly content: string;
  }[];
}
