import { describe, expect, it } from 'vitest';

import {
  displayValue,
  formatDateTime,
  formatDuration,
  formatMetric,
  formatTimestamp,
  shortHash,
} from './factory-format';

describe('Factory presentation formatting', () => {
  it('formats durations without implying unavailable precision', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(42)).toBe('42 ms');
    expect(formatDuration(1_500)).toBe('1.5 s');
    expect(formatDuration(15_200)).toBe('15 s');
    expect(formatDuration(125_000)).toBe('2m 05s');
  });

  it('formats timestamps and rejects invalid observational values safely', () => {
    expect(formatTimestamp(null)).toBe('Not available');
    expect(formatTimestamp('invalid')).toBe('Not available');
    expect(formatTimestamp('2026-08-08T10:00:00.000Z')).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(formatDateTime(null)).toBe('Not available');
    expect(formatDateTime('invalid')).toBe('Not available');
    expect(formatDateTime('2026-08-08T10:00:00.000Z')).toContain('Aug');
  });

  it('shortens hashes and preserves nullable metrics honestly', () => {
    expect(displayValue(null)).toBe('Not available');
    expect(displayValue(0)).toBe('0');
    expect(shortHash(null)).toBe('—');
    expect(shortHash('abc')).toBe('abc');
    expect(shortHash(`sha256:${'a'.repeat(64)}`)).toBe(`${'a'.repeat(12)}…`);
    expect(formatMetric(null)).toBe('—');
    expect(formatMetric(1_200, ' B')).toBe('1,200 B');
  });
});
