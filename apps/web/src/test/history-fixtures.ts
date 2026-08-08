import type {
  ExecutionHistoryDetail,
  ExecutionHistoryPage,
  ExecutionHistoryTimeline,
} from '@/api/execution-history-contracts';

export const HISTORY_EXECUTION_ID = `execution-${'a'.repeat(32)}`;
const HASH = '1'.repeat(64);
const KNOWLEDGE_HASH = `sha256:${'2'.repeat(64)}`;

export function historyPage(overrides: Partial<ExecutionHistoryPage> = {}): ExecutionHistoryPage {
  return {
    items: [
      {
        executionId: HISTORY_EXECUTION_ID,
        workflowId: 'workflow-001',
        projectName: 'Customer Portal',
        status: 'SUCCESS',
        readiness: 'READY',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: '2026-08-07T10:00:00.250Z',
        durationMs: 250,
      },
    ],
    nextCursor: null,
    ...overrides,
  };
}

export function historyDetail(
  overrides: Partial<ExecutionHistoryDetail> = {},
): ExecutionHistoryDetail {
  return {
    ...historyPage().items[0]!,
    executionId: HISTORY_EXECUTION_ID,
    createdAt: '2026-08-07T09:59:59.999Z',
    requestId: 'request-001',
    metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    job: {
      jobId: `job-${'b'.repeat(32)}`,
      status: 'SUCCESS',
      queuedAt: '2026-08-07T09:59:59.000Z',
      startedAt: '2026-08-07T10:00:00.000Z',
      finishedAt: '2026-08-07T10:00:00.250Z',
    },
    hashes: {
      executionRequestHash: HASH,
      workflowRequestHash: HASH,
      workflowHash: HASH,
      lineageHash: HASH,
      provenanceHash: HASH,
      executionHash: HASH,
    },
    lineage: {
      outputs: {
        productOwnerSpecificationHash: KNOWLEDGE_HASH,
        technicalSpecificationHash: KNOWLEDGE_HASH,
        qaSpecificationHash: KNOWLEDGE_HASH,
      },
      handoffs: [
        {
          from: 'PRODUCT_OWNER',
          to: 'DEVELOPER',
          specification: 'PRODUCT_OWNER_SPECIFICATION',
          verified: true,
        },
      ],
    },
    provenance: {
      stages: [
        {
          stage: 'PRODUCT_OWNER',
          agentVersion: '1.0.1',
          outcome: 'GENERATED',
          readiness: 'READY',
          hashes: {
            assetBundleHash: HASH,
            knowledgeContextHash: KNOWLEDGE_HASH,
            promptHash: HASH,
            responseHash: HASH,
            validationHash: HASH,
            generationHash: HASH,
            artifactHashes: [HASH],
          },
        },
      ],
    },
    ...overrides,
  };
}

export function historyTimeline(
  overrides: Partial<ExecutionHistoryTimeline> = {},
): ExecutionHistoryTimeline {
  return {
    observabilityVersion: '1.0.0',
    revision: 9,
    executionId: HISTORY_EXECUTION_ID,
    workflowId: 'workflow-001',
    requestId: 'request-001',
    status: 'SUCCESS',
    updatedAt: '2026-08-07T10:00:00.250Z',
    events: [
      {
        sequence: 1,
        type: 'execution.started',
        stageId: 'EXECUTION',
        stageName: 'Execution',
        status: 'RUNNING',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: null,
        durationMs: null,
        requestId: 'request-001',
        executionId: HISTORY_EXECUTION_ID,
        errorCode: null,
      },
      {
        sequence: 2,
        type: 'execution.finished',
        stageId: 'EXECUTION',
        stageName: 'Execution',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: '2026-08-07T10:00:00.250Z',
        durationMs: 250,
        requestId: 'request-001',
        executionId: HISTORY_EXECUTION_ID,
        errorCode: null,
      },
    ],
    stages: [
      {
        stageId: 'KNOWLEDGE',
        stageName: 'Knowledge',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: '2026-08-07T10:00:00.010Z',
        durationMs: 10,
        requestId: 'request-001',
        executionId: HISTORY_EXECUTION_ID,
      },
      {
        stageId: 'PRODUCT_OWNER',
        stageName: 'Product Owner',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.010Z',
        finishedAt: '2026-08-07T10:00:00.100Z',
        durationMs: 90,
        requestId: 'request-001',
        executionId: HISTORY_EXECUTION_ID,
      },
      {
        stageId: 'DEVELOPER',
        stageName: 'Developer',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.100Z',
        finishedAt: '2026-08-07T10:00:00.200Z',
        durationMs: 100,
        requestId: 'request-001',
        executionId: HISTORY_EXECUTION_ID,
      },
      {
        stageId: 'QA',
        stageName: 'QA',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.200Z',
        finishedAt: '2026-08-07T10:00:00.250Z',
        durationMs: 50,
        requestId: 'request-001',
        executionId: HISTORY_EXECUTION_ID,
      },
    ],
    stageMetrics: ['PRODUCT_OWNER', 'DEVELOPER', 'QA'].map((stageId) => ({
      stageId: stageId as 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA',
      durationMs: 10,
      promptBytes: 100,
      completionBytes: 50,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      providerLatencyMs: 8,
      validationDurationMs: 1,
      artifactGenerationDurationMs: 1,
    })),
    summary: {
      executionId: HISTORY_EXECUTION_ID,
      workflowStatus: 'SUCCESS',
      readinessFinal: 'READY',
      totalDurationMs: 250,
      totalTokens: 90,
      totalCostEstimate: { amount: 0.001, currency: 'USD', rateCardVersion: '1.0.0' },
      executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
      skippedStages: [],
      hashes: {
        executionRequestHash: HASH,
        workflowRequestHash: HASH,
        workflowHash: HASH,
        lineageHash: HASH,
        provenanceHash: HASH,
        executionHash: HASH,
      },
    },
    ...overrides,
  };
}
