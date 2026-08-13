import {
  developerAgentContextSchema,
  developerAgentResultSchema,
  developerAgentLimitsSchema,
} from '@brq/developer-agent';
import {
  productOwnerAgentContextSchema,
  productOwnerAgentLimitsSchema,
  productOwnerAgentResultSchema,
  productOwnerDemandSchema,
} from '@brq/product-owner-agent';
import { qaAgentContextSchema, qaAgentLimitsSchema, qaAgentResultSchema } from '@brq/qa-agent';
import { identifierSchema } from '@brq/shared/schemas/common.schema';
import { deliveryIntentSchema } from '@brq/shared/schemas/delivery-intent.schema';
import {
  readinessDecisionFactorMatchesStage,
  readinessDecisionMatchesStageState,
  readinessDecisionSchema,
  readinessDecisionSourceMatchesStages,
  readinessEvidenceStagesAreCanonical,
} from '@brq/shared/schemas/readiness-decision.schema';
import { z } from 'zod';

import { ORCHESTRATOR_CONTRACT_VERSION } from './version';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const knowledgeHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const durationSchema = z.number().int().nonnegative();
const agentSchema = z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);

function agentConfigurationSchema(
  contextSchema:
    | typeof productOwnerAgentContextSchema
    | typeof developerAgentContextSchema
    | typeof qaAgentContextSchema,
  limitsSchema:
    | typeof productOwnerAgentLimitsSchema
    | typeof developerAgentLimitsSchema
    | typeof qaAgentLimitsSchema,
) {
  return z
    .object({
      agentExecutionId: contextSchema.shape.agentExecutionId,
      agentVersion: contextSchema.shape.agentVersion,
      model: z
        .string()
        .min(1)
        .max(200)
        .refine((value) => value === value.trim()),
      limits: limitsSchema.optional(),
    })
    .strict();
}

export const workflowStageSchema = z.enum([
  'INITIALIZATION',
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'FINALIZATION',
]);

export const workflowStatusSchema = z.enum([
  'CREATED',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
]);

export const workflowRequestSchema = z
  .object({
    workflowId: identifierSchema,
    executionId: identifierSchema,
    requestId: identifierSchema.optional(),
    traceId: identifierSchema.optional(),
    deliveryIntent: deliveryIntentSchema,
    demand: productOwnerDemandSchema,
    additionalContext: z
      .string()
      .min(1)
      .max(16_000)
      .refine((value) => value === value.trim())
      .optional(),
    agents: z
      .object({
        productOwner: agentConfigurationSchema(
          productOwnerAgentContextSchema,
          productOwnerAgentLimitsSchema,
        ),
        developer: agentConfigurationSchema(
          developerAgentContextSchema,
          developerAgentLimitsSchema,
        ),
        qa: agentConfigurationSchema(qaAgentContextSchema, qaAgentLimitsSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = [
      request.agents.productOwner.agentExecutionId,
      request.agents.developer.agentExecutionId,
      request.agents.qa.agentExecutionId,
    ];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['agents'],
        message: 'Cada etapa deve possuir um agentExecutionId distinto.',
      });
    }
  });

export const workflowTimelineEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    event: z.enum([
      'WORKFLOW_STARTED',
      'STAGE_STARTED',
      'STAGE_COMPLETED',
      'STAGE_REJECTED',
      'STAGE_FAILED',
      'STAGE_CANCELLED',
      'WORKFLOW_COMPLETED',
      'WORKFLOW_FAILED',
      'WORKFLOW_CANCELLED',
    ]),
    stage: workflowStageSchema,
    agent: agentSchema.nullable(),
    timestampMs: z.number().int().nonnegative(),
    durationMs: durationSchema.nullable(),
  })
  .strict();

export const workflowLineageHandoffSchema = z
  .object({
    from: z.enum(['PRODUCT_OWNER', 'DEVELOPER']),
    to: z.enum(['DEVELOPER', 'QA']),
    specification: z.enum(['PRODUCT_OWNER_SPECIFICATION', 'TECHNICAL_SPECIFICATION']),
    calculatedHash: knowledgeHashSchema,
    declaredHash: knowledgeHashSchema,
    verified: z.literal(true),
  })
  .strict();

export const workflowLineageSchema = z
  .object({
    outputs: z
      .object({
        productOwnerSpecificationHash: knowledgeHashSchema.nullable(),
        technicalSpecificationHash: knowledgeHashSchema.nullable(),
        qaSpecificationHash: knowledgeHashSchema.nullable(),
      })
      .strict(),
    handoffs: z.array(workflowLineageHandoffSchema).max(3),
  })
  .strict();

export const workflowStageProvenanceSchema = z
  .object({
    stage: z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']),
    agent: agentSchema,
    executionId: identifierSchema,
    agentExecutionId: identifierSchema,
    agentVersion: z.string().min(1).max(128),
    outcome: z.enum(['GENERATED', 'VALIDATION_REJECTED']),
    readiness: z.string().min(1).max(64).nullable(),
    readinessDecision: readinessDecisionSchema.nullable(),
    assetBundleHash: hashSchema,
    knowledgeContextHash: knowledgeHashSchema,
    promptHash: hashSchema,
    responseHash: hashSchema,
    validationHash: hashSchema,
    generationHash: hashSchema.nullable(),
    artifactHashes: z.array(hashSchema),
  })
  .strict()
  .superRefine((stage, context) => {
    if (!readinessDecisionMatchesStageState(stage)) {
      context.addIssue({
        code: 'custom',
        path: ['readinessDecision'],
        message: 'Readiness evidence must match the stage outcome and readiness.',
      });
    }
    if (stage.outcome === 'GENERATED' && stage.readinessDecision === null) {
      context.addIssue({
        code: 'custom',
        path: ['readinessDecision'],
        message: 'Generated stages require host-derived readiness evidence.',
      });
    }
    stage.readinessDecision?.decisiveFactors.forEach((factor, index) => {
      if (!readinessDecisionFactorMatchesStage(stage.stage, factor)) {
        context.addIssue({
          code: 'custom',
          path: ['readinessDecision', 'decisiveFactors', index],
          message: 'Readiness evidence must identify a real local or upstream source stage.',
        });
      }
    });
  });

