import { executionResultSchema, type ExecutionResult } from '@brq/execution-engine';
import { factoryExecutionResultSchema, type FactoryExecutionResult } from '@brq/factory-pipeline';
import {
  factoryExecutionObservabilitySnapshotSchema,
  executionObservabilitySnapshotSchema,
  type FactoryExecutionObservabilitySnapshot,
  type ExecutionObservabilitySnapshot,
} from '@brq/observability';

import type {
  ExecutionRecord,
  ExecutionRecordCreatedInput,
  ExecutionRecordJobRunningInput,
  ExecutionRecordJobTerminalInput,
  ExecutionRecordLifecycleEvent,
  ExecutionRecordQueuedInput,
  PersistedFactoryResult,
} from './contracts';
import { immutableClone } from './immutability';
import {
  executionRecordCreatedInputSchema,
  executionRecordJobRunningInputSchema,
  executionRecordJobTerminalInputSchema,
  executionRecordQueuedInputSchema,
  executionRecordSchema,
  persistedFactoryResultSchema,
  persistedLineageSchema,
  persistedProvenanceSchema,
} from './schemas';

const EMPTY_HASHES = Object.freeze({
  executionRequestHash: null,
  workflowRequestHash: null,
  workflowHash: null,
  lineageHash: null,
  provenanceHash: null,
  executionHash: null,
});

export function createExecutionRecord(
  storageId: string,
  input: ExecutionRecordCreatedInput,
): ExecutionRecord {
  const validInput = executionRecordCreatedInputSchema.parse(input);
  return immutableClone(
    executionRecordSchema.parse({
      storageId,
      ...validInput,
      executionId: null,
      status: 'CREATED',
      workflowStatus: null,
      readiness: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      job: null,
      hashes: EMPTY_HASHES,
      failure: null,
      lineage: null,
      provenance: null,
      factoryResult: null,
      observation: null,
      lifecycle: [
        {
          sequence: 1,
          event: 'EXECUTION_CREATED',
          state: 'CREATED',
          occurredAt: validInput.createdAt,
          durationMs: null,
        },
      ],
      revision: 0,
    }),
  );
}

export function createQueuedExecutionRecord(
  storageId: string,
  input: ExecutionRecordQueuedInput,
): ExecutionRecord {
  const validInput = executionRecordQueuedInputSchema.parse(input);
  const created = createExecutionRecord(storageId, {
    workflowId: validInput.workflowId,
    requestId: validInput.requestId,
    traceId: validInput.traceId,
    projectName: validInput.projectName,
    createdAt: validInput.queuedAt,
    metadata: validInput.metadata,
  });
  return immutableClone(
    executionRecordSchema.parse({
      ...created,
      executionId: validInput.executionId,
      job: {
        jobId: validInput.jobId,
        status: 'QUEUED',
        queuedAt: validInput.queuedAt,
        startedAt: null,
        finishedAt: null,
      },
    }),
  );
}

export function projectJobRunningExecutionRecord(
  record: ExecutionRecord,
  input: ExecutionRecordJobRunningInput,
): ExecutionRecord {
  const validInput = executionRecordJobRunningInputSchema.parse(input);
  if (record.job?.jobId !== validInput.jobId || record.job.status !== 'QUEUED') {
    throw new TypeError('Somente um job QUEUED correspondente pode iniciar.');
  }
  return immutableClone(
    executionRecordSchema.parse({
      ...record,
      job: { ...record.job, status: 'RUNNING', startedAt: validInput.startedAt },
      revision: record.revision + 1,
    }),
  );
}

