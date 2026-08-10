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

export type FactoryPipelineStageId =
  | 'PRODUCT_OWNER'
  | 'DEVELOPER'
  | 'QA'
  | 'CODE_GENERATOR'
  | 'WORKSPACE_PLAN'
  | 'WORKSPACE_MATERIALIZATION'
  | 'SANDBOX_PREPARE'
  | 'SANDBOX_TYPECHECK'
  | 'SANDBOX_BUILD'
  | 'SANDBOX_TEST'
  | 'WORKSPACE_RELEASE';

export interface ExecutionHistoryFactoryStage {
  readonly stageId: FactoryPipelineStageId;
  readonly status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly outputHash: string | null;
  readonly failureCode: string | null;
  readonly resourceOutcome:
    'NONE' | 'OOM' | 'PID_LIMIT' | 'DISK_LIMIT' | 'OUTPUT_LIMIT' | 'UNKNOWN' | null;
}

export interface ExecutionHistoryFactoryResult {
  readonly factoryVersion: string;
  readonly contractVersion: string;
  readonly status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  readonly terminalStage: FactoryPipelineStageId | 'EXECUTION' | 'SANDBOX';
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly readiness: string | null;
  readonly generationStatus: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  readonly generatedFileCount: number | null;
  readonly generatedTotalBytes: number | null;
  readonly workspaceId: string | null;
  readonly workspaceFileCount: number | null;
  readonly workspaceTotalBytes: number | null;
  readonly workspaceReleaseStatus: 'RELEASED' | 'FAILED' | 'NOT_REQUIRED';
  readonly sandboxStatus: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'SKIPPED';
  readonly sandboxRunId: string | null;
  readonly sandboxResourceOutcome:
    'NONE' | 'OOM' | 'PID_LIMIT' | 'DISK_LIMIT' | 'OUTPUT_LIMIT' | 'UNKNOWN';
  readonly hashes: {
    readonly lineageHash: string;
    readonly provenanceHash: string;
    readonly factoryResultHash: string;
  };
  readonly failure: {
    readonly kind: 'FACTORY_PIPELINE';
    readonly code: string;
    readonly sourceCode: string | null;
    readonly stageId: FactoryPipelineStageId | 'EXECUTION' | 'SANDBOX';
  } | null;
  readonly stages: readonly ExecutionHistoryFactoryStage[];
  readonly lineage: {
    readonly productOwnerSpecificationHash: string | null;
    readonly technicalSpecificationHash: string | null;
    readonly qaSpecificationHash: string | null;
    readonly executionHash: string;
    readonly workflowHash: string | null;
    readonly generationHash: string | null;
    readonly bundleHash: string | null;
    readonly bundleContentHash: string | null;
    readonly workspacePlanHash: string | null;
    readonly workspaceHash: string | null;
    readonly sandboxRequestHash: string | null;
    readonly sandboxResultHash: string | null;
    readonly factoryResultHash: string;
  };
  readonly provenance: {
    readonly codeGeneratorAgentVersion: string;
    readonly codeGeneratorContractVersion: string | null;
    readonly codeGeneratorAssetBundleHash: string | null;
    readonly workspaceVersion: string | null;
    readonly workspaceContractVersion: string | null;
    readonly workspacePolicyHash: string | null;
    readonly workspaceConfigurationHash: string | null;
    readonly sandboxRunnerVersion: string | null;
    readonly sandboxContractVersion: string | null;
    readonly sandboxSanitizerVersion: string | null;
    readonly sandboxHelperAbiVersion: string | null;
    readonly sandboxDependencySnapshotHash: string | null;
    readonly sandboxPolicyId: string | null;
    readonly sandboxPolicyVersion: string | null;
    readonly sandboxPolicyHash: string | null;
    readonly sandboxCommandPolicyHash: string | null;
    readonly sandboxLimitsHash: string | null;
    readonly sandboxAdapter: string | null;
    readonly sandboxImageDigest: string | null;
    readonly sandboxImageId: string | null;
    readonly sandboxPlatform: string | null;
    readonly sandboxRuntimeName: string | null;
    readonly sandboxRuntimeVersion: string | null;
    readonly toolchainVersions: Readonly<Record<string, string>>;
  };
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
  readonly factoryResult: ExecutionHistoryFactoryResult | null;
}

export type ExecutionHistoryTimelineStageId =
  | 'KNOWLEDGE'
  | 'PRODUCT_OWNER'
  | 'DEVELOPER'
  | 'QA'
  | 'CODE_GENERATOR'
  | 'WORKSPACE'
  | 'SANDBOX_PREPARE'
  | 'SANDBOX_TYPECHECK'
  | 'SANDBOX_BUILD'
  | 'SANDBOX_TEST';

export type ExecutionHistoryObservabilityStageId =
  'EXECUTION' | ExecutionHistoryTimelineStageId | 'WORKFLOW' | 'FACTORY';

export interface ExecutionHistoryTimelineEvent {
  readonly sequence: number;
  readonly type:
    | 'execution.started'
    | 'execution.finished'
    | 'execution.failed'
    | 'stage.started'
    | 'stage.finished'
    | 'stage.failed';
  readonly stageId: ExecutionHistoryObservabilityStageId;
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
  readonly observabilityVersion: '1.0.0' | '2.0.0';
  readonly revision: number;
  readonly executionId: string;
  readonly workflowId: string;
  readonly requestId: string | null;
  readonly status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  readonly updatedAt: string;
  readonly events: readonly ExecutionHistoryTimelineEvent[];
  readonly stages: readonly {
    readonly stageId: ExecutionHistoryTimelineStageId;
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
    readonly executedStages: readonly ExecutionHistoryTimelineStageId[];
    readonly skippedStages: readonly ExecutionHistoryTimelineStageId[];
    readonly hashes: ExecutionHistoryHashes;
    readonly factoryStatus?: 'SUCCESS' | 'FAILED' | 'CANCELLED';
    readonly factoryResultHash?: string;
  } | null;
}

export interface ExecutionHistoryTimelineV1 extends ExecutionHistoryTimeline {
  readonly observabilityVersion: '1.0.0';
}

export interface ExecutionHistoryTimelineV2 extends ExecutionHistoryTimeline {
  readonly observabilityVersion: '2.0.0';
}

export interface ExecutionHistoryDetailView {
  readonly execution: ExecutionHistoryDetail;
  readonly timeline: ExecutionHistoryTimeline;
}
