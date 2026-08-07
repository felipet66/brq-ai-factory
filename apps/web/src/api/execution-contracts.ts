export interface ExecutionSummary {
  readonly executionId: string;
  readonly status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  readonly durationMs: number;
  readonly readiness: string | null;
  readonly hashes: {
    readonly executionRequestHash: string;
    readonly workflowRequestHash: string;
    readonly workflowHash: string | null;
    readonly lineageHash: string | null;
    readonly provenanceHash: string | null;
    readonly executionHash: string;
  };
  readonly lineage: {
    readonly outputCount: number;
    readonly verifiedHandoffs: number;
  } | null;
  readonly provenance: {
    readonly stages: readonly {
      readonly stage: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';
      readonly agentVersion: string;
      readonly outcome: 'GENERATED' | 'VALIDATION_REJECTED';
      readonly readiness: string | null;
    }[];
  } | null;
  readonly observability: {
    readonly revision: number;
    readonly status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
    readonly stages: readonly {
      readonly stageId: 'KNOWLEDGE' | 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';
      readonly stageName: string;
      readonly status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
      readonly durationMs: number | null;
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
      readonly totalTokens: number;
      readonly totalCostEstimate: {
        readonly amount: number;
        readonly currency: 'USD';
        readonly rateCardVersion: string;
      } | null;
      readonly executedStages: readonly ('KNOWLEDGE' | 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA')[];
      readonly skippedStages: readonly ('KNOWLEDGE' | 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA')[];
    } | null;
  } | null;
}
