import {
  NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
  projectSandboxExecutionProfileSnapshot,
} from '@brq/factory-execution-profile';

import type { SandboxStepId } from './lifecycle';

const MAX_MARKER_CHARACTERS = 128;
const ACTIVE_SNAPSHOTS = Object.freeze({
  NODE_WEB_PREVIEW_24_V1: projectSandboxExecutionProfileSnapshot(
    NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
  ),
});

export function extractSandboxHelperReasonCode(input: {
  readonly policyId: string;
  readonly stepId: SandboxStepId;
  readonly stderr: string;
}): string | null {
  const snapshot = ACTIVE_SNAPSHOTS[input.policyId as keyof typeof ACTIVE_SNAPSHOTS];
  if (snapshot === undefined) return null;
  const lastLine = input.stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
  if (lastLine === undefined || lastLine.length > MAX_MARKER_CHARACTERS) return null;
  const match = lastLine.match(/^BRQ_([A-Z]+)_FAILED code=([A-Z][A-Z0-9_]{1,63})$/u);
  if (match?.[1] !== input.stepId || match[2] === undefined) return null;
  const allowlist = snapshot.publicReasonCodes[input.stepId];
  return allowlist.includes(match[2]) ? match[2] : null;
}
