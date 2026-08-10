export const PREVIEW_SESSION_STATUSES = [
  'CREATED',
  'STARTING',
  'RUNNING',
  'STOPPING',
  'STOPPED',
  'EXPIRED',
  'FAILED',
] as const;

export const PREVIEW_TERMINAL_STATUSES = ['STOPPED', 'EXPIRED', 'FAILED'] as const;
export const PREVIEW_HEALTH_STATUSES = [
  'PENDING',
  'HEALTHY',
  'UNHEALTHY',
  'NOT_APPLICABLE',
] as const;
export const PREVIEW_STOP_REASONS = [
  'MANUAL',
  'EXPIRATION',
  'CANCELLATION',
  'RECONCILIATION',
] as const;
export const PREVIEW_OBSERVABILITY_EVENTS = [
  'preview.requested',
  'preview.starting',
  'preview.running',
  'preview.failed',
  'preview.stopping',
  'preview.stopped',
  'preview.expired',
] as const;

export type PreviewSessionStatus = (typeof PREVIEW_SESSION_STATUSES)[number];
export type PreviewHealthStatus = (typeof PREVIEW_HEALTH_STATUSES)[number];
export type PreviewStopReason = (typeof PREVIEW_STOP_REASONS)[number];
export type PreviewObservabilityEventName = (typeof PREVIEW_OBSERVABILITY_EVENTS)[number];

const TRANSITIONS: Readonly<Record<PreviewSessionStatus, readonly PreviewSessionStatus[]>> =
  Object.freeze({
    CREATED: ['STARTING', 'STOPPING', 'FAILED'],
    STARTING: ['RUNNING', 'STOPPING', 'FAILED'],
    RUNNING: ['STOPPING', 'FAILED'],
    STOPPING: ['STOPPED', 'EXPIRED', 'FAILED'],
    STOPPED: [],
    EXPIRED: [],
    FAILED: [],
  });

export function canTransitionPreviewSession(
  from: PreviewSessionStatus,
  to: PreviewSessionStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isPreviewTerminalStatus(status: PreviewSessionStatus): boolean {
  return (PREVIEW_TERMINAL_STATUSES as readonly PreviewSessionStatus[]).includes(status);
}
