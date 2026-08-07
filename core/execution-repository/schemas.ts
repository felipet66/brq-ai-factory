import { executionObservabilitySnapshotSchema } from '@brq/observability';
import { isoDateTimeSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KNOWLEDGE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const executionRecordStatusSchema = z.enum([
  'CREATED',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
]);
export const terminalExecutionRecordStatusSchema = z.enum(['SUCCESS', 'FAILED', 'CANCELLED']);

const nullableHashSchema = z.string().regex(HASH_PATTERN).nullable();
const nullableKnowledgeHashSchema = z.string().regex(KNOWLEDGE_HASH_PATTERN).nullable();

export const executionRecordHashesSchema = z
  .object({
    executionRequestHash: nullableHashSchema,
    workflowRequestHash: nullableHashSchema,
    workflowHash: nullableHashSchema,
    lineageHash: nullableHashSchema,
    provenanceHash: nullableHashSchema,
    executionHash: nullableHashSchema,
  })
  .strict();

export const executionRecordMetadataSchema = z
  .object({
    engineVersion: semanticVersionSchema,
    contractVersion: semanticVersionSchema,
    attempt: z.literal(1),
  })
  .strict();

export const persistedLineageHandoffSchema = z
  .object({
    from: z.enum(['PRODUCT_OWNER', 'DEVELOPER']),
    to: z.enum(['DEVELOPER', 'QA']),
    specification: z.enum(['PRODUCT_OWNER_SPECIFICATION', 'TECHNICAL_SPECIFICATION']),
    calculatedHash: z.string().regex(KNOWLEDGE_HASH_PATTERN),
    declaredHash: z.string().regex(KNOWLEDGE_HASH_PATTERN),
    verified: z.literal(true),
  })
  .strict();

export const persistedLineageSchema = z
  .object({
    outputs: z
      .object({
        productOwnerSpecificationHash: nullableKnowledgeHashSchema,
        technicalSpecificationHash: nullableKnowledgeHashSchema,
        qaSpecificationHash: nullableKnowledgeHashSchema,
      })
      .strict(),
    handoffs: z.array(persistedLineageHandoffSchema).max(3),
  })
  .strict();

export const persistedProvenanceStageSchema = z
  .object({
    stage: z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']),
    agent: z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']),
    executionId: z.string().min(1).max(128),
    agentExecutionId: z.string().min(1).max(128),
    agentVersion: z.string().min(1).max(128),
    outcome: z.enum(['GENERATED', 'VALIDATION_REJECTED']),
    readiness: z.string().min(1).max(64).nullable(),
    assetBundleHash: z.string().regex(HASH_PATTERN),
    knowledgeContextHash: z.string().regex(KNOWLEDGE_HASH_PATTERN),
    promptHash: z.string().regex(HASH_PATTERN),
    responseHash: z.string().regex(HASH_PATTERN),
    validationHash: z.string().regex(HASH_PATTERN),
    generationHash: nullableHashSchema,
    artifactHashes: z.array(z.string().regex(HASH_PATTERN)).max(100),
  })
  .strict();

export const persistedProvenanceSchema = z
  .object({ stages: z.array(persistedProvenanceStageSchema).max(3) })
  .strict();

export const executionRecordFailureSchema = z
  .object({
    kind: z.string().min(1).max(64),
    code: z.string().min(1).max(128),
    sourceCode: z.string().min(1).max(128).nullable(),
  })
  .strict();

export const executionRecordLifecycleEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    event: z.enum([
      'EXECUTION_CREATED',
      'EXECUTION_RUNNING',
      'EXECUTION_FINISHED',
      'EXECUTION_FAILED',
      'EXECUTION_CANCELLED',
    ]),
    state: executionRecordStatusSchema,
    occurredAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

const executionRecordBaseShape = {
  storageId: z.string().min(1).max(128),
  workflowId: z.string().min(1).max(128),
  executionId: z
    .string()
    .regex(/^execution-[a-f0-9]{32}$/)
    .nullable(),
  requestId: z.string().min(1).max(128).nullable(),
  traceId: z.string().min(1).max(128).nullable(),
  projectName: z.string().min(1).max(500),
  status: executionRecordStatusSchema,
  workflowStatus: terminalExecutionRecordStatusSchema.nullable(),
  readiness: z.string().min(1).max(64).nullable(),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  metadata: executionRecordMetadataSchema,
  hashes: executionRecordHashesSchema,
  failure: executionRecordFailureSchema.nullable(),
  lineage: persistedLineageSchema.nullable(),
  provenance: persistedProvenanceSchema.nullable(),
  observation: executionObservabilitySnapshotSchema.nullable(),
  lifecycle: z.array(executionRecordLifecycleEventSchema).min(1).max(3),
  revision: z.number().int().nonnegative(),
};

export const executionRecordSchema = z
  .object(executionRecordBaseShape)
  .strict()
  .superRefine((record, context) => {
    record.lifecycle.forEach((event, index) => {
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['lifecycle', index, 'sequence'],
          message: 'A sequência do lifecycle deve ser contígua.',
        });
      }
    });
    const terminal = terminalExecutionRecordStatusSchema.safeParse(record.status).success;
    if (terminal && (record.executionId === null || record.finishedAt === null)) {
      context.addIssue({
        code: 'custom',
        path: ['executionId'],
        message: 'Um registro terminal exige executionId e finishedAt.',
      });
    }
    if (!terminal && (record.finishedAt !== null || record.workflowStatus !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Um registro ativo não pode conter metadados terminais.',
      });
    }
    if (record.observation !== null) {
      if (
        record.executionId !== record.observation.executionId ||
        record.workflowId !== record.observation.workflowId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observation'],
          message: 'A observação deve pertencer ao registro.',
        });
      }
    }
  });

export const executionRecordCreatedInputSchema = z
  .object({
    workflowId: executionRecordSchema.shape.workflowId,
    requestId: executionRecordSchema.shape.requestId,
    traceId: executionRecordSchema.shape.traceId,
    projectName: executionRecordSchema.shape.projectName,
    createdAt: isoDateTimeSchema,
    metadata: executionRecordMetadataSchema,
  })
  .strict();

export const executionRecordRunningInputSchema = z
  .object({
    workflowId: executionRecordSchema.shape.workflowId,
    startedAt: isoDateTimeSchema,
  })
  .strict();

export const executionRecordObservationInputSchema = z
  .object({
    workflowId: executionRecordSchema.shape.workflowId,
    snapshot: executionObservabilitySnapshotSchema,
  })
  .strict();

export const executionRecordListQuerySchema = z
  .object({
    status: executionRecordStatusSchema.optional(),
    readiness: z.string().min(1).max(64).optional(),
    createdAfter: isoDateTimeSchema.optional(),
    createdBefore: isoDateTimeSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(128).optional(),
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

export const executionRecordPageSchema = z
  .object({
    items: z.array(executionRecordSchema).max(100),
    nextCursor: z.string().min(1).max(128).nullable(),
  })
  .strict();
