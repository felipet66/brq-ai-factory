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
}