export function projectJobTerminalExecutionRecord(
  record: ExecutionRecord,
  input: ExecutionRecordJobTerminalInput,
): ExecutionRecord {
  const validInput = executionRecordJobTerminalInputSchema.parse(input);
  if (
    record.job?.jobId !== validInput.jobId ||
    (!['QUEUED', 'RUNNING'].includes(record.job.status) && record.job.status !== validInput.status)
  ) {
    throw new TypeError('Somente um job ativo ou terminal equivalente pode ser atualizado.');
  }
  return immutableClone(
    executionRecordSchema.parse({
      ...record,
      job: {
        ...record.job,
        status: validInput.status,
        finishedAt: validInput.finishedAt,
      },
      revision: record.revision + 1,
    }),
  );
}

export function projectRunningExecutionRecord(
  record: ExecutionRecord,
  startedAt: string,
): ExecutionRecord {
  const lifecycle: ExecutionRecordLifecycleEvent[] = [
    ...record.lifecycle,
    {
      sequence: record.lifecycle.length + 1,
      event: 'EXECUTION_RUNNING',
      state: 'RUNNING',
      occurredAt: startedAt,
      durationMs: null,
    },
  ];
  return immutableClone(
    executionRecordSchema.parse({
      ...record,
      status: 'RUNNING',
      startedAt,
      lifecycle,
      revision: record.revision + 1,
    }),
  );
}

export function projectObservedExecutionRecord(
  record: ExecutionRecord,
  rawSnapshot: ExecutionObservabilitySnapshot,
): ExecutionRecord {
  const snapshot = executionObservabilitySnapshotSchema.parse(rawSnapshot);
  if (snapshot.workflowId !== record.workflowId) {
    throw new TypeError('A observação não corresponde ao workflow persistido.');
  }
  return immutableClone(
    executionRecordSchema.parse({
      ...record,
      executionId: snapshot.executionId,
      observation: snapshot,
      revision: record.revision + 1,
    }),
  );
}

function factoryStageResourceOutcome(
  result: FactoryExecutionResult,
  stageId: FactoryExecutionResult['stages'][number]['stageId'],
): PersistedFactoryResult['stages'][number]['resourceOutcome'] {
  const stepId =
    stageId === 'SANDBOX_PREPARE'
      ? 'PREPARE'
      : stageId === 'SANDBOX_TYPECHECK'
        ? 'TYPECHECK'
        : stageId === 'SANDBOX_BUILD'
          ? 'BUILD'
          : stageId === 'SANDBOX_TEST'
            ? 'TEST'
            : null;
  return stepId === null
    ? null
    : (result.sandbox.steps.find((step) => step.stepId === stepId)?.resourceOutcome ?? null);
}

