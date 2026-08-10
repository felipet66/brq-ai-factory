import { describe, expect, it } from 'vitest';

import { resolveSandboxLimits } from './configuration';
import { SANDBOX_RUNNER_ERROR_CODES, SandboxRunnerError } from './errors';
import { DEFAULT_SANDBOX_LIMITS } from './limits';

describe('sandbox limits configuration', () => {
  it('returns the immutable host defaults', () => {
    const limits = resolveSandboxLimits();
    expect(limits).toEqual(DEFAULT_SANDBOX_LIMITS);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it('allows a request to reduce but never increase host ceilings', () => {
    expect(resolveSandboxLimits({ memoryBytes: 1024, cpus: 0.5 })).toMatchObject({
      memoryBytes: 1024,
      cpus: 0.5,
    });
    expect(() => resolveSandboxLimits({ cpus: 2 })).toThrowError(
      expect.objectContaining({ code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR }),
    );
    expect(() =>
      resolveSandboxLimits({}, { ...DEFAULT_SANDBOX_LIMITS, pidsLimit: 129 }),
    ).toThrowError(SandboxRunnerError);
  });

  it('rejects malformed and internally inconsistent output limits', () => {
    expect(() => resolveSandboxLimits({ totalTimeoutMs: 0 })).toThrowError(SandboxRunnerError);
    expect(() =>
      resolveSandboxLimits({ memoryBytes: DEFAULT_SANDBOX_LIMITS.memoryBytes }, {
        memoryBytes: 1024,
      } as typeof DEFAULT_SANDBOX_LIMITS),
    ).toThrowError(SandboxRunnerError);
    expect(() =>
      resolveSandboxLimits({
        capturedOutputBytesPerStream: 128,
        hardOutputBytesPerStep: 64,
      }),
    ).toThrowError(SandboxRunnerError);
  });
});
