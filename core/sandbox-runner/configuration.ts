import { z } from 'zod';

import {
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  SandboxRunnerError,
} from './errors';
import { DEFAULT_SANDBOX_LIMITS, type SandboxLimits, SANDBOX_ABSOLUTE_LIMITS } from './limits';

const positiveInteger = z.number().int().positive();

export const sandboxLimitReductionsSchema = z
  .object({
    cpus: z.number().positive().optional(),
    memoryBytes: positiveInteger.optional(),
    pidsLimit: positiveInteger.optional(),
    openFilesLimit: positiveInteger.optional(),
    workspaceBytes: positiveInteger.optional(),
    workspaceInodes: positiveInteger.optional(),
    temporaryBytes: positiveInteger.optional(),
    temporaryInodes: positiveInteger.optional(),
    totalTimeoutMs: positiveInteger.optional(),
    prepareTimeoutMs: positiveInteger.optional(),
    typecheckTimeoutMs: positiveInteger.optional(),
    buildTimeoutMs: positiveInteger.optional(),
    testTimeoutMs: positiveInteger.optional(),
    administrativeTimeoutMs: positiveInteger.optional(),
    capturedOutputBytesPerStream: positiveInteger.optional(),
    hardOutputBytesPerStep: positiveInteger.optional(),
    maxOutputLinesPerStream: positiveInteger.optional(),
    maxOutputLineBytes: positiveInteger.optional(),
  })
  .strict();

export type SandboxLimitReductions = z.input<typeof sandboxLimitReductionsSchema>;

export function resolveSandboxLimits(
  input: SandboxLimitReductions = {},
  ceiling: SandboxLimits = DEFAULT_SANDBOX_LIMITS,
): SandboxLimits {
  const parsedInput = sandboxLimitReductionsSchema.safeParse(input);
  const parsedCeiling = sandboxLimitReductionsSchema.safeParse(ceiling);
  const keys = Object.keys(SANDBOX_ABSOLUTE_LIMITS) as (keyof SandboxLimits)[];
  if (
    !parsedInput.success ||
    !parsedCeiling.success ||
    keys.some((key) => typeof ceiling[key] !== 'number')
  ) {
    throw new SandboxRunnerError('A configuração de limites da sandbox é inválida.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
      stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }

  const resolved = Object.fromEntries(
    keys.map((key) => [key, parsedInput.data[key] ?? ceiling[key]]),
  ) as unknown as SandboxLimits;

  for (const key of Object.keys(resolved) as (keyof SandboxLimits)[]) {
    if (ceiling[key] > SANDBOX_ABSOLUTE_LIMITS[key] || resolved[key] > ceiling[key]) {
      throw new SandboxRunnerError('Os limites solicitados não podem ampliar o teto do host.', {
        code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
        stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
      });
    }
  }
  if (resolved.capturedOutputBytesPerStream > resolved.hardOutputBytesPerStep) {
    throw new SandboxRunnerError('A captura não pode exceder o hard limit de output.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
      stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  return Object.freeze(resolved);
}
