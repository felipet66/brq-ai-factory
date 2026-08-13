import { z } from 'zod';

export const READINESS_DECISION_VERSION = '1.0.0' as const;

export const READINESS_VALUES = ['READY', 'PARTIALLY_READY', 'REQUIRES_CLARIFICATION'] as const;

export const READINESS_DECISION_SOURCE_STAGES = ['PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const;

export const READINESS_DECISION_FACTOR_CODES = [
  'SOURCE_READY',
  'SOURCE_PARTIALLY_READY',
  'SOURCE_REQUIRES_CLARIFICATION',
  'NO_LOCAL_READINESS_CONCERNS',
  'NON_BLOCKING_QUESTION_PRESENT',
  'BLOCKING_QUESTION_PRESENT',
  'VALIDATION_REQUIRED_ASSUMPTION_PRESENT',
  'BLOCKING_ITEM_PRESENT',
] as const;

export const readinessSchema = z.enum(READINESS_VALUES);
export const readinessDecisionSourceStageSchema = z.enum(READINESS_DECISION_SOURCE_STAGES);
export const readinessDecisionFactorCodeSchema = z.enum(READINESS_DECISION_FACTOR_CODES);

export const readinessDecisionFactorSchema = z
  .object({
    sourceStage: readinessDecisionSourceStageSchema,
    code: readinessDecisionFactorCodeSchema,
  })
  .strict();

const FACTOR_CODES_BY_READINESS = {
  READY: new Set(['SOURCE_READY', 'NO_LOCAL_READINESS_CONCERNS']),
  PARTIALLY_READY: new Set([
    'SOURCE_PARTIALLY_READY',
    'NON_BLOCKING_QUESTION_PRESENT',
    'VALIDATION_REQUIRED_ASSUMPTION_PRESENT',
  ]),
  REQUIRES_CLARIFICATION: new Set([
    'SOURCE_REQUIRES_CLARIFICATION',
    'BLOCKING_QUESTION_PRESENT',
    'BLOCKING_ITEM_PRESENT',
  ]),
} as const;

const SOURCE_STAGE_RANK = new Map(
  READINESS_DECISION_SOURCE_STAGES.map((stage, index) => [stage, index]),
);
const FACTOR_CODE_RANK = new Map(
  READINESS_DECISION_FACTOR_CODES.map((code, index) => [code, index]),
);

export function readinessDecisionFactorMatchesStage(
  decisionStage: (typeof READINESS_DECISION_SOURCE_STAGES)[number],
  factor: z.infer<typeof readinessDecisionFactorSchema>,
): boolean {
  const decisionRank = SOURCE_STAGE_RANK.get(decisionStage)!;
  const sourceRank = SOURCE_STAGE_RANK.get(factor.sourceStage)!;
  return factor.code.startsWith('SOURCE_')
    ? sourceRank < decisionRank
    : factor.sourceStage === decisionStage;
}

export const readinessDecisionSchema = z
  .object({
    version: z.literal(READINESS_DECISION_VERSION),
    readiness: readinessSchema,
    decisiveFactors: z.array(readinessDecisionFactorSchema).min(1).max(8),
  })
  .strict()
  .superRefine((decision, context) => {
    const seen = new Set<string>();
    const allowedCodes = FACTOR_CODES_BY_READINESS[decision.readiness];
    let previousRank = -1;

    decision.decisiveFactors.forEach((factor, index) => {
      const identity = `${factor.sourceStage}:${factor.code}`;
      if (seen.has(identity)) {
        context.addIssue({
          code: 'custom',
          path: ['decisiveFactors', index],
          message: 'Readiness decision factors must be unique.',
        });
      }
      seen.add(identity);

      const rank =
        SOURCE_STAGE_RANK.get(factor.sourceStage)! * READINESS_DECISION_FACTOR_CODES.length +
        FACTOR_CODE_RANK.get(factor.code)!;
      if (rank <= previousRank) {
        context.addIssue({
          code: 'custom',
          path: ['decisiveFactors', index],
          message: 'Readiness decision factors must use canonical stage and code order.',
        });
      }
      previousRank = rank;

      if (!allowedCodes.has(factor.code)) {
        context.addIssue({
          code: 'custom',
          path: ['decisiveFactors', index, 'code'],
          message: 'The factor must belong to the decisive readiness tier.',
        });
      }
    });
  });

type ReadinessEvidenceStage = Readonly<{
  stage: z.infer<typeof readinessDecisionSourceStageSchema>;
  outcome: 'GENERATED' | 'VALIDATION_REJECTED';
  readiness: string | null;
  readinessDecision: z.infer<typeof readinessDecisionSchema> | null;
}>;

const SOURCE_READINESS_BY_FACTOR_CODE = {
  SOURCE_READY: 'READY',
  SOURCE_PARTIALLY_READY: 'PARTIALLY_READY',
  SOURCE_REQUIRES_CLARIFICATION: 'REQUIRES_CLARIFICATION',
} as const;

export function readinessDecisionMatchesStageState(stage: ReadinessEvidenceStage): boolean {
  if (stage.outcome === 'VALIDATION_REJECTED') {
    return stage.readiness === null && stage.readinessDecision === null;
  }
  if (!READINESS_VALUES.some((readiness) => readiness === stage.readiness)) return false;
  return stage.readinessDecision === null || stage.readinessDecision.readiness === stage.readiness;
}

export function readinessEvidenceStagesAreCanonical(
  stages: readonly Pick<ReadinessEvidenceStage, 'stage'>[],
): boolean {
  return stages.every((stage, index) => stage.stage === READINESS_DECISION_SOURCE_STAGES[index]);
}

export function readinessDecisionSourceMatchesStages(
  factor: z.infer<typeof readinessDecisionFactorSchema>,
  stages: readonly Pick<ReadinessEvidenceStage, 'stage' | 'readiness'>[],
): boolean {
  if (!(factor.code in SOURCE_READINESS_BY_FACTOR_CODE)) return true;
  const source = stages.find((stage) => stage.stage === factor.sourceStage);
  const expectedReadiness =
    SOURCE_READINESS_BY_FACTOR_CODE[factor.code as keyof typeof SOURCE_READINESS_BY_FACTOR_CODE];
  return source?.readiness === expectedReadiness;
}