export function projectPersistedFactoryResult(
  rawResult: FactoryExecutionResult,
): PersistedFactoryResult {
  const result = factoryExecutionResultSchema.parse(rawResult);
  const codeGenerator = result.provenance.codeGenerator;
  const workspace = result.provenance.workspace;
  const sandbox = result.sandbox.provenance;
  return immutableClone(
    persistedFactoryResultSchema.parse({
      factoryVersion: result.metadata.pipelineVersion,
      contractVersion: result.metadata.contractVersion,
      status: result.status,
      terminalStage: result.terminalStage,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      readiness: result.execution.readiness,
      generationStatus: result.generation.status,
      generatedFileCount: result.generation.fileCount,
      generatedTotalBytes: result.generation.totalBytes,
      workspaceId: result.workspace.workspaceId,
      workspaceFileCount: result.workspace.fileCount,
      workspaceTotalBytes: result.workspace.totalBytes,
      workspaceReleaseStatus: result.workspace.releaseStatus,
      sandboxStatus: result.sandbox.status,
      sandboxRunId: result.sandbox.sandboxRunId,
      sandboxResourceOutcome: result.sandbox.resourceOutcome,
      hashes: {
        lineageHash: result.hashes.lineageHash,
        provenanceHash: result.hashes.provenanceHash,
        factoryResultHash: result.hashes.factoryResultHash,
      },
      failure:
        result.failure === null
          ? null
          : {
              kind: 'FACTORY_PIPELINE',
              code: result.failure.code,
              sourceCode: result.failure.sourceCode,
              stageId: result.failure.stage,
            },
      stages: result.stages.map((stage) => ({
        stageId: stage.stageId,
        status: stage.status,
        startedAt: stage.startedAt,
        finishedAt: stage.finishedAt,
        durationMs: stage.durationMs,
        outputHash: stage.outputHash,
        failureCode: stage.failure?.code ?? null,
        resourceOutcome: factoryStageResourceOutcome(result, stage.stageId),
      })),
      lineage: {
        productOwnerSpecificationHash: result.lineage.productOwnerSpecificationHash,
        technicalSpecificationHash: result.lineage.technicalSpecificationHash,
        qaSpecificationHash: result.lineage.qaSpecificationHash,
        executionHash: result.lineage.executionHash,
        workflowHash: result.lineage.workflowHash,
        generationHash: result.hashes.generationHash,
        bundleHash: result.lineage.generatedBundleHash,
        bundleContentHash: result.generation.hashes?.bundleContentHash ?? null,
        workspacePlanHash: result.lineage.workspacePlanHash,
        workspaceHash: result.lineage.workspaceHash,
        sandboxRequestHash: result.lineage.sandboxRequestHash,
        sandboxResultHash: result.lineage.sandboxResultHash,
        factoryResultHash: result.hashes.factoryResultHash,
      },
      provenance: {
        codeGeneratorAgentVersion: result.provenance.agents.codeGenerator,
        codeGeneratorContractVersion: codeGenerator?.contractVersion ?? null,
        codeGeneratorAssetBundleHash: codeGenerator?.assetBundleHash ?? null,
        workspaceVersion: workspace?.workspaceVersion ?? null,
        workspaceContractVersion: workspace?.contractVersion ?? null,
        workspacePolicyHash: workspace?.policyHash ?? null,
        workspaceConfigurationHash: workspace?.configurationHash ?? null,
        sandboxRunnerVersion: sandbox?.runnerVersion ?? null,
        sandboxContractVersion: sandbox?.contractVersion ?? null,
        sandboxSanitizerVersion: sandbox?.sanitizerVersion ?? null,
        sandboxHelperAbiVersion: sandbox?.helperAbiVersion ?? null,
        sandboxDependencySnapshotHash: sandbox?.dependencySnapshotHash ?? null,
        sandboxPolicyId: sandbox?.policyId ?? null,
        sandboxPolicyVersion: sandbox?.policyVersion ?? null,
        sandboxPolicyHash: sandbox?.policyHash ?? result.sandbox.hashes?.policyHash ?? null,
        sandboxCommandPolicyHash:
          sandbox?.commandPolicyHash ?? result.sandbox.hashes?.commandPolicyHash ?? null,
        sandboxLimitsHash: sandbox?.limitsHash ?? result.sandbox.hashes?.limitsHash ?? null,
        sandboxAdapter: sandbox?.adapter ?? null,
        sandboxImageDigest: sandbox?.imageDigest ?? null,
        sandboxImageId: sandbox?.imageId ?? null,
        sandboxPlatform: sandbox?.platform ?? null,
        sandboxRuntimeName: sandbox?.runtimeName ?? null,
        sandboxRuntimeVersion: sandbox?.runtimeVersion ?? null,
        toolchainVersions: sandbox?.toolchainVersions ?? {},
      },
    }),
  );
}

function terminalLifecycleEvent(
  result: ExecutionResult,
  sequence: number,
): ExecutionRecordLifecycleEvent {
  return {
    sequence,
    event:
      result.status === 'SUCCESS'
        ? 'EXECUTION_FINISHED'
        : result.status === 'FAILED'
          ? 'EXECUTION_FAILED'
          : 'EXECUTION_CANCELLED',
    state: result.status,
    occurredAt: result.finishedAt,
    durationMs: result.metrics.observed.totalDurationMs,
  };
}

