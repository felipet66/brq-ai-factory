import { z } from 'zod';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export const previewIdSchema = z.string().regex(/^preview-[a-f0-9]{32}$/u);
export const previewStatusSchema = z.enum([
  'CREATED',
  'STARTING',
  'RUNNING',
  'STOPPING',
  'STOPPED',
  'EXPIRED',
  'FAILED',
]);
export const previewHealthSchema = z.enum(['PENDING', 'HEALTHY', 'UNHEALTHY', 'NOT_APPLICABLE']);
export const previewEligibilityStatusSchema = z.enum([
  'ELIGIBLE',
  'FACTORY_RESULT_MISSING',
  'FACTORY_NOT_SUCCESS',
  'ARTIFACT_UNAVAILABLE',
  'PROFILE_UNSUPPORTED',
]);

const semanticVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  );
const executionIdSchema = z.string().regex(/^execution-[a-f0-9]{32}$/u);
const hashSchema = z.string().regex(HASH_PATTERN);
const nullableDateTimeSchema = z.string().datetime({ offset: true }).nullable();

export const previewSessionViewSchema = z
  .object({
    previewId: previewIdSchema,
    executionId: executionIdSchema,
    status: previewStatusSchema,
    health: previewHealthSchema,
    createdAt: z.string().datetime({ offset: true }),
    startedAt: nullableDateTimeSchema,
    expiresAt: z.string().datetime({ offset: true }),
    stoppedAt: nullableDateTimeSchema,
    policy: z
      .object({ id: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u), version: semanticVersionSchema })
      .strict(),
    hashes: z
      .object({
        factoryResultHash: hashSchema,
        artifactHash: hashSchema,
        previewRequestHash: hashSchema,
        previewSessionHash: hashSchema,
      })
      .strict(),
    controlPath: z.string().regex(/^\/executions\/execution-[a-f0-9]{32}\/preview$/u),
    failure: z
      .object({ code: z.string().regex(/^PREVIEW_[A-Z0-9_]{2,119}$/u) })
      .strict()
      .nullable(),
  })
  .strict();

export const executionPreviewControlSchema = z
  .object({
    eligibility: z.object({ status: previewEligibilityStatusSchema }).strict(),
    session: previewSessionViewSchema.nullable(),
  })
  .strict();

export const previewStartInputSchema = z
  .object({ ttlSeconds: z.number().int().min(60).max(900).optional() })
  .strict();

export type PreviewStatus = z.infer<typeof previewStatusSchema>;
export type PreviewHealth = z.infer<typeof previewHealthSchema>;
export type PreviewEligibilityStatus = z.infer<typeof previewEligibilityStatusSchema>;
export type PreviewSessionView = Readonly<z.infer<typeof previewSessionViewSchema>>;
export type ExecutionPreviewControl = Readonly<z.infer<typeof executionPreviewControlSchema>>;
export type PreviewStartInput = Readonly<z.input<typeof previewStartInputSchema>>;
