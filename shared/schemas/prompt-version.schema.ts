import { z } from 'zod';

import { PROMPT_VERSION_STATUSES } from '../constants/prompt-statuses';
import {
  agentNameSchema,
  identifierSchema,
  isoDateTimeSchema,
  semanticVersionSchema,
} from './common.schema';

export const promptVersionStatusSchema = z.enum(PROMPT_VERSION_STATUSES);

export const promptVersionSchema = z
  .object({
    id: identifierSchema,
    agent: agentNameSchema,
    version: semanticVersionSchema,
    schemaVersion: semanticVersionSchema,
    content: z.string().min(1),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    status: promptVersionStatusSchema,
    description: z.string().trim().min(1).max(5_000).nullable(),
    source: z.string().trim().min(1).max(120),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const promptVersionCreateInputSchema = promptVersionSchema.omit({
  id: true,
  hash: true,
  createdAt: true,
  updatedAt: true,
});
