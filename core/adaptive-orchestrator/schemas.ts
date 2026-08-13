import { z } from 'zod';

import { ADAPTIVE_ORCHESTRATOR_CONTRACT_VERSION } from './version';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const semanticVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );

export const adaptiveRouteSchema = z.enum(['SIMPLE_GREENFIELD', 'PLANNED']);

export const adaptiveDemandSchema = z
  .object({
    text: z.string().trim().min(1).max(50_000),
    additionalContext: z.string().trim().min(1).max(50_000).nullable(),
  })
  .strict();

export const adaptiveProfileSchema = z
  .object({
    profileId: identifierSchema,
    version: semanticVersionSchema,
    profileHash: hashSchema,
    constraintsHash: hashSchema,
    capabilityIds: z.array(identifierSchema).max(64),
  })
  .strict();

export const adaptiveRoutingSignalsSchema = z
  .object({
    deliveryIntent: z.enum(['GREENFIELD', 'CHANGE']),
    affectedComponentCount: z.number().int().min(1).max(100),
    hasExternalIntegrations: z.boolean(),
    requiresDataMigration: z.boolean(),
    requiresArchitectureDecision: z.boolean(),
    hasUnresolvedRequirements: z.boolean(),
  })
  .strict();

export const adaptiveExecutionRequestSchema = z
  .object({
    requestId: identifierSchema,
    demand: adaptiveDemandSchema,
    profile: adaptiveProfileSchema,
    routingSignals: adaptiveRoutingSignalsSchema,
  })
  .strict();

export const adaptiveClassificationReasonSchema = z.enum([
  'GREENFIELD_SELF_CONTAINED',
  'CHANGE_REQUEST',
  'MULTIPLE_COMPONENTS',
  'EXTERNAL_INTEGRATION',
  'DATA_MIGRATION',
  'ARCHITECTURE_DECISION',
  'UNRESOLVED_REQUIREMENTS',
]);

export const adaptiveClassificationSchema = z
  .object({
    route: adaptiveRouteSchema,
    reasons: z.array(adaptiveClassificationReasonSchema).min(1).max(6),
  })
  .strict();

export const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  })
  .strict();

export const adaptivePlanStepSchema = z
  .object({
    stepId: identifierSchema,
    objective: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const plannerPortResultSchema = z
  .object({
    steps: z.array(adaptivePlanStepSchema).min(1).max(20),
    usage: tokenUsageSchema,
  })
  .strict();

export const adaptivePlanSchema = z
  .object({
    planHash: hashSchema,
    steps: z.array(adaptivePlanStepSchema).min(1).max(20),
  })
  .strict();

export const candidateReferenceSchema = z
  .object({
    bundleId: identifierSchema,
    bundleHash: hashSchema,
    manifestHash: hashSchema,
  })
  .strict();

export const builderPortResultSchema = z
  .object({
    candidate: candidateReferenceSchema,
    usage: tokenUsageSchema,
  })
  .strict();

export const codeFailureReasonSchema = z.enum([
  'PROFILE_VIOLATION',
  'TYPECHECK_FAILED',
  'TEST_FAILED',
  'BUILD_FAILED',
]);

export const infraFailureReasonSchema = z.enum([
  'RUNTIME_UNAVAILABLE',
  'RUNTIME_TIMEOUT',
  'CLEANUP_FAILED',
]);

export const verificationStageSchema = z.enum([
  'PROFILE',
  'TYPECHECK',
  'TEST',
  'BUILD',
  'RUNTIME',
  'CLEANUP',
]);

export const codeFailureDiagnosticSchema = z
  .object({
    kind: z.literal('CODE_FAILURE'),
    stage: verificationStageSchema,
    reasonCode: codeFailureReasonSchema,
  })
  .strict();

export const infraFailureDiagnosticSchema = z
  .object({
    kind: z.literal('INFRA_FAILURE'),
    stage: verificationStageSchema,
    reasonCode: infraFailureReasonSchema,
  })
  .strict();

export const safeVerifierDiagnosticSchema = z.discriminatedUnion('kind', [
  codeFailureDiagnosticSchema,
  infraFailureDiagnosticSchema,
]);

export const verifierPortResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('SUCCESS'), verificationHash: hashSchema }).strict(),
  z
    .object({
      status: z.literal('CODE_FAILURE'),
      diagnostic: codeFailureDiagnosticSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('INFRA_FAILURE'),
      diagnostic: infraFailureDiagnosticSchema,
    })
    .strict(),
]);

export const plannerPortRequestSchema = z
  .object({
    demand: adaptiveDemandSchema,
    profile: adaptiveProfileSchema,
    routingSignals: adaptiveRoutingSignalsSchema,
  })
  .strict();

