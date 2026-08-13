import {
  NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
  projectSandboxExecutionProfileSnapshot,
} from '@brq/factory-execution-profile';

import type { SandboxStepId } from './lifecycle';
import type { SandboxDiagnosticSummary } from './contracts';
import {
  SANDBOX_TYPESCRIPT_DIAGNOSTIC_CODE_LIMIT,
  SANDBOX_TYPESCRIPT_DIAGNOSTIC_CODE_MAX,
  SANDBOX_TYPESCRIPT_DIAGNOSTIC_COUNT_LIMIT,
  sandboxDiagnosticSummarySchema,
} from './schemas';

const MAX_MARKER_CHARACTERS = 128;
const MAX_DIAGNOSTIC_MARKER_CHARACTERS = 256;
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

export function extractSandboxHelperDiagnosticSummary(input: {
  readonly policyId: string;
  readonly stepId: SandboxStepId;
  readonly stderr: string;
}): SandboxDiagnosticSummary | null {
  if (
    input.stepId !== 'TYPECHECK' ||
    extractSandboxHelperReasonCode(input) !== 'TYPESCRIPT_DIAGNOSTICS'
  ) {
    return null;
  }
  const lines = input.stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const summaryLine = lines.at(-2);
  if (summaryLine === undefined || summaryLine.length > MAX_DIAGNOSTIC_MARKER_CHARACTERS) {
    return null;
  }
  const match = summaryLine.match(
    /^BRQ_([A-Z]+)_DIAGNOSTICS count=([1-9][0-9]{0,4}) codes=([1-9][0-9]{0,4}(?:,[1-9][0-9]{0,4}){0,31}) truncated=(true|false)$/u,
  );
  if (match?.[1] !== input.stepId || match[2] === undefined || match[3] === undefined) {
    return null;
  }
  const diagnosticCount = Number(match[2]);
  const diagnosticCodes = match[3].split(',').map((code) => Number(code));
  if (
    diagnosticCount > SANDBOX_TYPESCRIPT_DIAGNOSTIC_COUNT_LIMIT ||
    diagnosticCodes.length > SANDBOX_TYPESCRIPT_DIAGNOSTIC_CODE_LIMIT ||
    diagnosticCodes.some((code) => code > SANDBOX_TYPESCRIPT_DIAGNOSTIC_CODE_MAX)
  ) {
    return null;
  }
  const parsed = sandboxDiagnosticSummarySchema.safeParse({
    diagnosticCount,
    diagnosticCodes,
    truncated: match[4] === 'true',
  });
  return parsed.success ? Object.freeze(parsed.data) : null;
}
