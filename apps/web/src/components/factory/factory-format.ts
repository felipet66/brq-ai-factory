export function displayValue(value: string | number | null): string {
  return value === null ? 'Not available' : String(value);
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1_000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatTimestamp(timestamp: string | null): string {
  if (timestamp === null) return 'Not available';
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
}

export function formatDateTime(timestamp: string | null): string {
  if (timestamp === null) return 'Not available';
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
}

export function shortHash(hash: string | null, visible = 12): string {
  if (hash === null) return '—';
  const normalized = hash.startsWith('sha256:') ? hash.slice(7) : hash;
  return normalized.length <= visible ? normalized : `${normalized.slice(0, visible)}…`;
}

export function formatMetric(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${new Intl.NumberFormat('en-US').format(value)}${suffix}`;
}
