import {
  workflowLineageSchema,
  workflowMetricsSchema,
  workflowProvenanceSchema,
  workflowRequestSchema,
  workflowResultSchema,
} from '@brq/orchestrator';
import { isoDateTimeSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const nullableHashSchema = hashSchema.nullable();

export const executionStateSchema = z.enum([
  'CREATED',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
]);

const executionRequestShape = {
  workflowId: workflowRequestSchema.shape.workflowId,
  requestId: workflowRequestSchema.shape.requestId,
  traceId: workflowRequestSchema.shape.traceId,
  demand: workflowRequestSchema.shape.demand,
  additionalContext: workflowRequestSchema.shape.additionalContext,
  agents: workflowRequestSchema.shape.agents,
};

export const executionRequestSchema = z
  .object(executionRequestShape)
  .strict()
  .superRefine((request, context) => {
    const agentExecutionIds = [
      request.agents.productOwner.agentExecutionId,
      request.agents.developer.agentExecutionId,
      request.agents.qa.agentExecutionId,
    ];
    if (new Set(agentExecutionIds).size !== agentExecutionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['agents'],
        message: 'Cada etapa deve possuir um agentExecutionId distinto.',
      });
    }
  });

export const executionTimelineEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    event: z.enum([
      'EXECUTION_CREATED',
      'EXECUTION_STARTED',
      'EXECUTION_COMPLETED',
      'EXECUTION_FAILED',
      'EXECUTION_CANCELLED',
    ]),
    state: executionStateSchema,
    timestampMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const executionMetadataSchema = z
  .object({
    engineVersion: semanticVersionSchema,
    contractVersion: semanticVersionSchema,
    attempt: z.literal(1),
  })
  .strict();

export const executionMetricsSchema = z
  .object({
    observed: z
      .object({
        totalDurationMs: z.number().int().nonnegative(),
        orchestratorInvocations: z.number().int().min(0).max(1),
      })
      .strict(),
    workflow: workflowMetricsSchema.nullable(),
  })
  .strict();

export const executionHashesSchema = z
  .object({
    executionRequestHash: hashSchema,
    workflowRequestHash: hashSchema,
    workflowHash: nullableHashSchema,
    lineageHash: nullableHashSchema,
    provenanceHash: nullableHashSchema,
    executionHash: hashSchema,
  })
  .strict();

export const executionFailureSchema = z
  .object({
    kind: z.enum(['WORKFLOW_FAILED', 'ORCHESTRATOR_ERROR', 'CONTRACT_VIOLATION', 'CANCELLED']),
    code: z.string().min(1).max(128),
    sourceCode: z.string().min(1).max(128).nullable(),
    message: z.string().min(1).max(300),
  })
  .strict();

const executionResultBase = {
  executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
  workflowId: workflowRequestSchema.shape.workflowId,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema,
  metadata: executionMetadataSchema,
  workflowResult: workflowResultSchema.nullable(),
  timeline: z.array(executionTimelineEventSchema).min(2).max(3),
  lineage: workflowLineageSchema.nullable(),
  provenance: workflowProvenanceSchema.nullable(),
  metrics: executionMetricsSchema,
  hashes: executionHashesSchema,
};

export const executionResultSchema = z
  .discriminatedUnion('status', [
    z.object({ ...executionResultBase, status: z.literal('SUCCESS'), failure: z.null() }).strict(),
    z
      .object({
        ...executionResultBase,
        status: z.literal('FAILED'),
        failure: executionFailureSchema,
      })
      .strict(),
    z
      .object({
        ...executionResultBase,
        status: z.literal('CANCELLED'),
        failure: executionFailureSchema,
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (result.startedAt !== null && Date.parse(result.finishedAt) < Date.parse(result.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'finishedAt não pode ser anterior a startedAt.',
      });
    }
    result.timeline.forEach((event, index) => {
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['timeline', index, 'sequence'],
          message: 'A timeline deve possuir sequência contígua.',
        });
      }
      if (index > 0 && event.timestampMs < result.timeline[index - 1]!.timestampMs) {
        context.addIssue({
          code: 'custom',
          path: ['timeline', index, 'timestampMs'],
          message: 'A timeline deve ser monotônica.',
        });
      }
    });
    if (result.status === 'SUCCESS' && result.workflowResult?.status !== 'SUCCESS') {
      context.addIssue({
        code: 'custom',
        path: ['workflowResult'],
        message: 'SUCCESS exige WorkflowResult bem-sucedido.',
      });
    }
    if (result.status === 'CANCELLED' && result.failure.kind !== 'CANCELLED') {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'kind'],
        message: 'CANCELLED exige falha de cancelamento.',
      });
    }
    if (result.workflowResult !== null) {
      if (
        result.workflowResult.executionId !== result.executionId ||
        result.workflowResult.workflowId !== result.workflowId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['workflowResult'],
          message: 'WorkflowResult não corresponde à execução.',
        });
      }
      if (
        JSON.stringify(result.lineage) !== JSON.stringify(result.workflowResult.lineage) ||
        JSON.stringify(result.provenance) !== JSON.stringify(result.workflowResult.provenance)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['lineage'],
          message: 'Lineage e provenance devem preservar o WorkflowResult.',
        });
      }
      if (
        result.hashes.workflowHash !== result.workflowResult.hashes.workflowHash ||
        result.hashes.lineageHash !== result.workflowResult.hashes.lineageHash ||
        result.hashes.provenanceHash !== result.workflowResult.hashes.provenanceHash
      ) {
        context.addIssue({
          code: 'custom',
          path: ['hashes'],
          message: 'Hashes promovidos devem preservar o WorkflowResult.',
        });
      }
    } else if (
      result.lineage !== null ||
      result.provenance !== null ||
      result.metrics.workflow !== null ||
      result.hashes.workflowHash !== null ||
      result.hashes.lineageHash !== null ||
      result.hashes.provenanceHash !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['workflowResult'],
        message: 'Dados de workflow exigem WorkflowResult válido.',
      });
    }
  });
