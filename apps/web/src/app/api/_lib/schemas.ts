import { executionRequestSchema } from '@brq/execution-engine';
import {
  executionRecordListQuerySchema,
  executionRecordStatusSchema,
} from '@brq/execution-repository';
import { executionObservabilitySnapshotSchema } from '@brq/observability';
import { jobIdSchema, jobStatusSchema } from '@brq/job-queue';
import { semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import { authenticatedUserSchema, loginCredentialsSchema } from '@/api/auth-contracts';

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
export const jobIdPathSchema = jobIdSchema;
export const executionTimelineIdPathSchema = z.union([
  executionIdPathSchema,
  z
    .string()
    .regex(/^workflow-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
]);

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

export const executionAcceptedDataSchema = z
  .object({
    executionId: executionIdPathSchema,
    jobId: jobIdSchema,
    status: z.literal('QUEUED'),
  })
  .strict();

export const executionAcceptedResponseSchema = z
  .object({
    success: z.literal(true),
    data: executionAcceptedDataSchema,
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

export const loginHttpRequestSchema = loginCredentialsSchema;

export const loginResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ user: authenticatedUserSchema }).strict(),
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

export const logoutResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ loggedOut: z.literal(true) }).strict(),
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

export const jobLookupDataSchema = z
  .object({
    jobId: jobIdSchema,
    executionId: executionIdPathSchema,
    status: jobStatusSchema,
    queuedAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    finishedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const jobLookupResponseSchema = z
  .object({
    success: z.literal(true),
    data: jobLookupDataSchema,
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

const nullableExecutionIdSchema = executionIdPathSchema.nullable();
const nullableDateTimeSchema = z.string().datetime({ offset: true }).nullable();
const nullableDurationSchema = z.number().int().nonnegative().nullable();
const nullableHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable();
const nullableKnowledgeHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .nullable();

export const executionListQueryHttpSchema = z
  .object({
    status: executionRecordStatusSchema.optional(),
    readiness: executionRecordListQuerySchema.shape.readiness,
    createdAfter: executionRecordListQuerySchema.shape.createdAfter,
    createdBefore: executionRecordListQuerySchema.shape.createdBefore,
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .optional(),
    cursor: executionRecordListQuerySchema.shape.cursor,
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.createdAfter !== undefined &&
      query.createdBefore !== undefined &&
      Date.parse(query.createdAfter) > Date.parse(query.createdBefore)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['createdAfter'],
        message: 'createdAfter não pode ser posterior a createdBefore.',
      });
    }
  });

export const executionHistoryItemSchema = z
  .object({
    executionId: nullableExecutionIdSchema,
    workflowId: z.string().min(1).max(128),
    projectName: z.string().min(1).max(500),
    status: executionRecordStatusSchema,
    readiness: z.string().min(1).max(64).nullable(),
    startedAt: nullableDateTimeSchema,
    finishedAt: nullableDateTimeSchema,
    durationMs: nullableDurationSchema,
  })
  .strict();

export const executionHistoryPageSchema = z
  .object({
    items: z.array(executionHistoryItemSchema).max(100),
    nextCursor: z.string().min(1).max(128).nullable(),
  })
  .strict();

const executionHistoryHashesSchema = z
  .object({
    executionRequestHash: nullableHashSchema,
    workflowRequestHash: nullableHashSchema,
    workflowHash: nullableHashSchema,
    lineageHash: nullableHashSchema,
    provenanceHash: nullableHashSchema,
    executionHash: nullableHashSchema,
  })
  .strict();

const executionHistoryLineageSchema = z
  .object({
    outputs: z
      .object({
        productOwnerSpecificationHash: nullableKnowledgeHashSchema,
        technicalSpecificationHash: nullableKnowledgeHashSchema,
        qaSpecificationHash: nullableKnowledgeHashSchema,
      })
      .strict(),
    handoffs: z
      .array(
        z
          .object({
            from: z.enum(['PRODUCT_OWNER', 'DEVELOPER']),
            to: z.enum(['DEVELOPER', 'QA']),
            specification: z.enum(['PRODUCT_OWNER_SPECIFICATION', 'TECHNICAL_SPECIFICATION']),
            verified: z.literal(true),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();

const executionHistoryProvenanceSchema = z
  .object({
    stages: z
      .array(
        z
          .object({
            stage: z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']),
            agentVersion: z.string().min(1).max(128),
            outcome: z.enum(['GENERATED', 'VALIDATION_REJECTED']),
            readiness: z.string().min(1).max(64).nullable(),
            hashes: z
              .object({
                assetBundleHash: z.string().regex(/^[a-f0-9]{64}$/),
                knowledgeContextHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
                promptHash: z.string().regex(/^[a-f0-9]{64}$/),
                responseHash: z.string().regex(/^[a-f0-9]{64}$/),
                validationHash: z.string().regex(/^[a-f0-9]{64}$/),
                generationHash: nullableHashSchema,
                artifactHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100),
              })
              .strict(),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();

export const executionHistoryDetailSchema = executionHistoryItemSchema
  .extend({
    executionId: executionIdPathSchema,
    createdAt: z.string().datetime({ offset: true }),
    requestId: z.string().min(1).max(128).nullable(),
    metadata: z
      .object({
        engineVersion: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        attempt: z.number().int().positive(),
      })
      .strict(),
    hashes: executionHistoryHashesSchema,
    lineage: executionHistoryLineageSchema.nullable(),
    provenance: executionHistoryProvenanceSchema.nullable(),
  })
  .strict();

export const executionHistoryPageResponseSchema = z
  .object({
    success: z.literal(true),
    data: executionHistoryPageSchema,
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

export const executionHistoryDetailResponseSchema = z
  .object({
    success: z.literal(true),
    data: executionHistoryDetailSchema,
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

export const executionTimelineResponseSchema = z
  .object({
    success: z.literal(true),
    data: executionObservabilitySnapshotSchema,
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();
