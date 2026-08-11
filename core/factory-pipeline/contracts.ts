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

export interface CreateFactoryPipelineCoordinatorOptions {
  readonly executionEngine: ExecutionEngine;
  readonly codeGeneratorAgent: CodeGeneratorAgent;
  readonly workspace: FactoryWorkspacePort;
  readonly sandboxRunner: SandboxRunner;
  readonly configuration: FactoryPipelineConfiguration;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface FactoryPipelineCoordinator {
  execute(
    request: ExecutionRequest,
    options?: FactoryPipelineRunOptions,
  ): Promise<FactoryExecutionResult>;
}

export type { ExecutionRequest, ExecutionResult };
export type {
  FactoryExecutionProfile,
  FactoryExecutionProfileValidation,
} from '@brq/factory-execution-profile';
