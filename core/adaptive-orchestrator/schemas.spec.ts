import { describe, expect, it } from 'vitest';

import {
  adaptiveExecutionRequestSchema,
  safeVerifierDiagnosticSchema,
  verifierPortResultSchema,
} from './schemas';
import { createAdaptiveRequestFixture, infraFailureFixture } from './testing/fixtures';

describe('adaptive orchestrator schemas', () => {
  it('accepts its strict public request and rejects unknown fields', () => {
    const request = createAdaptiveRequestFixture();
    expect(adaptiveExecutionRequestSchema.safeParse(request).success).toBe(true);
    expect(
      adaptiveExecutionRequestSchema.safeParse({ ...request, systemPrompt: 'do not expose' })
        .success,
    ).toBe(false);
  });

  it('allows only enumerated diagnostics without arbitrary content', () => {
    const diagnostic = infraFailureFixture().diagnostic;
    expect(safeVerifierDiagnosticSchema.safeParse(diagnostic).success).toBe(true);
    expect(
      safeVerifierDiagnosticSchema.safeParse({
        ...diagnostic,
        message: 'command output with a secret',
      }).success,
    ).toBe(false);
    expect(
      verifierPortResultSchema.safeParse({
        ...infraFailureFixture(),
        output: 'docker command output',
      }).success,
    ).toBe(false);
  });
});
