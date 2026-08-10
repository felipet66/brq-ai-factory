import type { SandboxExecutionPolicy } from '../policies';

export const DOCKER_SANDBOX_ARTIFACT_EXPORT_ABI_VERSION = '1.0.0' as const;
export const DOCKER_SANDBOX_ARTIFACT_EXPORT_EXECUTABLE = '/opt/brq/runner/export.mjs' as const;

export type DockerSandboxArtifactUnavailableCode =
  | 'EXPORT_CANCELLED'
  | 'EXPORT_EXECUTION_FAILED'
  | 'EXPORT_INVALID_OUTPUT'
  | 'EXPORT_OUTPUT_LIMIT'
  | 'EXPORT_TIMEOUT'
  | 'SINK_REJECTED';

export interface DockerSandboxArtifactCorrelation {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly workspaceHash: string;
  readonly policyId: SandboxExecutionPolicy['policyId'];
  readonly sandboxRequestHash: string;
}

export interface DockerSandboxCapturedArtifact extends DockerSandboxArtifactCorrelation {
  /** Private canonical payload. It must never enter SandboxResult, logs or persistence metadata. */
  readonly envelope: string;
}

export interface DockerSandboxUnavailableArtifact extends DockerSandboxArtifactCorrelation {
  readonly code: DockerSandboxArtifactUnavailableCode;
}

/**
 * Opt-in bridge used by a host-owned preview artifact adapter. The regular Sandbox Runner never
 * installs it and therefore never invokes an artifact helper.
 */
export interface DockerSandboxArtifactSink {
  captured(input: DockerSandboxCapturedArtifact): void | Promise<void>;
  unavailable(input: DockerSandboxUnavailableArtifact): void | Promise<void>;
}
