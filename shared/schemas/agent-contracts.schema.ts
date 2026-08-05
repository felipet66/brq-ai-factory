import { z } from 'zod';

import { AGENT_RESULT_STATUSES } from '../constants/statuses';
import { artifactDraftSchema } from './artifact.schema';
import {
  agentNameSchema,
  identifierSchema,
  isoDateTimeSchema,
  semanticVersionSchema,
} from './common.schema';
import { jsonObjectSchema } from './json-value.schema';

export const agentResultStatusSchema = z.enum(AGENT_RESULT_STATUSES);

export const baseAgentInputSchema = z
  .object({
    executionId: identifierSchema,
    projectId: identifierSchema,
    agent: agentNameSchema,
    input: jsonObjectSchema,
    context: jsonObjectSchema,
    constraints: jsonObjectSchema,
    metadata: z
      .object({
        requestedAt: isoDateTimeSchema,
      })
      .strict(),
  })
  .strict();

export const baseAgentOutputSchema = z
  .object({
    status: agentResultStatusSchema,
    summary: z.string().trim().min(1),
    artifacts: z.array(artifactDraftSchema),
    nextContext: jsonObjectSchema,
    warnings: z.array(z.string()),
    metadata: z
      .object({
        agent: agentNameSchema,
        promptVersion: semanticVersionSchema,
        schemaVersion: semanticVersionSchema,
      })
      .strict(),
  })
  .strict();
