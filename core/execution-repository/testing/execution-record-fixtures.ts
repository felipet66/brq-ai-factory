import {
  executionRequestSchema,
  executionResultSchema,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';
import {
  executionObservabilitySnapshotSchema,
  type ExecutionObservabilitySnapshot,
} from '@brq/observability';

import type { ExecutionRecord } from '../contracts';
import {
  createExecutionRecord,
  projectRunningExecutionRecord,
  projectTerminalExecutionRecord,
} from '../mapper';

export const EXECUTION_RECORD_FIXTURE_ID = `execution-${'a'.repeat(32)}`;
export const EXECUTION_RECORD_FIXTURE_WORKFLOW_ID = 'workflow-001';

export function createExecutionRequestFixture(
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return executionRequestSchema.parse({
    workflowId: EXECUTION_RECORD_FIXTURE_WORKFLOW_ID,
    requestId: 'request-001',
    traceId: 'trace-001',
    demand: {
      title: 'Order tracking',
      description: 'Allow customers to inspect order delivery status.',
      businessGoal: 'Reduce support contacts.',
    },
    agents: {
      productOwner: {
        agentExecutionId: 'po-execution-001',
        agentVersion: '1.0.0',
        model: 'fake-model',
      },
      developer: {
        agentExecutionId: 'developer-execution-001',
        agentVersion: '1.0.0',
        model: 'fake-model',
      },
      qa: {
        agentExecutionId: 'qa-execution-001',
        agentVersion: '1.0.0',
        model: 'fake-model',
      },
    },
    ...overrides,
  });
}

export function createExecutionResultFixture(
  overrides: Partial<ExecutionResult> = {},
): ExecutionResult {
  return executionResultSchema.parse({
    executionId: EXECUTION_RECORD_FIXTURE_ID,
    workflowId: EXECUTION_RECORD_FIXTURE_WORKFLOW_ID,
    status: 'FAILED',
    startedAt: '2026-08-07T12:00:00.010Z',
    finishedAt: '2026-08-07T12:00:00.040Z',
    metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    workflowResult: null,
    timeline: [
      {
        sequence: 1,
        event: 'EXECUTION_CREATED',
        state: 'CREATED',
        timestampMs: 0,
        durationMs: null,
      },
      {
        sequence: 2,
        event: 'EXECUTION_STARTED',
        state: 'RUNNING',
        timestampMs: 10,
        durationMs: null,
      },
      {
        sequence: 3,
        event: 'EXECUTION_FAILED',
        state: 'FAILED',
        timestampMs: 40,
        durationMs: 40,
      },
    ],
    lineage: null,
    provenance: null,
    metrics: {
      observed: { totalDurationMs: 40, orchestratorInvocations: 1 },
      workflow: null,
    },
    hashes: {
      executionRequestHash: '1'.repeat(64),
      workflowRequestHash: '2'.repeat(64),
      workflowHash: null,
      lineageHash: null,
      provenanceHash: null,
      executionHash: '3'.repeat(64),
    },
    failure: {
      kind: 'ORCHESTRATOR_ERROR',
      code: 'EXECUTION_ENGINE_ORCHESTRATOR_FAILED',
      sourceCode: null,
      message: 'Sanitized failure.',
    },
    ...overrides,
  });
}

export function createExecutionObservationFixture(
  overrides: Partial<ExecutionObservabilitySnapshot> = {},
): ExecutionObservabilitySnapshot {
  const emptyMetric = (stageId: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA') => ({
    stageId,
    durationMs: null,
    promptBytes: null,
    completionBytes: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    providerLatencyMs: null,
    validationDurationMs: null,
    artifactGenerationDurationMs: null,
  });
  const stage = (
    stageId: 'KNOWLEDGE' | 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA',
    stageName: string,
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED',
  ) => ({
    stageId,
    stageName,
    status,
    startedAt: status === 'SKIPPED' ? null : '2026-08-07T12:00:00.010Z',
    finishedAt: '2026-08-07T12:00:00.040Z',
    durationMs: status === 'SKIPPED' ? null : 30,
    requestId: 'request-001',
    executionId: EXECUTION_RECORD_FIXTURE_ID,
  });
  return executionObservabilitySnapshotSchema.parse({
    observabilityVersion: '1.0.0',
    revision: 7,
    executionId: EXECUTION_RECORD_FIXTURE_ID,
    workflowId: EXECUTION_RECORD_FIXTURE_WORKFLOW_ID,
    requestId: 'request-001',
    status: 'FAILED',
    updatedAt: '2026-08-07T12:00:00.040Z',
    events: [
      {
        sequence: 1,
        type: 'execution.started',
        stageId: 'EXECUTION',
        stageName: 'Execution',
        status: 'RUNNING',
        startedAt: '2026-08-07T12:00:00.010Z',
        finishedAt: null,
        durationMs: null,
        requestId: 'request-001',
        executionId: EXECUTION_RECORD_FIXTURE_ID,
        errorCode: null,
      },
      {
        sequence: 2,
        type: 'execution.failed',
        stageId: 'WORKFLOW',
        stageName: 'Workflow',
        status: 'FAILED',
        startedAt: '2026-08-07T12:00:00.010Z',
        finishedAt: '2026-08-07T12:00:00.040Z',
        durationMs: 30,
        requestId: 'request-001',
        executionId: EXECUTION_RECORD_FIXTURE_ID,
        errorCode: 'EXECUTION_ENGINE_ORCHESTRATOR_FAILED',
      },
    ],
    stages: [
      stage('KNOWLEDGE', 'Knowledge', 'SUCCESS'),
      stage('PRODUCT_OWNER', 'Product Owner', 'SUCCESS'),
      stage('DEVELOPER', 'Developer', 'FAILED'),
      stage('QA', 'QA', 'SKIPPED'),
    ],
    stageMetrics: [emptyMetric('PRODUCT_OWNER'), emptyMetric('DEVELOPER'), emptyMetric('QA')],
    summary: {
      executionId: EXECUTION_RECORD_FIXTURE_ID,
      workflowStatus: 'FAILED',
      readinessFinal: 'READY',
      totalDurationMs: 40,
      totalTokens: 0,
      totalCostEstimate: null,
      executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER'],
      skippedStages: ['QA'],
      hashes: createExecutionResultFixture().hashes,
    },
    ...overrides,
  });
}

export function createExecutionRecordFixture(): ExecutionRecord {
  const created = createExecutionRecord('execution-record-fixture', {
    workflowId: EXECUTION_RECORD_FIXTURE_WORKFLOW_ID,
    requestId: 'request-001',
    traceId: 'trace-001',
    projectName: 'Order tracking',
    createdAt: '2026-08-07T12:00:00.000Z',
    metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
  });
  const running = projectRunningExecutionRecord(created, '2026-08-07T12:00:00.010Z');
  return projectTerminalExecutionRecord(
    running,
    createExecutionResultFixture(),
    createExecutionObservationFixture(),
  );
}
