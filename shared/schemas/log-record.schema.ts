import { z } from 'zod';

import { LOG_LEVELS } from '../constants/log-levels';
import { identifierSchema, isoDateTimeSchema } from './common.schema';
import { jsonObjectSchema } from './json-value.schema';

export const logLevelSchema = z.enum(LOG_LEVELS);

export const logRecordSchema = z
  .object({
    id: identifierSchema,
    executionId: identifierSchema,
    agentExecutionId: identifierSchema.nullable(),
    artifactId: identifierSchema.nullable(),
    level: logLevelSchema,
    event: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    message: z.string().trim().min(1).max(5_000).nullable(),
    context: jsonObjectSchema,
    requestId: identifierSchema.nullable(),
    traceId: identifierSchema.nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const logRecordCreateInputSchema = logRecordSchema.omit({
  id: true,
  createdAt: true,
});
