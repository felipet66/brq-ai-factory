import { FactoryPipelineError, FACTORY_PIPELINE_ERROR_CODES } from './errors';

export const FACTORY_PIPELINE_STAGE_IDS = Object.freeze([
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'CODE_GENERATOR',
  'CODE_PROFILE_VALIDATION',
  'WORKSPACE_PLAN',
  'WORKSPACE_MATERIALIZATION',
  'SANDBOX_PREPARE',
  'SANDBOX_TYPECHECK',
  'SANDBOX_BUILD',
  'SANDBOX_TEST',
  'WORKSPACE_RELEASE',
] as const);

export const FACTORY_PIPELINE_STAGE_STATUSES = Object.freeze([
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
] as const);

export type FactoryPipelineStageId = (typeof FACTORY_PIPELINE_STAGE_IDS)[number];
export type FactoryPipelineStageStatus = (typeof FACTORY_PIPELINE_STAGE_STATUSES)[number];

const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['RUNNING', 'SKIPPED']),
  RUNNING: Object.freeze(['SUCCESS', 'FAILED', 'CANCELLED']),
  SUCCESS: Object.freeze([]),
  FAILED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  SKIPPED: Object.freeze([]),
} satisfies Record<FactoryPipelineStageStatus, readonly FactoryPipelineStageStatus[]>);

export function transitionFactoryPipelineStage(
  current: FactoryPipelineStageStatus,
  next: FactoryPipelineStageStatus,
  stage: FactoryPipelineStageId,
): FactoryPipelineStageStatus {
  const allowed: readonly FactoryPipelineStageStatus[] = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new FactoryPipelineError(`Transição inválida de ${current} para ${next}.`, {
      code: FACTORY_PIPELINE_ERROR_CODES.INTERNAL_ERROR,
      stage,
    });
  }
  return next;
}

export function subsequentFactoryPipelineStages(
  stage: FactoryPipelineStageId,
): readonly FactoryPipelineStageId[] {
  const index = FACTORY_PIPELINE_STAGE_IDS.indexOf(stage);
  return FACTORY_PIPELINE_STAGE_IDS.slice(index + 1);
}
