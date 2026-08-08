export type ExecutionHistoryStatus = 'CREATED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export interface ExecutionHistoryItem {
  readonly executionId: string | null;
  readonly workflowId: string;
  readonly projectName: string;
  readonly status: ExecutionHistoryStatus;
  readonly readiness: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
}

export interface ExecutionHistoryPage {
  readonly items: readonly ExecutionHistoryItem[];
  readonly nextCursor: string | null;
}

export interface ExecutionHistoryFilters {
  readonly status?: ExecutionHistoryStatus;
  readonly readiness?: string;
  readonly createdAfter?: string;
  readonly createdBefore?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ExecutionHistoryHashes {
  readonly executionRequestHash: string | null;
  readonly workflowRequestHash: string | null;
  readonly workflowHash: string | null;
  readonly lineageHash: string | null;
  readonly provenanceHash: string | null;
  readonly executionHash: string | null;
}

export interface ExecutionHistoryLineage {
  readonly outputs: {
    readonly productOwnerSpecificationHash: string | null;
    readonly technicalSpecificationHash: string | null;
    readonly qaSpecificationHash: string | null;
  };
  readonly handoffs: readonly {
    readonly from: 'PRODUCT_OWNER' | 'DEVELOPER';
    readonly to: 'DEVELOPER' | 'QA';
    readonly specification: 'PRODUCT_OWNER_SPECIFICATION' | 'TECHNICAL_SPECIFICATION';
    readonly verified: true;
  }[];
}

export interface ExecutionHistoryProvenance {
  readonly stages: readonly {
    readonly stage: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';
    readonly agentVersion: string;
    readonly outcome: 'GENERATED' | 'VALIDATION_REJECTED';
    readonly readiness: string | null;
    readonly hashes: {
      readonly assetBundleHash: string;
      readonly knowledgeContextHash: string;
      readonly promptHash: string;
      readonly responseHash: string;
      readonly validationHash: string;
      readonly generationHash: string | null;
      readonly artifactHashes: readonly string[];
    };
  }[];
}

export interface ExecutionHistoryJob {
  readonly jobId: string;
  readonly status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface ExecutionHistoryDetail extends ExecutionHistoryItem {
  readonly executionId: string;
  readonly createdAt: string;
  readonly requestId: string | null;
  readonly metadata: {
    readonly engineVersion: string;
    readonly contractVersion: string;
    readonly attempt: number;
  };
  readonly job: ExecutionHistoryJob | null;
  readonly hashes: ExecutionHistoryHashes;
  readonly lineage: ExecutionHistoryLineage | null;
  readonly provenance: ExecutionHistoryProvenance | null;
}

export interface ExecutionHistoryTimelineEvent {
  readonly sequence: number;
  readonly type:
    | 'execution.started'
    | 'execution.finished'
    | 'execution.failed'
    | 'stage.started'
    | 'stage.finished'
    | 'stage.failed';
  readonly stageId: 'EXECUTION' | 'KNOWLEDGE' | 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA' | 'WORKFLOW';
  readonly stageName: string;
  readonly status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly requestId: string | null;
  readonly executionId: string;
  readonly errorCode: string | null;
}

export interface ExecutionHistoryTimeline {
  readonly observabilityVersion: string;
  readonly revision: number;
  readonly executionId: string;
  readonly workflowId: string;
  readonly requestId: string | null;
  readonly status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  readonly updatedAt: string;
  readonly events: readonly ExecutionHistoryTimelineEvent[];
  readonly stages: readonly {
    readonly stageId: 'KNOWLEDGE' | 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';
    readonly stageName: string;
    readonly status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly durationMs: number | null;
    readonly requestId: string | null;
    readonly executionId: string;
  }[];
  readonly stageMetrics: readonly {
    readonly stageId: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';
    readonly durationMs: number | null;
    readonly promptBytes: number | null;
    readonly completionBytes: number | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly totalTokens: number | null;
    readonly providerLatencyMs: number | null;
    readonly validationDurationMs: number | null;
    readonly artifactGenerationDurationMs: number | null;
  }[];
  readonly summary: {
    readonly executionId: string;
    readonly workflowStatus: 'SUCCESS' | 'FAILED' | 'CANCELLED';
    readonly readinessFinal: string | null;
    readonly totalDurationMs: number;
    readonly totalTokens: number;
    readonly totalCostEstimate: {
      readonly amount: number;
      readonly currency: 'USD';
      readonly rateCardVersion: string;
    } | null;
    readonly executedStages: readonly ('KNOWLEDGE' | 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA')[];
    readonly skippedStages: readonly ('KNOWLEDGE' | 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA')[];
    readonly hashes: ExecutionHistoryHashes;
  } | null;
}

export interface ExecutionHistoryDetailView {
  readonly execution: ExecutionHistoryDetail;
  readonly timeline: ExecutionHistoryTimeline;
}
