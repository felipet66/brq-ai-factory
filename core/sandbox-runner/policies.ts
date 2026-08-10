import { z } from 'zod';

import {
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  SandboxRunnerError,
} from './errors';
import { immutableClone } from './immutability';
import { SANDBOX_ABSOLUTE_LIMITS } from './limits';

const SAFE_REQUIRED_FILE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,512}$/u;
const ABSOLUTE_EXECUTABLE = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/u;
const DISALLOWED_COMMAND_CONTROL = /[\u0000-\u001F\u007F]/u;

export const sandboxPackageManagerSchema = z.enum(['NONE', 'NPM']);

export const sandboxCommandPolicySchema = z
  .object({
    executable: z.string().regex(ABSOLUTE_EXECUTABLE),
    args: z
      .array(
        z
          .string()
          .max(512)
          .refine((value) => !DISALLOWED_COMMAND_CONTROL.test(value)),
      )
      .max(64),
    workingDirectory: z.literal('/workspace/project'),
    environment: z
      .object({
        CI: z.literal('1').optional(),
        NO_COLOR: z.literal('1').optional(),
        HOME: z.literal('/tmp/home').optional(),
        TMPDIR: z.literal('/tmp').optional(),
        NODE_OPTIONS: z.literal('--max-old-space-size=1536').optional(),
      })
      .strict(),
    requiredFiles: z.array(z.string().regex(SAFE_REQUIRED_FILE)).max(32),
    timeoutMs: z.number().int().positive().max(SANDBOX_ABSOLUTE_LIMITS.totalTimeoutMs),
  })
  .strict();

export const sandboxExecutionPolicySchema = z
  .object({
    policyId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
    version: z.string().regex(SEMANTIC_VERSION),
    packageManager: sandboxPackageManagerSchema,
    runtime: z
      .object({
        name: z.literal('NODE'),
        version: z.string().trim().min(1).max(64),
      })
      .strict(),
    helperAbiVersion: z.string().regex(SEMANTIC_VERSION),
    dependencySnapshotHash: z.string().regex(HASH).nullable(),
    steps: z
      .object({
        PREPARE: sandboxCommandPolicySchema,
        TYPECHECK: sandboxCommandPolicySchema,
        BUILD: sandboxCommandPolicySchema,
        TEST: sandboxCommandPolicySchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.packageManager === 'NPM' && policy.dependencySnapshotHash === null) {
      context.addIssue({
        code: 'custom',
        path: ['dependencySnapshotHash'],
        message: 'Uma policy NPM exige dependency snapshot pinado.',
      });
    }
    const ceilings = {
      PREPARE: SANDBOX_ABSOLUTE_LIMITS.prepareTimeoutMs,
      TYPECHECK: SANDBOX_ABSOLUTE_LIMITS.typecheckTimeoutMs,
      BUILD: SANDBOX_ABSOLUTE_LIMITS.buildTimeoutMs,
      TEST: SANDBOX_ABSOLUTE_LIMITS.testTimeoutMs,
    } as const;
    for (const step of Object.keys(ceilings) as (keyof typeof ceilings)[]) {
      if (policy.steps[step].timeoutMs > ceilings[step]) {
        context.addIssue({
          code: 'custom',
          path: ['steps', step, 'timeoutMs'],
          message: 'O timeout da command policy excede o teto da etapa.',
        });
      }
    }
  });

type DeepReadonlyPolicy<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonlyPolicy<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonlyPolicy<T[Key]> }
      : T;

export type SandboxPackageManager = z.infer<typeof sandboxPackageManagerSchema>;
export type SandboxCommandPolicy = DeepReadonlyPolicy<z.infer<typeof sandboxCommandPolicySchema>>;
export type SandboxExecutionPolicy = DeepReadonlyPolicy<
  z.infer<typeof sandboxExecutionPolicySchema>
>;
export type SandboxPolicyRegistry = readonly SandboxExecutionPolicy[];

export function resolveSandboxPolicy(
  registry: SandboxPolicyRegistry,
  policyId: string,
): SandboxExecutionPolicy {
  const parsedPolicies = z.array(sandboxExecutionPolicySchema).min(1).safeParse(registry);
  if (!parsedPolicies.success) {
    throw new SandboxRunnerError('O registry de policies da sandbox é inválido.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
      stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  const identifiers = parsedPolicies.data.map((policy) => policy.policyId);
  if (new Set(identifiers).size !== identifiers.length) {
    throw new SandboxRunnerError('O registry contém policyIds duplicados.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
      stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  const resolved = parsedPolicies.data.find((policy) => policy.policyId === policyId);
  if (resolved === undefined) {
    throw new SandboxRunnerError('A policy solicitada não está registrada.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
      stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  return immutableClone(resolved);
}
