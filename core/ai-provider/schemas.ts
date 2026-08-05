import { jsonObjectSchema, jsonValueSchema } from '@brq/shared/schemas/json-value.schema';
import { tokenUsageSchema } from '@brq/shared/schemas/domain.schema';
import { identifierSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

const responseFormatNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const aiResponseFormatSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text') }).strict(),
  z
    .object({
      type: z.literal('json_schema'),
      name: responseFormatNameSchema,
      description: z.string().trim().min(1).max(1_024).optional(),
      schema: jsonObjectSchema,
      strict: z.literal(true),
    })
    .strict(),
]);

export const aiRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1),
    input: z.string().trim().min(1),
    responseFormat: aiResponseFormatSchema,
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();

export const aiGenerateMetadataSchema = z
  .object({
    timeoutMs: z.number().int().min(1_000).max(600_000),
    requestId: identifierSchema.optional(),
    traceId: identifierSchema.optional(),
  })
  .strict();

export const aiResponseFinishReasonSchema = z.enum([
  'COMPLETED',
  'MAX_OUTPUT_TOKENS',
  'CONTENT_FILTER',
  'REFUSAL',
]);

export const aiResponseSchema = z
  .object({
    provider: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(200),
    content: z.string(),
    structuredData: jsonValueSchema.nullable(),
    finishReason: aiResponseFinishReasonSchema,
    usage: tokenUsageSchema,
    metadata: z
      .object({
        responseId: z.string().trim().min(1).max(256).nullable(),
        durationMs: z.number().int().nonnegative(),
        attempts: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
