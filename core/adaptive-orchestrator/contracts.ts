import type { z } from 'zod';

import type {
  adaptiveCheckpointSchema,
  adaptiveClassificationSchema,
  adaptiveExecutionRequestSchema,
  adaptiveExecutionResultSchema,
  adaptiveLedgerSchema,
  adaptivePlanSchema,
  adaptiveProfileSchema,
  builderPortRequestSchema,
  builderPortResultSchema,
  plannerPortRequestSchema,
  plannerPortResultSchema,
  reviewerPortRequestSchema,
  tokenUsageSchema,
  verifierPortRequestSchema,
  verifierPortResultSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type AdaptiveExecutionRequest = DeepReadonly<z.infer<typeof adaptiveExecutionRequestSchema>>;
export type AdaptiveClassification = DeepReadonly<z.infer<typeof adaptiveClassificationSchema>>;
export type AdaptiveProfile = DeepReadonly<z.infer<typeof adaptiveProfileSchema>>;
export type AdaptivePlan = DeepReadonly<z.infer<typeof adaptivePlanSchema>>;
export type AdaptiveLedger = DeepReadonly<z.infer<typeof adaptiveLedgerSchema>>;
export type AdaptiveCheckpoint = DeepReadonly<z.infer<typeof adaptiveCheckpointSchema>>;
export type AdaptiveExecutionResult = DeepReadonly<z.infer<typeof adaptiveExecutionResultSchema>>;
export type TokenUsage = DeepReadonly<z.infer<typeof tokenUsageSchema>>;
export type PlannerPortRequest = DeepReadonly<z.infer<typeof plannerPortRequestSchema>>;
export type PlannerPortResult = DeepReadonly<z.infer<typeof plannerPortResultSchema>>;
export type BuilderPortRequest = DeepReadonly<z.infer<typeof builderPortRequestSchema>>;
export type BuilderPortResult = DeepReadonly<z.infer<typeof builderPortResultSchema>>;
export type ReviewerPortRequest = DeepReadonly<z.infer<typeof reviewerPortRequestSchema>>;
export type VerifierPortRequest = DeepReadonly<z.infer<typeof verifierPortRequestSchema>>;
export type VerifierPortResult = DeepReadonly<z.infer<typeof verifierPortResultSchema>>;

export interface AdaptivePlanner {
  plan(request: PlannerPortRequest): Promise<PlannerPortResult>;
}

export interface AdaptiveBuilder {
  build(request: BuilderPortRequest): Promise<BuilderPortResult>;
}

export interface AdaptiveReviewer {
  repair(request: ReviewerPortRequest): Promise<BuilderPortResult>;
}

export interface DeterministicVerifier {
  verify(request: VerifierPortRequest): Promise<VerifierPortResult>;
}

export interface CreateAdaptiveOrchestratorOptions {
  readonly planner?: AdaptivePlanner;
  readonly builder: AdaptiveBuilder;
  readonly verifier: DeterministicVerifier;
  readonly reviewer?: AdaptiveReviewer;
  readonly maxRepairAttempts: number;
}

export interface AdaptiveOrchestrator {
  execute(request: AdaptiveExecutionRequest): Promise<AdaptiveExecutionResult>;
  resume(checkpoint: AdaptiveCheckpoint): Promise<AdaptiveExecutionResult>;
}
