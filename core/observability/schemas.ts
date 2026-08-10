import { executionHashesSchema } from '@brq/execution-engine';
import { isoDateTimeSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export const observabilityEventTypeSchema = z.enum([
  'execution.started',
  'execution.finished',
  'execution.failed',
  'stage.started',
  'stage.finished',
  'stage.failed',
]);

export const observabilityStageIdSchema = z.enum([
  'EXECUTION',
  'KNOWLEDGE',
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'WORKFLOW',
]);

export const observableAgentStageIdSchema = z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);
export const executionTimelineStageIdSchema = z.enum([
  'KNOWLEDGE',
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
]);

export const factoryExecutionTimelineStageIdSchema = z.enum([
  'KNOWLEDGE',
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'CODE_GENERATOR',
  'WORKSPACE',
  'SANDBOX_PREPARE',
  'SANDBOX_TYPECHECK',
  'SANDBOX_BUILD',
  'SANDBOX_TEST',
]);

export const factoryObservabilityStageIdSchema = z.enum([
  'EXECUTION',
  ...factoryExecutionTimelineStageIdSchema.options,
  'FACTORY',
]);

export const observabilityStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
]);

const PUBLIC_STAGE_ORDER = ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const;
const FACTORY_STAGE_ORDER = factoryExecutionTimelineStageIdSchema.options;
const METRICS_STAGE_ORDER = ['PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const;

export const executionObservabilityEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    type: observabilityEventTypeSchema,
    stageId: observabilityStageIdSchema,
    stageName: z.string().min(1).max(64),
    status: observabilityStatusSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    requestId: z.string().min(1).max(128).nullable(),
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    errorCode: z.string().min(1).max(128).nullable(),
  })
  .strict();

export const executionStageSchema = z
  .object({
    stageId: executionTimelineStageIdSchema,
    stageName: z.string().min(1).max(64),
    status: observabilityStatusSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    requestId: z.string().min(1).max(128).nullable(),
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
  })
  .strict();

const nullableMetricSchema = z.number().int().nonnegative().nullable();

export const executionStageMetricsSchema = z
  .object({
    stageId: observableAgentStageIdSchema,
    durationMs: nullableMetricSchema,
    promptBytes: nullableMetricSchema,
    completionBytes: nullableMetricSchema,
    inputTokens: nullableMetricSchema,
    outputTokens: nullableMetricSchema,
    totalTokens: nullableMetricSchema,
    providerLatencyMs: nullableMetricSchema,
    validationDurationMs: nullableMetricSchema,
    artifactGenerationDurationMs: nullableMetricSchema,
  })
  .strict();

export const executionCostEstimateSchema = z
  .object({
    amount: z.number().nonnegative().finite(),
    currency: z.literal('USD'),
    rateCardVersion: semanticVersionSchema,
  })
  .strict();

export const executionObservabilitySummarySchema = z
  .object({
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    workflowStatus: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
    readinessFinal: z.string().min(1).max(64).nullable(),
    totalDurationMs: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    totalCostEstimate: executionCostEstimateSchema.nullable(),
    executedStages: z.array(executionTimelineStageIdSchema).max(4),
    skippedStages: z.array(executionTimelineStageIdSchema).max(4),
    hashes: executionHashesSchema,
  })
  .strict();

export const executionObservabilitySnapshotV1Schema = z
  .object({
    observabilityVersion: z.literal('1.0.0'),
    revision: z.number().int().nonnegative(),
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    workflowId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128).nullable(),
    status: z.enum(['RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']),
    updatedAt: isoDateTimeSchema,
    events: z.array(executionObservabilityEventSchema).max(64),
    stages: z.array(executionStageSchema).length(4),
    stageMetrics: z.array(executionStageMetricsSchema).length(3),
    summary: executionObservabilitySummarySchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    snapshot.events.forEach((event, index) => {
      if (event.executionId !== snapshot.executionId) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'executionId'],
          message: 'O evento deve pertencer à execução do snapshot.',
        });
      }
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'sequence'],
          message: 'A sequência dos eventos de observabilidade deve ser contígua.',
        });
      }
      if (
        index > 0 &&
        Date.parse(event.finishedAt ?? event.startedAt ?? snapshot.updatedAt) <
          Date.parse(
            snapshot.events[index - 1]!.finishedAt ??
              snapshot.events[index - 1]!.startedAt ??
              snapshot.updatedAt,
          )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['events', index],
          message: 'Os eventos de observabilidade devem ser monotônicos.',
        });
      }
    });
    snapshot.stages.forEach((stage, index) => {
      if (stage.stageId !== PUBLIC_STAGE_ORDER[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'stageId'],
          message: 'As etapas públicas devem preservar a ordem canônica.',
        });
      }
      if (stage.executionId !== snapshot.executionId) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'executionId'],
          message: 'A etapa deve pertencer à execução do snapshot.',
        });
      }
    });
    snapshot.stageMetrics.forEach((metrics, index) => {
      if (metrics.stageId !== METRICS_STAGE_ORDER[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stageMetrics', index, 'stageId'],
          message: 'As métricas devem preservar a ordem canônica dos agentes.',
        });
      }
    });
    if (
      snapshot.summary !== null &&
      (snapshot.summary.executionId !== snapshot.executionId ||
        snapshot.summary.workflowStatus !== snapshot.status)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'O resumo deve corresponder ao snapshot terminal.',
      });
    }
    if (snapshot.summary !== null) {
      const executedStages = snapshot.stages
        .filter((stage) => stage.status !== 'PENDING' && stage.status !== 'SKIPPED')
        .map((stage) => stage.stageId);
      const skippedStages = snapshot.stages
        .filter((stage) => stage.status === 'PENDING' || stage.status === 'SKIPPED')
        .map((stage) => stage.stageId);
      if (
        JSON.stringify(snapshot.summary.executedStages) !== JSON.stringify(executedStages) ||
        JSON.stringify(snapshot.summary.skippedStages) !== JSON.stringify(skippedStages)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['summary'],
          message: 'O resumo deve refletir as etapas executadas e ignoradas.',
        });
      }
    }
  });

export const factoryExecutionObservabilityEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    type: observabilityEventTypeSchema,
    stageId: factoryObservabilityStageIdSchema,
    stageName: z.string().min(1).max(64),
    status: observabilityStatusSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    requestId: z.string().min(1).max(128).nullable(),
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    errorCode: z.string().min(1).max(128).nullable(),
  })
  .strict();

export const factoryExecutionStageSchema = z
  .object({
    stageId: factoryExecutionTimelineStageIdSchema,
    stageName: z.string().min(1).max(64),
    status: observabilityStatusSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    requestId: z.string().min(1).max(128).nullable(),
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
  })
  .strict();

export const factoryExecutionObservabilitySummarySchema = z
  .object({
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    workflowStatus: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
    factoryStatus: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
    readinessFinal: z.string().min(1).max(64).nullable(),
    totalDurationMs: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    totalCostEstimate: executionCostEstimateSchema.nullable(),
    executedStages: z.array(factoryExecutionTimelineStageIdSchema).max(10),
    skippedStages: z.array(factoryExecutionTimelineStageIdSchema).max(10),
    hashes: executionHashesSchema,
    factoryResultHash: z.string().regex(HASH_PATTERN),
  })
  .strict();

export const factoryExecutionObservabilitySnapshotSchema = z
  .object({
    observabilityVersion: z.literal('2.0.0'),
    revision: z.number().int().nonnegative(),
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    workflowId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128).nullable(),
    status: z.enum(['RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']),
    updatedAt: isoDateTimeSchema,
    events: z.array(factoryExecutionObservabilityEventSchema).max(64),
    stages: z.array(factoryExecutionStageSchema).length(10),
    stageMetrics: z.array(executionStageMetricsSchema).length(3),
    summary: factoryExecutionObservabilitySummarySchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    snapshot.events.forEach((event, index) => {
      if (event.executionId !== snapshot.executionId) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'executionId'],
          message: 'O evento deve pertencer à execução do snapshot.',
        });
      }
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'sequence'],
          message: 'A sequência dos eventos de observabilidade deve ser contígua.',
        });
      }
      if (
        index > 0 &&
        Date.parse(event.finishedAt ?? event.startedAt ?? snapshot.updatedAt) <
          Date.parse(
            snapshot.events[index - 1]!.finishedAt ??
              snapshot.events[index - 1]!.startedAt ??
              snapshot.updatedAt,
          )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['events', index],
          message: 'Os eventos de observabilidade devem ser monotônicos.',
        });
      }
    });
    snapshot.stages.forEach((stage, index) => {
      if (stage.stageId !== FACTORY_STAGE_ORDER[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'stageId'],
          message: 'As etapas da Factory devem preservar a ordem canônica.',
        });
      }
      if (stage.executionId !== snapshot.executionId) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'executionId'],
          message: 'A etapa deve pertencer à execução do snapshot.',
        });
      }
    });
    snapshot.stageMetrics.forEach((metrics, index) => {
      if (metrics.stageId !== METRICS_STAGE_ORDER[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stageMetrics', index, 'stageId'],
          message: 'As métricas devem preservar a ordem canônica dos agentes.',
        });
      }
    });
    if (
      snapshot.summary !== null &&
      (snapshot.summary.executionId !== snapshot.executionId ||
        snapshot.summary.factoryStatus !== snapshot.status)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'O resumo deve corresponder ao snapshot terminal da Factory.',
      });
    }
    if (snapshot.summary !== null) {
      const executedStages = snapshot.stages
        .filter((stage) => stage.status !== 'PENDING' && stage.status !== 'SKIPPED')
        .map((stage) => stage.stageId);
      const skippedStages = snapshot.stages
        .filter((stage) => stage.status === 'PENDING' || stage.status === 'SKIPPED')
        .map((stage) => stage.stageId);
      if (
        JSON.stringify(snapshot.summary.executedStages) !== JSON.stringify(executedStages) ||
        JSON.stringify(snapshot.summary.skippedStages) !== JSON.stringify(skippedStages)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['summary'],
          message: 'O resumo deve refletir as etapas executadas e ignoradas.',
        });
      }
    }
  });

export const executionObservabilitySnapshotSchema = z.union([
  factoryExecutionObservabilitySnapshotSchema,
  executionObservabilitySnapshotV1Schema,
]);
