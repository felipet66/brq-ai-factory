import type {
  WorkflowAgentResults,
  WorkflowFailure,
  WorkflowLineage,
  WorkflowProvenance,
  WorkflowResult,
  WorkflowStage,
  WorkflowTimelineEvent,
} from './contracts';
import { calculateCanonicalJsonHash, calculateKnowledgeHash } from './hashing';
import { deepFreeze } from './immutability';
import { createWorkflowMetrics, type StageDurations } from './metrics';
import { workflowResultSchema } from './schemas';

export interface CreateWorkflowResultInput {
  readonly workflowId: string;
  readonly executionId: string;
  readonly requestHash: string;
  readonly status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  readonly terminalStage: WorkflowStage;
  readonly completedStages: readonly WorkflowStage[];
  readonly results: WorkflowAgentResults;
  readonly timeline: readonly WorkflowTimelineEvent[];
  readonly lineage: WorkflowLineage;
  readonly provenance: WorkflowProvenance;
  readonly stageHashes: {
    readonly productOwner: string | null;
    readonly developer: string | null;
    readonly qa: string | null;
  };
  readonly stageDurations: StageDurations;
  readonly totalDurationMs: number;
  readonly failure: WorkflowFailure | null;
}

export function createWorkflowLineage(results: WorkflowAgentResults): WorkflowLineage {
  const productOwnerHash =
    results.productOwner?.outcome === 'GENERATED'
      ? calculateKnowledgeHash(results.productOwner.specification)
      : null;
  const technicalHash =
    results.developer?.outcome === 'GENERATED'
      ? calculateKnowledgeHash(results.developer.specification)
      : null;
  const qaHash =
    results.qa?.outcome === 'GENERATED' ? calculateKnowledgeHash(results.qa.specification) : null;
  const handoffs: WorkflowLineage['handoffs'][number][] = [];

  if (results.developer !== null && productOwnerHash !== null) {
    handoffs.push({
      from: 'PRODUCT_OWNER',
      to: 'DEVELOPER',
      specification: 'PRODUCT_OWNER_SPECIFICATION',
      calculatedHash: productOwnerHash,
      declaredHash: results.developer.metadata.sourceSpecificationHash,
      verified: true,
    });
  }
  if (results.qa !== null && productOwnerHash !== null && technicalHash !== null) {
    handoffs.push(
      {
        from: 'PRODUCT_OWNER',
        to: 'QA',
        specification: 'PRODUCT_OWNER_SPECIFICATION',
        calculatedHash: productOwnerHash,
        declaredHash: results.qa.metadata.productOwnerSpecificationHash,
        verified: true,
      },
      {
        from: 'DEVELOPER',
        to: 'QA',
        specification: 'TECHNICAL_SPECIFICATION',
        calculatedHash: technicalHash,
        declaredHash: results.qa.metadata.technicalSpecificationHash,
        verified: true,
      },
    );
  }

  return {
    outputs: {
      productOwnerSpecificationHash: productOwnerHash,
      technicalSpecificationHash: technicalHash,
      qaSpecificationHash: qaHash,
    },
    handoffs,
  };
}

export function createWorkflowResult(input: CreateWorkflowResultInput): WorkflowResult {
  const lineageHash = calculateCanonicalJsonHash(input.lineage);
  const provenanceHash = calculateCanonicalJsonHash(input.provenance);
  const workflowHash = calculateCanonicalJsonHash({
    contractVersion: '1.0.0',
    requestHash: input.requestHash,
    status: input.status,
    terminalStage: input.terminalStage,
    stageHashes: input.stageHashes,
    lineageHash,
    provenanceHash,
    failureCode: input.failure?.code ?? null,
  });
  const metrics = createWorkflowMetrics(input.totalDurationMs, input.stageDurations, input.results);
  const result = workflowResultSchema.parse({
    workflowId: input.workflowId,
    executionId: input.executionId,
    status: input.status,
    terminalStage: input.terminalStage,
    completedStages: input.completedStages,
    results: input.results,
    timeline: input.timeline,
    lineage: input.lineage,
    provenance: input.provenance,
    metrics,
    hashes: {
      requestHash: input.requestHash,
      stageHashes: input.stageHashes,
      lineageHash,
      provenanceHash,
      workflowHash,
    },
    failure: input.failure,
  });
  return deepFreeze(result);
}