export function projectTerminalExecutionRecord(
  record: ExecutionRecord,
  rawResult: ExecutionResult,
  rawSnapshot: ExecutionObservabilitySnapshot | null,
): ExecutionRecord {
  const result = executionResultSchema.parse(rawResult);
  const snapshot =
    rawSnapshot === null ? null : executionObservabilitySnapshotSchema.parse(rawSnapshot);
  if (
    result.workflowId !== record.workflowId ||
    (snapshot !== null &&
      (snapshot.workflowId !== record.workflowId || snapshot.executionId !== result.executionId))
  ) {
    throw new TypeError('O resultado terminal não corresponde ao registro persistido.');
  }

  return immutableClone(
    executionRecordSchema.parse({
      ...record,
      executionId: result.executionId,
      status: result.status,
      workflowStatus: result.workflowResult?.status ?? result.status,
      readiness: snapshot?.summary?.readinessFinal ?? null,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.metrics.observed.totalDurationMs,
      job:
        record.job === null
          ? null
          : {
              ...record.job,
              status: result.status,
              finishedAt: result.finishedAt,
            },
      metadata: result.metadata,
      hashes: result.hashes,
      failure:
        result.failure === null
          ? null
          : {
              kind: result.failure.kind,
              code: result.failure.code,
              sourceCode: result.failure.sourceCode,
            },
      lineage: result.lineage === null ? null : persistedLineageSchema.parse(result.lineage),
      provenance:
        result.provenance === null ? null : persistedProvenanceSchema.parse(result.provenance),
      observation: snapshot,
      lifecycle: [...record.lifecycle, terminalLifecycleEvent(result, record.lifecycle.length + 1)],
      revision: record.revision + 1,
    }),
  );
}

export function projectTerminalFactoryExecutionRecord(
  record: ExecutionRecord,
  rawResult: FactoryExecutionResult,
  rawSnapshot: FactoryExecutionObservabilitySnapshot | null,
): ExecutionRecord {
  const result = factoryExecutionResultSchema.parse(rawResult);
  const snapshot =
    rawSnapshot === null ? null : factoryExecutionObservabilitySnapshotSchema.parse(rawSnapshot);
  if (
    result.workflowId !== record.workflowId ||
    (snapshot !== null &&
      (snapshot.workflowId !== record.workflowId || snapshot.executionId !== result.executionId))
  ) {
    throw new TypeError('O resultado terminal da Factory não corresponde ao registro persistido.');
  }
  const factoryResult = projectPersistedFactoryResult(result);
  const lifecycleEvent: ExecutionRecordLifecycleEvent = {
    sequence: record.lifecycle.length + 1,
    event:
      result.status === 'SUCCESS'
        ? 'EXECUTION_FINISHED'
        : result.status === 'FAILED'
          ? 'EXECUTION_FAILED'
          : 'EXECUTION_CANCELLED',
    state: result.status,
    occurredAt: result.finishedAt,
    durationMs: result.durationMs,
  };

  return immutableClone(
    executionRecordSchema.parse({
      ...record,
      executionId: result.executionId,
      status: result.status,
      workflowStatus: result.execution.status,
      readiness: result.execution.readiness,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      job:
        record.job === null
          ? null
          : {
              ...record.job,
              status: result.status,
              finishedAt: result.finishedAt,
            },
      hashes: result.execution.hashes,
      failure:
        result.failure === null
          ? null
          : {
              kind: 'FACTORY_PIPELINE',
              code: result.failure.code,
              sourceCode: result.failure.sourceCode,
            },
      lineage:
        result.execution.lineage === null
          ? null
          : persistedLineageSchema.parse(result.execution.lineage),
      provenance:
        result.execution.provenance === null
          ? null
          : persistedProvenanceSchema.parse(result.execution.provenance),
      factoryResult,
      observation: snapshot,
      lifecycle: [...record.lifecycle, lifecycleEvent],
      revision: record.revision + 1,
    }),
  );
}
