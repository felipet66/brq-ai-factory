import type { CodeGeneratorAgent } from '@brq/code-generator-agent';
import type {
  WorkspaceMaterializationOptions,
  WorkspaceMaterializationResult,
  WorkspacePlan,
  WorkspacePlanRequest,
  WorkspaceReleaseResult,
} from '@brq/controlled-workspace';
import type { ExecutionEngine, ExecutionRequest, ExecutionResult } from '@brq/execution-engine';
import type { SandboxRunner } from '@brq/sandbox-runner';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  factoryAgentsSummarySchema,
  factoryExecutionResultSchema,
  factoryGenerationSummarySchema,
  factoryPipelineConfigurationSchema,
  factoryPipelineFailureSchema,
  factoryPipelineHashesSchema,
  factoryPipelineLineageSchema,
  factoryPipelineProvenanceSchema,
  factoryPipelineStageResultSchema,
  factoryPipelineStatusSchema,
  factorySandboxStepSummarySchema,
  factorySandboxSummarySchema,
  factorySourceExecutionSummarySchema,
  factoryWorkspaceSummarySchema,
} from './schemas';
import type { FactoryTechnicalCheckpoint } from './technical-checkpoint';
import type {
  FactoryTechnicalResumeOptions,
  FactoryTechnicalResumeResult,
} from './technical-resume';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type FactoryPipelineConfiguration = DeepReadonly<
  z.infer<typeof factoryPipelineConfigurationSchema>
>;
export type FactoryPipelineStatus = z.infer<typeof factoryPipelineStatusSchema>;
export type FactoryPipelineFailure = DeepReadonly<z.infer<typeof factoryPipelineFailureSchema>>;
export type FactoryPipelineStageResult = DeepReadonly<
  z.infer<typeof factoryPipelineStageResultSchema>
>;
export type FactoryAgentsSummary = DeepReadonly<z.infer<typeof factoryAgentsSummarySchema>>;
export type FactorySourceExecutionSummary = DeepReadonly<
  z.infer<typeof factorySourceExecutionSummarySchema>
>;
export type FactoryGenerationSummary = DeepReadonly<z.infer<typeof factoryGenerationSummarySchema>>;
export type FactoryWorkspaceSummary = DeepReadonly<z.infer<typeof factoryWorkspaceSummarySchema>>;
export type FactorySandboxStepSummary = DeepReadonly<
  z.infer<typeof factorySandboxStepSummarySchema>
>;
export type FactorySandboxSummary = DeepReadonly<z.infer<typeof factorySandboxSummarySchema>>;
export type FactoryPipelineLineage = DeepReadonly<z.infer<typeof factoryPipelineLineageSchema>>;
export type FactoryPipelineProvenance = DeepReadonly<
  z.infer<typeof factoryPipelineProvenanceSchema>
>;
export type FactoryPipelineHashes = DeepReadonly<z.infer<typeof factoryPipelineHashesSchema>>;
export type FactoryExecutionResult = DeepReadonly<z.infer<typeof factoryExecutionResultSchema>>;

export interface FactoryPipelineRunOptions {
  readonly signal?: AbortSignal;
  readonly cacheMode?: 'READ_WRITE' | 'REQUIRE_HIT';
  /** Execution whose immutable AI checkpoints are the source of a cache-only replay. */
  readonly sourceExecutionId?: string;
  /** Opt-in durable handoff after Code Generator and profile validation both pass. */
  readonly onTechnicalCheckpoint?: (checkpoint: FactoryTechnicalCheckpoint) => void | Promise<void>;
}

export interface FactoryPipelinePreflightOptions {
  readonly signal?: AbortSignal;
}

/** Minimal lifecycle port consumed by the coordinator; no filesystem implementation leaks in. */
export interface FactoryWorkspacePort {
  plan(request: WorkspacePlanRequest): WorkspacePlan;
  materialize(
    plan: WorkspacePlan,
    options?: WorkspaceMaterializationOptions,
  ): Promise<WorkspaceMaterializationResult>;
  release(result: WorkspaceMaterializationResult): Promise<WorkspaceReleaseResult>;
}

export interface FactoryTechnicalBoundaryIdentity {
  readonly codeGeneratorAssetBundleHash: string;
  readonly workspace: {
    readonly version: string;
    readonly contractVersion: string;
    readonly policyHash: string;
    readonly configurationHash: string;
  };
  readonly sandbox: {
    readonly runnerVersion: string;
    readonly contractVersion: string;
    readonly policyHash: string;
    readonly commandPolicyHash: string;
    readonly limitsHash: string;
    readonly imageDigest: string;
    readonly imageId: string;
    readonly platform: string;
  };
}

export interface CreateFactoryPipelineCoordinatorOptions {
  readonly executionEngine: ExecutionEngine;
  readonly codeGeneratorAgent: CodeGeneratorAgent;
  readonly workspace: FactoryWorkspacePort;
  readonly sandboxRunner: SandboxRunner;
  readonly configuration: FactoryPipelineConfiguration;
  /**
   * Immutable identities of the concrete host boundaries selected by composition.
   * Required for durable technical checkpoints so resume can fail closed on runtime drift.
   */
  readonly technicalBoundaryIdentity?: FactoryTechnicalBoundaryIdentity;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface FactoryPipelineCoordinator {
  preflight?(options?: FactoryPipelinePreflightOptions): Promise<void>;
  execute(
    request: ExecutionRequest,
    options?: FactoryPipelineRunOptions,
  ): Promise<FactoryExecutionResult>;
  /** Resumes only workspace and sandbox from an already approved immutable checkpoint. */
  resumeTechnical?(
    checkpoint: FactoryTechnicalCheckpoint,
    options: FactoryTechnicalResumeOptions,
  ): Promise<FactoryTechnicalResumeResult>;
}

export type { ExecutionRequest, ExecutionResult };
export type {
  FactoryExecutionProfile,
  FactoryExecutionProfileValidation,
} from '@brq/factory-execution-profile';
