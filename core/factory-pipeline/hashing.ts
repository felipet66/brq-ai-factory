import { createHash } from 'node:crypto';

import type {
  FactoryExecutionResult,
  FactoryPipelineLineage,
  FactoryPipelineProvenance,
} from './contracts';
import { canonicalJson } from './canonical-json';

function domainHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`${domain}\u0000${canonicalJson(value)}`)
    .digest('hex');
}

export function calculateFactoryPipelineLineageHash(lineage: FactoryPipelineLineage): string {
  return domainHash('brq-factory-pipeline:lineage:v1', lineage);
}

export function calculateFactoryPipelineProvenanceHash(
  provenance: FactoryPipelineProvenance,
): string {
  return domainHash('brq-factory-pipeline:provenance:v1', provenance);
}

function failureIdentity(
  failure: {
    readonly code: string;
    readonly stage: string;
    readonly sourceCode: string | null;
    readonly reasonCode: string | null;
    readonly profileRuleId?: string | null;
    readonly diagnosticSummary?: {
      readonly diagnosticCount: number;
      readonly diagnosticCodes: readonly number[];
      readonly truncated: boolean;
    } | null;
  } | null,
) {
  return failure === null
    ? null
    : {
        code: failure.code,
        stage: failure.stage,
        sourceCode: failure.sourceCode,
        reasonCode: failure.reasonCode,
        profileRuleId: failure.profileRuleId ?? null,
        diagnosticSummary: failure.diagnosticSummary ?? null,
      };
}

export type FactoryResultHashInput = Omit<FactoryExecutionResult, 'hashes'> & {
  readonly hashes: Omit<FactoryExecutionResult['hashes'], 'factoryResultHash'>;
};

export function calculateFactoryPipelineResultHash(result: FactoryResultHashInput): string {
  const identity = {
    executionId: result.executionId,
    workflowId: result.workflowId,
    status: result.status,
    terminalStage: result.terminalStage,
    metadata: result.metadata,
    stages: result.stages.map((stage) => ({
      stageId: stage.stageId,
      status: stage.status,
      outputHash: stage.outputHash,
      profileRuleId: stage.profileRuleId,
      diagnosticSummary: stage.diagnosticSummary,
      failure: failureIdentity(stage.failure),
    })),
    execution: result.execution,
    agents: result.agents,
    generation: result.generation,
    workspace: result.workspace,
    sandbox: {
      status: result.sandbox.status,
      sandboxRunId: result.sandbox.sandboxRunId,
      resourceOutcome: result.sandbox.resourceOutcome,
      steps: result.sandbox.steps.map((step) => ({
        stepId: step.stepId,
        status: step.status,
        exitCode: step.exitCode,
        resourceOutcome: step.resourceOutcome,
        stdout: step.stdout,
        stderr: step.stderr,
        failure: failureIdentity(step.failure),
      })),
      hashes: result.sandbox.hashes,
      provenance: result.sandbox.provenance,
    },
    lineage: result.lineage,
    provenance: result.provenance,
    hashes: result.hashes,
    failure: failureIdentity(result.failure),
  };
  if (result.sandbox.cleanupFailure === null) {
    return domainHash('brq-factory-pipeline:result:v2', identity);
  }
  return domainHash('brq-factory-pipeline:result:v3', {
    ...identity,
    sandbox: {
      ...identity.sandbox,
      cleanupFailure: failureIdentity(result.sandbox.cleanupFailure),
    },
  });
}

export function deriveCodeGeneratorExecutionId(executionHash: string): string {
  const identityHash = domainHash('brq-factory-pipeline:code-generator-execution:v1', {
    executionHash,
  });
  return `agent-execution-code-generator-${identityHash.slice(0, 32)}`;
}
