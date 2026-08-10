import { Buffer } from 'node:buffer';

import { CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS } from '@brq/controlled-workspace';

import {
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  SandboxRunnerError,
} from '../errors';
import { DOCKER_SANDBOX_HELPER_ABI, type DockerSandboxWorkspaceEnvelope } from './helper-contract';
import type { VerifiedWorkspace } from './workspace-reader';

export const SANDBOX_MAX_PAYLOAD_BYTES =
  Math.ceil((CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxBundleBytes * 4) / 3) + 128 * 1024;

export function createWorkspacePayload(workspace: VerifiedWorkspace): Buffer {
  const payload = Buffer.from(
    `${JSON.stringify({
      abi: DOCKER_SANDBOX_HELPER_ABI,
      workspaceId: workspace.workspaceId,
      workspaceHash: workspace.workspaceHash,
      totalBytes: workspace.totalBytes,
      files: workspace.files.map((file) => ({
        path: file.path,
        encoding: 'BASE64',
        byteLength: file.byteLength,
        contentHash: file.contentHash,
        content: file.content.toString('base64'),
      })),
    } satisfies DockerSandboxWorkspaceEnvelope)}\n`,
    'utf8',
  );
  if (payload.byteLength > SANDBOX_MAX_PAYLOAD_BYTES) {
    throw new SandboxRunnerError('O envelope do workspace excede o limite da ABI da sandbox.', {
      code: SANDBOX_RUNNER_ERROR_CODES.INTEGRITY_MISMATCH,
      stage: SANDBOX_RUNNER_ERROR_STAGES.INTEGRITY,
      sourceCode: 'WORKSPACE_PAYLOAD_LIMIT',
    });
  }
  return payload;
}