export const workflowProvenanceSchema = z
  .object({ stages: z.array(workflowStageProvenanceSchema).max(3) })
  .strict()
  .superRefine((provenance, context) => {
    if (!readinessEvidenceStagesAreCanonical(provenance.stages)) {
      context.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'Provenance stages must be a unique canonical workflow prefix.',
      });
    }
    provenance.stages.forEach((stage, stageIndex) => {
      stage.readinessDecision?.decisiveFactors.forEach((factor, factorIndex) => {
        if (!readinessDecisionSourceMatchesStages(factor, provenance.stages)) {
          context.addIssue({
            code: 'custom',
            path: ['stages', stageIndex, 'readinessDecision', 'decisiveFactors', factorIndex],
            message: 'SOURCE readiness evidence must match the recorded upstream stage.',
          });
        }
      });
    });
  });

const nullableStageDurationsSchema = z
  .object({
    productOwner: durationSchema.nullable(),
    developer: durationSchema.nullable(),
    qa: durationSchema.nullable(),
    finalization: durationSchema.nullable(),
  })
  .strict();

export const workflowMetricsSchema = z
  .object({
    observed: z
      .object({
        totalDurationMs: durationSchema,
        stageDurationsMs: nullableStageDurationsSchema,
        agentsAttempted: z.number().int().min(0).max(3),
        agentsCompleted: z.number().int().min(0).max(3),
        agentsRejected: z.number().int().min(0).max(1),
        artifactCount: z.number().int().nonnegative(),
        agentTotalDurationMs: durationSchema,
        promptBuilderDurationMs: durationSchema,
        providerDurationMs: durationSchema,
        bytesSent: z.number().int().nonnegative(),
        bytesReceived: z.number().int().nonnegative(),
      })
      .strict(),
    reported: z
      .object({
        durationMs: durationSchema,
        attempts: z.number().int().nonnegative(),
        usage: z
          .object({
            inputTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const workflowHashesSchema = z
  .object({
    requestHash: hashSchema,
    stageHashes: z
      .object({
        productOwner: hashSchema.nullable(),
        developer: hashSchema.nullable(),
        qa: hashSchema.nullable(),
      })
      .strict(),
    lineageHash: hashSchema,
    provenanceHash: hashSchema,
    workflowHash: hashSchema,
  })
  .strict();

export const workflowFailureSchema = z
  .object({
    kind: z.enum([
      'VALIDATION_REJECTED',
      'AGENT_ERROR',
      'CONTRACT_VIOLATION',
      'LINEAGE_MISMATCH',
      'CANCELLED',
    ]),
    stage: workflowStageSchema,
    agent: agentSchema.nullable(),
    code: z.string().min(1).max(128),
    sourceCode: z.string().min(1).max(128).nullable(),
    message: z.string().min(1).max(300),
  })
  .strict();

const workflowResultBase = {
  contractVersion: z.literal(ORCHESTRATOR_CONTRACT_VERSION),
  workflowId: identifierSchema,
  executionId: identifierSchema,
  terminalStage: workflowStageSchema,
  completedStages: z.array(workflowStageSchema).max(4),
  results: z
    .object({
      productOwner: productOwnerAgentResultSchema.nullable(),
      developer: developerAgentResultSchema.nullable(),
      qa: qaAgentResultSchema.nullable(),
    })
    .strict(),
  timeline: z.array(workflowTimelineEventSchema).min(2).max(12),
  lineage: workflowLineageSchema,
  provenance: workflowProvenanceSchema,
  metrics: workflowMetricsSchema,
  hashes: workflowHashesSchema,
};

export const workflowResultSchema = z
  .discriminatedUnion('status', [
    z.object({ ...workflowResultBase, status: z.literal('SUCCESS'), failure: z.null() }).strict(),
    z
      .object({
        ...workflowResultBase,
        status: z.literal('FAILED'),
        failure: workflowFailureSchema,
      })
      .strict(),
    z
      .object({
        ...workflowResultBase,
        status: z.literal('CANCELLED'),
        failure: workflowFailureSchema,
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    const { productOwner, developer, qa } = result.results;
    if (developer !== null && (productOwner === null || productOwner.outcome !== 'GENERATED')) {
      context.addIssue({
        code: 'custom',
        path: ['results', 'developer'],
        message: 'Developer exige Product Owner gerado.',
      });
    }
    if (
      qa !== null &&
      (productOwner?.outcome !== 'GENERATED' || developer?.outcome !== 'GENERATED')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['results', 'qa'],
        message: 'QA exige as duas specifications de origem.',
      });
    }
    if (
      result.status === 'SUCCESS' &&
      (productOwner?.outcome !== 'GENERATED' ||
        developer?.outcome !== 'GENERATED' ||
        qa?.outcome !== 'GENERATED')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'SUCCESS exige os três resultados gerados.',
      });
    }
    if (result.status === 'CANCELLED' && result.failure.kind !== 'CANCELLED') {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'kind'],
        message: 'CANCELLED exige falha de cancelamento.',
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
  });
