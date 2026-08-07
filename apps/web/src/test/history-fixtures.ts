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
    revision: 9,
    status: 'SUCCESS',
    updatedAt: '2026-08-07T10:00:00.250Z',
    stages: [
      {
        stageId: 'KNOWLEDGE',
        stageName: 'Knowledge',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: '2026-08-07T10:00:00.010Z',
        durationMs: 10,
      },
      {
        stageId: 'PRODUCT_OWNER',
        stageName: 'Product Owner',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.010Z',
        finishedAt: '2026-08-07T10:00:00.100Z',
        durationMs: 90,
      },
      {
        stageId: 'DEVELOPER',
        stageName: 'Developer',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.100Z',
        finishedAt: '2026-08-07T10:00:00.200Z',
        durationMs: 100,
      },
      {
        stageId: 'QA',
        stageName: 'QA',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.200Z',
        finishedAt: '2026-08-07T10:00:00.250Z',
        durationMs: 50,
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
      totalTokens: 90,
      totalCostEstimate: { amount: 0.001, currency: 'USD', rateCardVersion: '1.0.0' },
      executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
      skippedStages: [],
    },
    ...overrides,
  };
}
