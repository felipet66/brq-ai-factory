export interface PreviewLimits {
  readonly ttlSeconds: number;
  readonly startupTimeoutMs: number;
  readonly healthTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly pidsLimit: number;
  readonly openFilesLimit: number;
  readonly temporaryBytes: number;
  readonly artifactBytes: number;
  readonly artifactFiles: number;
  readonly responseBytes: number;
  readonly responseTimeoutMs: number;
  readonly capturedLogBytes: number;
  readonly maxLogLineBytes: number;
}

export const PREVIEW_ABSOLUTE_LIMITS: PreviewLimits = Object.freeze({
  ttlSeconds: 15 * 60,
  startupTimeoutMs: 30_000,
  healthTimeoutMs: 5_000,
  stopTimeoutMs: 10_000,
  cpus: 0.5,
  memoryBytes: 256 * 1024 * 1024,
  pidsLimit: 32,
  openFilesLimit: 256,
  temporaryBytes: 16 * 1024 * 1024,
  artifactBytes: 1024 * 1024,
  artifactFiles: 128,
  responseBytes: 512 * 1024,
  responseTimeoutMs: 5_000,
  capturedLogBytes: 128 * 1024,
  maxLogLineBytes: 8 * 1024,
});

export const DEFAULT_PREVIEW_LIMITS: PreviewLimits = Object.freeze({
  ...PREVIEW_ABSOLUTE_LIMITS,
  ttlSeconds: 10 * 60,
});

export interface PreviewLimitReductions {
  readonly ttlSeconds?: number;
  readonly responseBytes?: number;
  readonly responseTimeoutMs?: number;
}
