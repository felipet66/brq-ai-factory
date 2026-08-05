import { canonicalizeJson } from '@brq/prompt-builder';
import { describe, expect, it } from 'vitest';

import { aiRequestByteLength, canonicalByteLength, elapsed, observedMetrics } from './metrics';

describe('Agent Runner metrics', () => {
  it('measures canonical logical payload bytes instead of transport bytes', () => {
    const request = {
      model: 'model',
      instructions: 'ação',
      input: 'entrada',
      responseFormat: { type: 'text' as const },
    };

    expect(aiRequestByteLength(request)).toBe(Buffer.byteLength(canonicalizeJson(request), 'utf8'));
    expect(canonicalByteLength({ z: 1, a: 2 })).toBe(Buffer.byteLength('{"a":2,"z":1}', 'utf8'));
  });

  it('uses a monotonic injected clock and clamps negative durations', () => {
    expect(elapsed(() => 15.6, 10)).toBe(6);
    expect(elapsed(() => 5, 10)).toBe(0);
  });

  it('keeps observed metrics independent from provider reports', () => {
    expect(
      observedMetrics({
        totalDurationMs: 30,
        promptBuilderDurationMs: 10,
        providerDurationMs: 15,
        bytesSent: 100,
        bytesReceived: 50,
      }),
    ).toEqual({
      totalDurationMs: 30,
      promptBuilderDurationMs: 10,
      providerDurationMs: 15,
      bytesSent: 100,
      bytesReceived: 50,
    });
  });
});
