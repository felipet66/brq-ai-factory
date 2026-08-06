import { executionRequestSchema, executionResultSchema } from '@brq/execution-engine';
import { semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import { API_ERROR_CODES } from './constants';

export const executionHttpRequestSchema = z
  .object({
    workflowId: executionRequestSchema.shape.workflowId,
    traceId: executionRequestSchema.shape.traceId,
    demand: executionRequestSchema.shape.demand,
    additionalContext: executionRequestSchema.shape.additionalContext,
    agents: executionRequestSchema.shape.agents,
  })
  .strict()
  .superRefine((request, context) => {
    const executionIds = [
      request.agents.productOwner.agentExecutionId,
      request.agents.developer.agentExecutionId,
      request.agents.qa.agentExecutionId,
    ];
    if (new Set(executionIds).size !== executionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['agents'],
        message: 'Cada etapa deve possuir um agentExecutionId distinto.',
      });
    }
  });

export const executionIdPathSchema = z.string().regex(/^execution-[a-f0-9]{32}$/);

export const apiErrorCodeSchema = z.enum(Object.values(API_ERROR_CODES));

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(300),
    path: z.string().min(1).max(256).optional(),
  })
  .strict();

export const apiResponseMetadataSchema = z
  .object({
    requestId: z.string().regex(/^request-[0-9a-f-]{36}$/),
    apiVersion: semanticVersionSchema,
    executionId: executionIdPathSchema.optional(),
  })
  .strict();

export const errorResponseSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    metadata: apiResponseMetadataSchema,
    errors: z.array(apiErrorSchema).min(1).max(100),
  })
  .strict();

export const healthDataSchema = z
  .object({
    status: z.literal('ok'),
    version: semanticVersionSchema,
    engineVersion: semanticVersionSchema,
    contractVersion: semanticVersionSchema,
  })
  .strict();

export const healthResponseSchema = z
  .object({
    success: z.literal(true),
    data: healthDataSchema,
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

export const executionResponseSchema = z
  .object({
    success: z.literal(true),
    data: executionResultSchema,
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();
