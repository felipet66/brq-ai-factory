import { describe, expect, it } from 'vitest';

import { safePublicTypeScriptDiagnosticSummary } from './typescript-diagnostic-contracts';

describe('safePublicTypeScriptDiagnosticSummary', () => {
  it('preserves only a bounded canonical diagnostic summary', () => {
    expect(
      safePublicTypeScriptDiagnosticSummary({
        diagnosticCount: 3,
        diagnosticCodes: [2307, 2322],
        truncated: false,
      }),
    ).toEqual({
      diagnosticCount: 3,
      diagnosticCodes: [2307, 2322],
      truncated: false,
    });
  });

  it.each([
    {
      diagnosticCount: 1,
      diagnosticCodes: [],
      truncated: false,
    },
    {
      diagnosticCount: 1,
      diagnosticCodes: [2307, 2322],
      truncated: false,
    },
    {
      diagnosticCount: 2,
      diagnosticCodes: [2322, 2307],
      truncated: false,
    },
    {
      diagnosticCount: 2,
      diagnosticCodes: [2307, 2307],
      truncated: false,
    },
    {
      diagnosticCount: 1,
      diagnosticCodes: [2307],
      truncated: false,
      path: '/private/workspace/src/index.ts',
    },
  ])('fails closed for an invalid or expanded public shape', (value) => {
    expect(safePublicTypeScriptDiagnosticSummary(value)).toBeNull();
  });
});
