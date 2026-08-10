import { describe, expect, it } from 'vitest';

import { sanitizeSandboxOutput } from './output-sanitizer';

const options = {
  maxBytes: 256,
  maxLines: 10,
  maxLineBytes: 64,
  sensitiveValues: ['known-sensitive-value'],
  hostPaths: ['/Users/example/private/workspace'],
} as const;

describe('sandbox output sanitizer', () => {
  it('redacts credentials, PEM blocks, host paths and configured secret values', () => {
    const output = sanitizeSandboxOutput(
      [
        'Bearer bearer-value',
        'sk-proj-abcdefghijklmnop',
        'npm_abcdefghijklmnop',
        'https://user:password@example.test/path',
        'known-sensitive-value',
        '/Users/example/private/workspace/src/index.ts',
        '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
      ].join('\n'),
      options,
    );
    expect(output.summary).not.toMatch(/bearer-value|abcdefghijklmnop|password|private-material/u);
    expect(output.summary).not.toContain('/Users/example/private/workspace');
    expect(output.summary).toContain('[REDACTED]');
  });

  it('normalizes line endings and strips terminal/control sequences', () => {
    const output = sanitizeSandboxOutput('\u001B[31mred\u001B[0m\r\nnext\u0000', options);
    expect(output.summary).toBe('red\nnext');
    expect(output.observedBytes).toBeGreaterThan(output.summary.length);
  });

  it('strips residual ESC and C1 controls from malformed or incomplete terminal sequences', () => {
    const output = sanitizeSandboxOutput(
      [
        'isolated\u001Bcontrol',
        'incomplete-csi\u001B[31',
        'incomplete-osc\u001B]8;;https://example.test',
        'c1-csi\u009B31mred',
        'c1-osc\u009Dpayload',
      ].join('\n'),
      options,
    );

    expect(output.summary).not.toMatch(/[\u001B\u0080-\u009F]/u);
    expect(output.summary).toContain('isolatedcontrol');
    expect(output.summary).toContain('incomplete-csi[31');
    expect(output.summary).toContain('incomplete-osc]8;;https://example.test');
    expect(output.summary).toContain('c1-csi31mred');
    expect(output.summary).toContain('c1-oscpayload');
  });

  it('enforces line and byte limits without splitting UTF-8 sequences', () => {
    const output = sanitizeSandboxOutput('á'.repeat(100) + '\nsecond\nthird', {
      ...options,
      maxBytes: 31,
      maxLines: 2,
      maxLineBytes: 30,
    });
    expect(Buffer.byteLength(output.summary, 'utf8')).toBeLessThanOrEqual(31);
    expect(output.summary).not.toContain('\uFFFD');
    expect(output.truncated).toBe(true);
    expect(output.observedLines).toBe(3);
    expect(output.summary).toContain('third');
  });

  it('produces deterministic summary hashes', () => {
    expect(sanitizeSandboxOutput('same', options).summaryHash).toBe(
      sanitizeSandboxOutput('same', options).summaryHash,
    );
    expect(sanitizeSandboxOutput('same', options).summaryHash).not.toBe(
      sanitizeSandboxOutput('different', options).summaryHash,
    );
  });
});
