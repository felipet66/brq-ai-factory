import type { ExecutionResult } from '@brq/execution-engine';
import type {
  FactoryExecutionProfile,
  FactoryExecutionProfileValidation,
} from '@brq/factory-execution-profile';
import { projectGenerationProfileConstraints } from '@brq/factory-execution-profile';

import type {
  FactoryAgentsSummary,
  FactoryExecutionResult,
  FactoryGenerationSummary,
  FactoryPipelineFailure,
  FactoryPipelineProvenance,
  FactoryPipelineStageResult,
  FactoryPipelineStatus,
  FactorySandboxSummary,
  FactorySourceExecutionSummary,
  FactoryWorkspaceSummary,
} from './contracts';
import {
  calculateFactoryPipelineLineageHash,
  calculateFactoryPipelineProvenanceHash,
  calculateFactoryPipelineResultHash,
} from './hashing';
import { immutableClone } from './immutability';
import { factoryExecutionResultSchema } from './schemas';
import {
  FACTORY_PIPELINE_CONTRACT_VERSION,
  FACTORY_PIPELINE_HASH_ALGORITHM,
  FACTORY_PIPELINE_VERSION,
} from './version';

export interface CreateFactoryExecutionResultInput {
  readonly execution: ExecutionResult;
  readonly sourceExecution: FactorySourceExecutionSummary;
  readonly status: FactoryPipelineStatus;
  readonly terminalStage: FactoryExecutionResult['terminalStage'];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly stages: readonly FactoryPipelineStageResult[];
  readonly agents: FactoryAgentsSummary;
  readonly generation: FactoryGenerationSummary;
  readonly workspace: FactoryWorkspaceSummary;
  readonly sandbox: FactorySandboxSummary;
  readonly executionProfile: FactoryExecutionProfile;
  readonly profileValidation: FactoryExecutionProfileValidation | null;
  readonly provenance: Omit<
    FactoryPipelineProvenance,
    'pipelineVersion' | 'contractVersion' | 'hashAlgorithm'
  >;
  readonly failure: FactoryPipelineFailure | null;
}

export function createFactoryExecutionResult(
  input: CreateFactoryExecutionResultInput,
): FactoryExecutionResult {
  const lineage = {
    productOwnerSpecificationHash:
      input.execution.lineage?.outputs.productOwnerSpecificationHash ?? null,
    technicalSpecificationHash: input.execution.lineage?.outputs.technicalSpecificationHash ?? null,
    qaSpecificationHash: input.execution.lineage?.outputs.qaSpecificationHash ?? null,
    executionHash: input.execution.hashes.executionHash,
    workflowHash: input.execution.hashes.workflowHash,
    generatedBundleHash: input.generation.hashes?.bundleHash ?? null,
    workspacePlanHash: input.workspace.hashes?.planHash ?? null,
    workspaceHash: input.workspace.hashes?.workspaceHash ?? null,
    sandboxRequestHash: input.sandbox.hashes?.sandboxRequestHash ?? null,
    sandboxResultHash: input.sandbox.hashes?.sandboxResultHash ?? null,
    executionProfileHash: input.executionProfile.identity.profileHash,
    generationProjectionHash: projectGenerationProfileConstraints(input.executionProfile)
      .generationProjectionHash,
    profileValidationHash: input.profileValidation?.profileValidationHash ?? null,
  };
  const provenance: FactoryPipelineProvenance = {
    pipelineVersion: FACTORY_PIPELINE_VERSION,
    contractVersion: FACTORY_PIPELINE_CONTRACT_VERSION,
    hashAlgorithm: FACTORY_PIPELINE_HASH_ALGORITHM,
    ...input.provenance,
  };
  const lineageHash = calculateFactoryPipelineLineageHash(lineage);
  const provenanceHash = calculateFactoryPipelineProvenanceHash(provenance);
  const hashesWithoutResult = {
    executionHash: input.execution.hashes.executionHash,
    workflowHash: input.execution.hashes.workflowHash,
    generationHash: input.generation.hashes?.generationHash ?? null,
    bundleHash: input.generation.hashes?.bundleHash ?? null,
    workspacePlanHash: input.workspace.hashes?.planHash ?? null,
    workspaceHash: input.workspace.hashes?.workspaceHash ?? null,
    sandboxRequestHash: input.sandbox.hashes?.sandboxRequestHash ?? null,
    sandboxResultHash: input.sandbox.hashes?.sandboxResultHash ?? null,
    lineageHash,
    provenanceHash,
  };
  const candidateWithoutResultHash = {
    executionId: input.execution.executionId,
    workflowId: input.execution.workflowId,
    status: input.status,
    terminalStage: input.terminalStage,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    metadata: {
      pipelineVersion: FACTORY_PIPELINE_VERSION,
      contractVersion: FACTORY_PIPELINE_CONTRACT_VERSION,
      attempt: 1 as const,
    } as const,
    stages: input.stages,
    execution: input.sourceExecution,
    agents: input.agents,
    generation: input.generation,
    workspace: input.workspace,
    sandbox: input.sandbox,
    lineage,
    provenance,
    hashes: hashesWithoutResult,
    failure: input.failure,
  };
  const factoryResultHash = calculateFactoryPipelineResultHash(candidateWithoutResultHash);
  return immutableClone(
    factoryExecutionResultSchema.parse({
      ...candidateWithoutResultHash,
      hashes: { ...hashesWithoutResult, factoryResultHash },
    }),
  );
}