export const builderPortRequestSchema = z
  .object({
    demand: adaptiveDemandSchema,
    profile: adaptiveProfileSchema,
    plan: adaptivePlanSchema.nullable(),
    feedback: safeVerifierDiagnosticSchema.nullable(),
  })
  .strict();

export const reviewerPortRequestSchema = z
  .object({
    demand: adaptiveDemandSchema,
    profile: adaptiveProfileSchema,
    plan: adaptivePlanSchema.nullable(),
    candidate: candidateReferenceSchema,
    feedback: codeFailureDiagnosticSchema,
    repairAttempt: z.number().int().min(1).max(2),
  })
  .strict();

export const verifierPortRequestSchema = z
  .object({
    profile: adaptiveProfileSchema,
    candidate: candidateReferenceSchema,
  })
  .strict();

const roleTokenLedgerSchema = tokenUsageSchema.extend({
  totalTokens: z.number().int().nonnegative(),
});

export const adaptiveLedgerSchema = z
  .object({
    calls: z
      .object({
        classifier: z.literal(1),
        planner: z.number().int().min(0).max(1),
        builder: z.number().int().min(0).max(1),
        verifier: z.number().int().nonnegative(),
        reviewer: z.number().int().min(0).max(2),
      })
      .strict(),
    tokens: z
      .object({
        planner: roleTokenLedgerSchema,
        builder: roleTokenLedgerSchema,
        verifier: roleTokenLedgerSchema,
        reviewer: roleTokenLedgerSchema,
        total: roleTokenLedgerSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((ledger, context) => {
    for (const role of ['planner', 'builder', 'verifier', 'reviewer'] as const) {
      const usage = ledger.tokens[role];
      if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
        context.addIssue({
          code: 'custom',
          path: ['tokens', role, 'totalTokens'],
          message: 'totalTokens must equal inputTokens + outputTokens.',
        });
      }
    }
    const expectedInput =
      ledger.tokens.planner.inputTokens +
      ledger.tokens.builder.inputTokens +
      ledger.tokens.verifier.inputTokens +
      ledger.tokens.reviewer.inputTokens;
    const expectedOutput =
      ledger.tokens.planner.outputTokens +
      ledger.tokens.builder.outputTokens +
      ledger.tokens.verifier.outputTokens +
      ledger.tokens.reviewer.outputTokens;
    if (
      ledger.tokens.total.inputTokens !== expectedInput ||
      ledger.tokens.total.outputTokens !== expectedOutput ||
      ledger.tokens.total.totalTokens !== expectedInput + expectedOutput
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tokens', 'total'],
        message: 'Aggregate token usage must equal role usage.',
      });
    }
    if (
      ledger.tokens.verifier.inputTokens !== 0 ||
      ledger.tokens.verifier.outputTokens !== 0 ||
      ledger.tokens.verifier.totalTokens !== 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tokens', 'verifier'],
        message: 'The deterministic verifier cannot report model tokens.',
      });
    }
  });

export const adaptiveCheckpointPayloadSchema = z
  .object({
    contractVersion: z.literal(ADAPTIVE_ORCHESTRATOR_CONTRACT_VERSION),
    request: adaptiveExecutionRequestSchema,
    requestHash: hashSchema,
    classification: adaptiveClassificationSchema,
    plan: adaptivePlanSchema.nullable(),
    candidate: candidateReferenceSchema,
    repairAttemptsUsed: z.number().int().min(0).max(2),
    maxRepairAttempts: z.number().int().min(0).max(2),
    ledger: adaptiveLedgerSchema,
  })
  .strict();

export const adaptiveCheckpointSchema = adaptiveCheckpointPayloadSchema
  .extend({ checkpointHash: hashSchema })
  .strict();

const adaptiveResultBase = {
  contractVersion: z.literal(ADAPTIVE_ORCHESTRATOR_CONTRACT_VERSION),
  route: adaptiveRouteSchema,
  plan: adaptivePlanSchema.nullable(),
  candidate: candidateReferenceSchema,
  ledger: adaptiveLedgerSchema,
};

export const adaptiveExecutionResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...adaptiveResultBase,
      status: z.literal('SUCCESS'),
      verificationHash: hashSchema,
      diagnostic: z.null(),
      checkpoint: z.null(),
    })
    .strict(),
  z
    .object({
      ...adaptiveResultBase,
      status: z.literal('FAILED'),
      verificationHash: z.null(),
      diagnostic: codeFailureDiagnosticSchema,
      checkpoint: z.null(),
    })
    .strict(),
  z
    .object({
      ...adaptiveResultBase,
      status: z.literal('RESUMABLE'),
      verificationHash: z.null(),
      diagnostic: infraFailureDiagnosticSchema,
      checkpoint: adaptiveCheckpointSchema,
    })
    .strict(),
]);

export const createAdaptiveOrchestratorOptionsSchema = z
  .object({ maxRepairAttempts: z.number().int().min(0).max(2) })
  .strict();
