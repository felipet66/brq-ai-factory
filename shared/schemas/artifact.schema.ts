import { z } from 'zod';

import {
  agentNameSchema,
  identifierSchema,
  isoDateTimeSchema,
  safeFilenameSchema,
  semanticVersionSchema,
} from './common.schema';

export const artifactDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    filename: safeFilenameSchema,
    type: z.string().trim().min(1).max(80),
    content: z.string(),
  })
  .strict();

export const artifactProvenanceSchema = z
  .object({
    agent: agentNameSchema,
    promptVersion: semanticVersionSchema,
    model: z.string().trim().min(1),
  })
  .strict();

export const artifactCreateInputSchema = artifactDraftSchema
  .extend({
    executionId: identifierSchema,
    agentExecutionId: identifierSchema,
    provenance: artifactProvenanceSchema,
  })
  .strict();

export const artifactSchema = artifactDraftSchema
  .extend({
    id: identifierSchema,
    executionId: identifierSchema,
    agentExecutionId: identifierSchema,
    version: z.number().int().positive(),
    createdAt: isoDateTimeSchema,
    provenance: artifactProvenanceSchema,
  })
  .strict();
