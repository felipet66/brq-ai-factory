import { z } from 'zod';

import {
  DEFAULT_PREVIEW_LIMITS,
  PREVIEW_ABSOLUTE_LIMITS,
  type PreviewLimitReductions,
  type PreviewLimits,
} from './limits';

export const previewLimitReductionsSchema = z
  .object({
    ttlSeconds: z.number().int().min(60).max(PREVIEW_ABSOLUTE_LIMITS.ttlSeconds).optional(),
    responseBytes: z
      .number()
      .int()
      .positive()
      .max(PREVIEW_ABSOLUTE_LIMITS.responseBytes)
      .optional(),
    responseTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(PREVIEW_ABSOLUTE_LIMITS.responseTimeoutMs)
      .optional(),
  })
  .strict();

export const previewEffectiveLimitsSchema = z
  .object({
    ttlSeconds: z.number().int().min(60).max(PREVIEW_ABSOLUTE_LIMITS.ttlSeconds),
    startupTimeoutMs: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.startupTimeoutMs),
    healthTimeoutMs: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.healthTimeoutMs),
    stopTimeoutMs: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.stopTimeoutMs),
    cpus: z.number().positive().max(PREVIEW_ABSOLUTE_LIMITS.cpus),
    memoryBytes: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.memoryBytes),
    pidsLimit: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.pidsLimit),
    openFilesLimit: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.openFilesLimit),
    temporaryBytes: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.temporaryBytes),
    artifactBytes: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.artifactBytes),
    artifactFiles: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.artifactFiles),
    responseBytes: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.responseBytes),
    responseTimeoutMs: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.responseTimeoutMs),
    capturedLogBytes: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.capturedLogBytes),
    maxLogLineBytes: z.number().int().positive().max(PREVIEW_ABSOLUTE_LIMITS.maxLogLineBytes),
  })
  .strict();

export function resolvePreviewLimits(
  policyLimits: PreviewLimits,
  reductions: PreviewLimitReductions | undefined,
): PreviewLimits {
  const policy = previewEffectiveLimitsSchema.parse(policyLimits);
  const parsed = previewLimitReductionsSchema.parse(reductions ?? {});
  const effective = {
    ...policy,
    ...(parsed.ttlSeconds === undefined
      ? {}
      : { ttlSeconds: Math.min(policy.ttlSeconds, parsed.ttlSeconds) }),
    ...(parsed.responseBytes === undefined
      ? {}
      : { responseBytes: Math.min(policy.responseBytes, parsed.responseBytes) }),
    ...(parsed.responseTimeoutMs === undefined
      ? {}
      : { responseTimeoutMs: Math.min(policy.responseTimeoutMs, parsed.responseTimeoutMs) }),
  };
  return Object.freeze(previewEffectiveLimitsSchema.parse(effective));
}

export function defaultPreviewLimits(): PreviewLimits {
  return Object.freeze({ ...DEFAULT_PREVIEW_LIMITS });
}
