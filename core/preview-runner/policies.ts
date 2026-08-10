import { z } from 'zod';

import { previewEffectiveLimitsSchema } from './configuration';
import {
  PREVIEW_RUNNER_ERROR_CODES,
  PREVIEW_RUNNER_ERROR_STAGES,
  PreviewRunnerError,
} from './errors';
import { immutableClone } from './immutability';
import { DEFAULT_PREVIEW_LIMITS } from './limits';

const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/u;

export const previewPolicySchema = z
  .object({
    policyId: z.literal('NODE_WEB_PREVIEW_24_V1'),
    version: z.string().regex(SEMANTIC_VERSION),
    artifactProfileId: z.literal('NODE_WEB_PREVIEW_24_V1'),
    serverAbiVersion: z.string().regex(SEMANTIC_VERSION),
    runtime: z
      .object({
        name: z.literal('NODE'),
        version: z.literal('24.19.0'),
      })
      .strict(),
    protocol: z
      .object({
        internalPort: z.literal(8080),
        healthPath: z.literal('/__brq/health'),
        healthExpectedBody: z.literal('BRQ_PREVIEW_HEALTHY'),
        methods: z.tuple([z.literal('GET'), z.literal('HEAD')]),
      })
      .strict(),
    isolation: z
      .object({
        network: z.literal('ISOLATED_NO_EGRESS'),
        rootFilesystem: z.literal('READ_ONLY'),
        runAsNonRoot: z.literal(true),
        noNewPrivileges: z.literal(true),
        hostMounts: z.literal(false),
        dockerSocket: z.literal(false),
        privileged: z.literal(false),
      })
      .strict(),
    limits: previewEffectiveLimitsSchema,
  })
  .strict();

type DeepReadonlyPolicy<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonlyPolicy<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonlyPolicy<T[Key]> }
      : T;

export type PreviewPolicy = DeepReadonlyPolicy<z.infer<typeof previewPolicySchema>>;
export type PreviewPolicyRegistry = readonly PreviewPolicy[];

export const NODE_WEB_PREVIEW_24_V1_POLICY: PreviewPolicy = immutableClone(
  previewPolicySchema.parse({
    policyId: 'NODE_WEB_PREVIEW_24_V1',
    version: '1.0.0',
    artifactProfileId: 'NODE_WEB_PREVIEW_24_V1',
    serverAbiVersion: '1.0.0',
    runtime: { name: 'NODE', version: '24.19.0' },
    protocol: {
      internalPort: 8080,
      healthPath: '/__brq/health',
      healthExpectedBody: 'BRQ_PREVIEW_HEALTHY',
      methods: ['GET', 'HEAD'],
    },
    isolation: {
      network: 'ISOLATED_NO_EGRESS',
      rootFilesystem: 'READ_ONLY',
      runAsNonRoot: true,
      noNewPrivileges: true,
      hostMounts: false,
      dockerSocket: false,
      privileged: false,
    },
    limits: DEFAULT_PREVIEW_LIMITS,
  }),
);

export function resolvePreviewPolicy(
  registry: PreviewPolicyRegistry,
  policyId: string,
): PreviewPolicy {
  const parsed = z.array(previewPolicySchema).min(1).safeParse(registry);
  if (!parsed.success) {
    throw new PreviewRunnerError('O registry de Preview policies é inválido.', {
      code: PREVIEW_RUNNER_ERROR_CODES.CONFIGURATION_INVALID,
      stage: PREVIEW_RUNNER_ERROR_STAGES.CONFIGURATION,
      cause: parsed.error,
    });
  }
  if (new Set(parsed.data.map((policy) => policy.policyId)).size !== parsed.data.length) {
    throw new PreviewRunnerError('O registry contém policyIds duplicados.', {
      code: PREVIEW_RUNNER_ERROR_CODES.CONFIGURATION_INVALID,
      stage: PREVIEW_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  const policy = parsed.data.find((candidate) => candidate.policyId === policyId);
  if (policy === undefined) {
    throw new PreviewRunnerError('A Preview policy solicitada não está registrada.', {
      code: PREVIEW_RUNNER_ERROR_CODES.POLICY_MISMATCH,
      stage: PREVIEW_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  return immutableClone(policy);
}
