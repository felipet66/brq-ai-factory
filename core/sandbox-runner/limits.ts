export interface SandboxLimits {
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly pidsLimit: number;
  readonly openFilesLimit: number;
  readonly workspaceBytes: number;
  readonly workspaceInodes: number;
  readonly temporaryBytes: number;
  readonly temporaryInodes: number;
  readonly totalTimeoutMs: number;
  readonly prepareTimeoutMs: number;
  readonly typecheckTimeoutMs: number;
  readonly buildTimeoutMs: number;
  readonly testTimeoutMs: number;
  readonly administrativeTimeoutMs: number;
  readonly capturedOutputBytesPerStream: number;
  readonly hardOutputBytesPerStep: number;
  readonly maxOutputLinesPerStream: number;
  readonly maxOutputLineBytes: number;
}

export const SANDBOX_ABSOLUTE_LIMITS: SandboxLimits = Object.freeze({
  cpus: 1,
  memoryBytes: 2 * 1024 * 1024 * 1024,
  pidsLimit: 128,
  openFilesLimit: 1_024,
  workspaceBytes: 512 * 1024 * 1024,
  workspaceInodes: 32_768,
  temporaryBytes: 128 * 1024 * 1024,
  temporaryInodes: 16_384,
  totalTimeoutMs: 300_000,
  prepareTimeoutMs: 30_000,
  typecheckTimeoutMs: 90_000,
  buildTimeoutMs: 120_000,
  testTimeoutMs: 90_000,
  administrativeTimeoutMs: 15_000,
  capturedOutputBytesPerStream: 256 * 1024,
  hardOutputBytesPerStep: 4 * 1024 * 1024,
  maxOutputLinesPerStream: 2_000,
  maxOutputLineBytes: 8 * 1024,
});

export const DEFAULT_SANDBOX_LIMITS = SANDBOX_ABSOLUTE_LIMITS;
