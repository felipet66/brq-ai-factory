export const SANDBOX_STEP_IDS = ['PREPARE', 'TYPECHECK', 'BUILD', 'TEST'] as const;
export const SANDBOX_INTERNAL_STATUSES = ['PENDING', 'RUNNING'] as const;
export const SANDBOX_TERMINAL_STATUSES = ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'] as const;
export const SANDBOX_STEP_TERMINAL_STATUSES = [...SANDBOX_TERMINAL_STATUSES, 'SKIPPED'] as const;

export type SandboxStepId = (typeof SANDBOX_STEP_IDS)[number];
export type SandboxInternalStatus = (typeof SANDBOX_INTERNAL_STATUSES)[number];
export type SandboxTerminalStatus = (typeof SANDBOX_TERMINAL_STATUSES)[number];
export type SandboxStepTerminalStatus = (typeof SANDBOX_STEP_TERMINAL_STATUSES)[number];

export function subsequentSandboxSteps(stepId: SandboxStepId): readonly SandboxStepId[] {
  const index = SANDBOX_STEP_IDS.indexOf(stepId);
  return SANDBOX_STEP_IDS.slice(index + 1);
}
