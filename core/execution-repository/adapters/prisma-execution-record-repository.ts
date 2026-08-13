import type { ExecutionResult } from '@brq/execution-engine';
import {
  factoryTechnicalCheckpointSchema,
  factoryTechnicalResumeResultSchema,
  type FactoryExecutionResult,
} from '@brq/factory-pipeline';
import type {
  ExecutionObservabilitySnapshot,
  FactoryExecutionObservabilitySnapshot,
} from '@brq/observability';
import { Prisma, type DatabaseClient } from '@brq/prisma/client';

import type {
  ExecutionRecord,
  ExecutionRecordCreatedInput,
  ExecutionRecordInfrastructureFailureInput,
  ExecutionRecordJobRunningInput,
  ExecutionRecordJobTerminalInput,
  ExecutionRecordListQuery,
  ExecutionRecordPage,
  ExecutionRecordQueuedInput,
  ExecutionRecordRunningInput,
  FactoryExecutionRecordRepository,
  FactoryTechnicalCheckpointRecord,
  FactoryTechnicalCheckpointLookup,
  FactoryTechnicalCheckpointSaveInput,
  FactoryTechnicalResumeAttemptCompleteInput,
  FactoryTechnicalResumeAttemptCreateInput,
  FactoryTechnicalResumeAttemptFailInput,
  FactoryTechnicalResumeAttemptHeartbeatInput,
  FactoryTechnicalResumeAttemptLookup,
  FactoryTechnicalResumeAttemptReconcileInput,
  FactoryTechnicalResumeAttemptRecord,
  FactoryTechnicalResumeAttemptStageResultInput,
  FactoryTechnicalResumeReconciliation,
} from '../contracts';
import { EXECUTION_REPOSITORY_ERROR_CODES, ExecutionRepositoryError } from '../errors';
import { immutableClone } from '../immutability';
import {
  createExecutionRecord,
  createQueuedExecutionRecord,
  projectInfrastructureFailedExecutionRecord,
  projectJobRunningExecutionRecord,
  projectJobTerminalExecutionRecord,
  projectObservedExecutionRecord,
  projectRunningExecutionRecord,
  projectTerminalFactoryExecutionRecord,
  projectTerminalExecutionRecord,
} from '../mapper';
import {
  executionRecordCreatedInputSchema,
  executionRecordInfrastructureFailureInputSchema,
  executionRecordJobRunningInputSchema,
  executionRecordJobTerminalInputSchema,
  executionRecordListQuerySchema,
  executionRecordQueuedInputSchema,
  executionRecordRunningInputSchema,
  executionRecordSchema,
} from '../schemas';
import {
  factoryTechnicalCheckpointLookupSchema,
  factoryTechnicalCheckpointRecordSchema,
  factoryTechnicalCheckpointSaveInputSchema,
  factoryTechnicalResumeAttemptCompleteInputSchema,
  factoryTechnicalResumeAttemptCreateInputSchema,
  factoryTechnicalResumeAttemptFailInputSchema,
  factoryTechnicalResumeAttemptHeartbeatInputSchema,
  factoryTechnicalResumeAttemptLookupSchema,
  factoryTechnicalResumeAttemptReconcileInputSchema,
  factoryTechnicalResumeAttemptRecordSchema,
  factoryTechnicalResumeAttemptStageResultInputSchema,
  factoryTechnicalResumeReconciliationSchema,
  isTechnicalResumeResultCleanupConfirmed,
} from '../technical-resume-schemas';

const EXECUTION_OWNER_ID_MAX_LENGTH = 128;

export type PrismaExecutionRecordRepositoryAccess =
  | { readonly access: 'OWNER'; readonly userId: string }
  | { readonly access: 'INTERNAL' }
  | { readonly access: 'GLOBAL_READ_ONLY' };

function accessError(message: string): ExecutionRepositoryError {
  return new ExecutionRepositoryError(message, {
    code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
  });
}

function parseAccess(
  rawAccess: PrismaExecutionRecordRepositoryAccess,
): PrismaExecutionRecordRepositoryAccess {
  if (rawAccess?.access === 'INTERNAL' || rawAccess?.access === 'GLOBAL_READ_ONLY') {
    return Object.freeze({ access: rawAccess.access });
  }
  if (
    rawAccess?.access === 'OWNER' &&
    typeof rawAccess.userId === 'string' &&
    rawAccess.userId === rawAccess.userId.trim() &&
    rawAccess.userId.length > 0 &&
    rawAccess.userId.length <= EXECUTION_OWNER_ID_MAX_LENGTH
  ) {
    return Object.freeze({ access: 'OWNER', userId: rawAccess.userId });
  }
  throw accessError('Escopo de acesso do repositório de execução inválido.');
}

interface RawLifecycle {
  sequence: number;
  event: string;
  state: string;
  occurredAt: Date;
  durationMs: number | null;
}

interface RawHashes {
  executionRequestHash: string | null;
  workflowRequestHash: string | null;
  workflowHash: string | null;
  lineageHash: string | null;
  provenanceHash: string | null;
  executionHash: string | null;
}

interface RawJob {
  jobId: string;
  status: string;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface RawMetrics {
  stageId: string;
  durationMs: number | null;
  promptBytes: number | null;
  completionBytes: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  providerLatencyMs: number | null;
  validationDurationMs: number | null;
  artifactGenerationDurationMs: number | null;
}

interface RawObservedStage {
  ordinal: number;
  stageId: string;
  stageName: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  requestId: string | null;
  executionId: string;
  metrics: RawMetrics | null;
}

interface RawObservationEvent {
  sequence: number;
  type: string;
  stageId: string;
  stageName: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  requestId: string | null;
  executionId: string;
  errorCode: string | null;
}

interface RawObservation {
  observabilityVersion: string;
  revision: number;
  executionId: string;
  workflowId: string;
  requestId: string | null;
  status: string;
  updatedAt: Date;
  summaryWorkflowStatus: string | null;
  summaryFactoryStatus: string | null;
  summaryFactoryResultHash: string | null;
  summaryReadinessFinal: string | null;
  summaryTotalDurationMs: number | null;
  summaryTotalTokens: number | null;
  summaryCostAmount: number | null;
  summaryCostCurrency: string | null;
  summaryRateCardVersion: string | null;
  stages: RawObservedStage[];
  events: RawObservationEvent[];
}

interface RawLineageOutput {
  productOwnerSpecificationHash: string | null;
  technicalSpecificationHash: string | null;
  qaSpecificationHash: string | null;
}

interface RawLineageHandoff {
  ordinal: number;
  fromStage: string;
  toStage: string;
  specification: string;
  calculatedHash: string;
  declaredHash: string;
  verified: boolean;
}

interface RawProvenanceStage {
  ordinal: number;
  stage: string;
  agent: string;
  executionId: string;
  agentExecutionId: string;
  agentVersion: string;
  outcome: string;
  readiness: string | null;
  readinessDecision: unknown | null;
  assetBundleHash: string;
  knowledgeContextHash: string;
  promptHash: string;
  responseHash: string;
  validationHash: string;
  generationHash: string | null;
  artifactHashes: { ordinal: number; hash: string }[];
}

interface RawFactoryStage {
  ordinal: number;
  stageId: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  outputHash: string | null;
  failureCode: string | null;
  reasonCode: string | null;
  profileRuleId: string | null;
  diagnosticCount: number | null;
  diagnosticCodes: unknown | null;
  diagnosticTruncated: boolean | null;
  resourceOutcome: string | null;
}

interface RawFactoryLineage {
  productOwnerSpecificationHash: string | null;
  technicalSpecificationHash: string | null;
  qaSpecificationHash: string | null;
  executionHash: string;
  workflowHash: string | null;
  generationHash: string | null;
  bundleHash: string | null;
  bundleContentHash: string | null;
  workspacePlanHash: string | null;
  workspaceHash: string | null;
  sandboxRequestHash: string | null;
  sandboxResultHash: string | null;
  executionProfileHash: string | null;
  generationProjectionHash: string | null;
  profileValidationHash: string | null;
  factoryResultHash: string;
}

interface RawFactoryProvenance {
  codeGeneratorAgentVersion: string | null;
  codeGeneratorContractVersion: string | null;
  codeGeneratorAssetBundleHash: string | null;
  executionProfileId: string | null;
  executionProfileVersion: string | null;
  executionProfileContractVersion: string | null;
  executionProfileHash: string | null;
  generationProjectionHash: string | null;
  profileValidationHash: string | null;
  workspaceVersion: string | null;
  workspaceContractVersion: string | null;
  workspacePolicyHash: string | null;
  workspaceConfigurationHash: string | null;
  sandboxRunnerVersion: string | null;
  sandboxContractVersion: string | null;
  sandboxSanitizerVersion: string | null;
  sandboxHelperAbiVersion: string | null;
  sandboxDependencySnapshotHash: string | null;
  sandboxPolicyId: string | null;
  sandboxPolicyVersion: string | null;
  sandboxPolicyHash: string | null;
  sandboxCommandPolicyHash: string | null;
  sandboxLimitsHash: string | null;
  sandboxAdapter: string | null;
  sandboxImageDigest: string | null;
  sandboxImageId: string | null;
  sandboxPlatform: string | null;
  sandboxRuntimeName: string | null;
  sandboxRuntimeVersion: string | null;
}

interface RawFactoryResult {
  factoryVersion: string;
  contractVersion: string;
  status: string;
  terminalStage: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  readiness: string | null;
  factoryResultHash: string;
  lineageHash: string;
  provenanceHash: string;
  generationStatus: string;
  generatedFileCount: number | null;
  generatedTotalBytes: number | null;
  workspaceId: string | null;
  workspaceFileCount: number | null;
  workspaceTotalBytes: number | null;
  workspaceReleaseStatus: string;
  sandboxStatus: string;
  sandboxRunId: string | null;
  sandboxResourceOutcome: string;
  sandboxCleanupFailureCode: string | null;
  sandboxCleanupSourceCode: string | null;
  failureKind: string | null;
  failureCode: string | null;
  failureSourceCode: string | null;
  failureReasonCode: string | null;
  failureProfileRuleId: string | null;
  failureDiagnosticCount: number | null;
  failureDiagnosticCodes: unknown | null;
  failureDiagnosticTruncated: boolean | null;
  failureStageId: string | null;
  stages: RawFactoryStage[];
  lineage: RawFactoryLineage | null;
  provenance: RawFactoryProvenance | null;
  toolchainVersions: { name: string; version: string }[];
}

interface RawExecutionRecord {
  storageId: string;
  workflowId: string;
  executionId: string | null;
  requestId: string | null;
  traceId: string | null;
  projectName: string;
  status: string;
  workflowStatus: string | null;
  readiness: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  engineVersion: string;
  contractVersion: string;
  attempt: number;
  revision: number;
  failureKind: string | null;
  failureCode: string | null;
  failureSourceCode: string | null;
  hashes: RawHashes | null;
  job: RawJob | null;
  lifecycleEvents: RawLifecycle[];
  observation: RawObservation | null;
  lineageOutput: RawLineageOutput | null;
  lineageHandoffs: RawLineageHandoff[];
  provenanceStages: RawProvenanceStage[];
  factoryResult: RawFactoryResult | null;
}

const aggregateInclude = {
  hashes: true,
  job: true,
  lifecycleEvents: { orderBy: { sequence: 'asc' as const } },
  observation: {
    include: {
      events: { orderBy: { sequence: 'asc' as const } },
      stages: {
        orderBy: { ordinal: 'asc' as const },
        include: { metrics: true },
      },
    },
  },
  lineageOutput: true,
  lineageHandoffs: { orderBy: { ordinal: 'asc' as const } },
  provenanceStages: {
    orderBy: { ordinal: 'asc' as const },
    include: { artifactHashes: { orderBy: { ordinal: 'asc' as const } } },
  },
  factoryResult: {
    include: {
      stages: { orderBy: { ordinal: 'asc' as const } },
      lineage: true,
      provenance: true,
      toolchainVersions: { orderBy: { name: 'asc' as const } },
    },
  },
} as const;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function mapDiagnosticSummary(stage: RawFactoryStage | undefined): unknown {
  if (stage === undefined) return null;
  if (
    stage.diagnosticCount === null &&
    stage.diagnosticCodes === null &&
    stage.diagnosticTruncated === null
  ) {
    return null;
  }
  return {
    diagnosticCount: stage.diagnosticCount,
    diagnosticCodes: stage.diagnosticCodes,
    truncated: stage.diagnosticTruncated,
  };
}

function mapHashes(raw: RawHashes | null) {
  return {
    executionRequestHash: raw?.executionRequestHash ?? null,
    workflowRequestHash: raw?.workflowRequestHash ?? null,
    workflowHash: raw?.workflowHash ?? null,
    lineageHash: raw?.lineageHash ?? null,
    provenanceHash: raw?.provenanceHash ?? null,
    executionHash: raw?.executionHash ?? null,
  };
}

function mapObservation(raw: RawExecutionRecord): unknown {
  const observation = raw.observation;
  if (observation === null) return null;
  const stages = observation.stages.map((stage) => ({
    stageId: stage.stageId,
    stageName: stage.stageName,
    status: stage.status,
    startedAt: iso(stage.startedAt),
    finishedAt: iso(stage.finishedAt),
    durationMs: stage.durationMs,
    requestId: stage.requestId,
    executionId: stage.executionId,
  }));
  const stageMetrics = observation.stages
    .filter((stage) => stage.metrics !== null)
    .map((stage) => ({
      stageId: stage.metrics!.stageId,
      durationMs: stage.metrics!.durationMs,
      promptBytes: stage.metrics!.promptBytes,
      completionBytes: stage.metrics!.completionBytes,
      inputTokens: stage.metrics!.inputTokens,
      outputTokens: stage.metrics!.outputTokens,
      totalTokens: stage.metrics!.totalTokens,
      providerLatencyMs: stage.metrics!.providerLatencyMs,
      validationDurationMs: stage.metrics!.validationDurationMs,
      artifactGenerationDurationMs: stage.metrics!.artifactGenerationDurationMs,
    }));
  const summary =
    observation.summaryWorkflowStatus === null
      ? null
      : observation.observabilityVersion === '2.0.0' || observation.observabilityVersion === '3.0.0'
        ? {
            executionId: observation.executionId,
            workflowStatus: observation.summaryWorkflowStatus,
            factoryStatus: observation.summaryFactoryStatus,
            readinessFinal: observation.summaryReadinessFinal,
            totalDurationMs: observation.summaryTotalDurationMs,
            totalTokens: observation.summaryTotalTokens,
            totalCostEstimate:
              observation.summaryCostAmount === null ||
              observation.summaryCostCurrency === null ||
              observation.summaryRateCardVersion === null
                ? null
                : {
                    amount: observation.summaryCostAmount,
                    currency: observation.summaryCostCurrency,
                    rateCardVersion: observation.summaryRateCardVersion,
                  },
            executedStages: stages
              .filter((stage) => stage.status !== 'PENDING' && stage.status !== 'SKIPPED')
              .map((stage) => stage.stageId),
            skippedStages: stages
              .filter((stage) => stage.status === 'PENDING' || stage.status === 'SKIPPED')
              .map((stage) => stage.stageId),
            hashes: mapHashes(raw.hashes),
            factoryResultHash: observation.summaryFactoryResultHash,
          }
        : {
            executionId: observation.executionId,
            workflowStatus: observation.summaryWorkflowStatus,
            readinessFinal: observation.summaryReadinessFinal,
            totalDurationMs: observation.summaryTotalDurationMs,
            totalTokens: observation.summaryTotalTokens,
            totalCostEstimate:
              observation.summaryCostAmount === null ||
              observation.summaryCostCurrency === null ||
              observation.summaryRateCardVersion === null
                ? null
                : {
                    amount: observation.summaryCostAmount,
                    currency: observation.summaryCostCurrency,
                    rateCardVersion: observation.summaryRateCardVersion,
                  },
            executedStages: stages
              .filter((stage) => stage.status !== 'PENDING' && stage.status !== 'SKIPPED')
              .map((stage) => stage.stageId),
            skippedStages: stages
              .filter((stage) => stage.status === 'PENDING' || stage.status === 'SKIPPED')
              .map((stage) => stage.stageId),
            hashes: mapHashes(raw.hashes),
          };
  return {
    observabilityVersion: observation.observabilityVersion,
    revision: observation.revision,
    executionId: observation.executionId,
    workflowId: observation.workflowId,
    requestId: observation.requestId,
    status: observation.status,
    updatedAt: observation.updatedAt.toISOString(),
    events: observation.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      stageId: event.stageId,
      stageName: event.stageName,
      status: event.status,
      startedAt: iso(event.startedAt),
      finishedAt: iso(event.finishedAt),
      durationMs: event.durationMs,
      requestId: event.requestId,
      executionId: event.executionId,
      errorCode: event.errorCode,
    })),
    stages,
    stageMetrics,
    summary,
  };
}

function mapFactoryResult(raw: RawFactoryResult | null): unknown {
  if (raw === null) return null;
  const terminalDiagnosticSummary =
    raw.failureDiagnosticCount === null &&
    raw.failureDiagnosticCodes === null &&
    raw.failureDiagnosticTruncated === null
      ? null
      : {
          diagnosticCount: raw.failureDiagnosticCount,
          diagnosticCodes: raw.failureDiagnosticCodes,
          truncated: raw.failureDiagnosticTruncated,
        };
  return {
    factoryVersion: raw.factoryVersion,
    contractVersion: raw.contractVersion,
    status: raw.status,
    terminalStage: raw.terminalStage,
    startedAt: raw.startedAt.toISOString(),
    finishedAt: raw.finishedAt.toISOString(),
    durationMs: raw.durationMs,
    readiness: raw.readiness,
    generationStatus: raw.generationStatus,
    generatedFileCount: raw.generatedFileCount,
    generatedTotalBytes: raw.generatedTotalBytes,
    workspaceId: raw.workspaceId,
    workspaceFileCount: raw.workspaceFileCount,
    workspaceTotalBytes: raw.workspaceTotalBytes,
    workspaceReleaseStatus: raw.workspaceReleaseStatus,
    sandboxStatus: raw.sandboxStatus,
    sandboxRunId: raw.sandboxRunId,
    sandboxResourceOutcome: raw.sandboxResourceOutcome,
    sandboxCleanupFailureCode: raw.sandboxCleanupFailureCode,
    sandboxCleanupSourceCode: raw.sandboxCleanupSourceCode,
    hashes: {
      lineageHash: raw.lineageHash,
      provenanceHash: raw.provenanceHash,
      factoryResultHash: raw.factoryResultHash,
    },
    failure:
      raw.failureKind === null || raw.failureCode === null || raw.failureStageId === null
        ? null
        : {
            kind: raw.failureKind,
            code: raw.failureCode,
            sourceCode: raw.failureSourceCode,
            reasonCode: raw.failureReasonCode,
            profileRuleId: raw.failureProfileRuleId,
            diagnosticSummary: terminalDiagnosticSummary,
            stageId: raw.failureStageId,
          },
    stages: raw.stages.map((stage) => ({
      stageId: stage.stageId,
      status: stage.status,
      startedAt: iso(stage.startedAt),
      finishedAt: iso(stage.finishedAt),
      durationMs: stage.durationMs,
      outputHash: stage.outputHash,
      failureCode: stage.failureCode,
      reasonCode: stage.reasonCode,
      profileRuleId: stage.profileRuleId,
      diagnosticSummary: mapDiagnosticSummary(stage),
      resourceOutcome: stage.resourceOutcome,
    })),
    lineage:
      raw.lineage === null
        ? null
        : {
            productOwnerSpecificationHash: raw.lineage.productOwnerSpecificationHash,
            technicalSpecificationHash: raw.lineage.technicalSpecificationHash,
            qaSpecificationHash: raw.lineage.qaSpecificationHash,
            executionHash: raw.lineage.executionHash,
            workflowHash: raw.lineage.workflowHash,
            generationHash: raw.lineage.generationHash,
            bundleHash: raw.lineage.bundleHash,
            bundleContentHash: raw.lineage.bundleContentHash,
            workspacePlanHash: raw.lineage.workspacePlanHash,
            workspaceHash: raw.lineage.workspaceHash,
            sandboxRequestHash: raw.lineage.sandboxRequestHash,
            sandboxResultHash: raw.lineage.sandboxResultHash,
            executionProfileHash: raw.lineage.executionProfileHash,
            generationProjectionHash: raw.lineage.generationProjectionHash,
            profileValidationHash: raw.lineage.profileValidationHash,
            factoryResultHash: raw.lineage.factoryResultHash,
          },
    provenance:
      raw.provenance === null
        ? null
        : {
            codeGeneratorAgentVersion: raw.provenance.codeGeneratorAgentVersion,
            codeGeneratorContractVersion: raw.provenance.codeGeneratorContractVersion,
            codeGeneratorAssetBundleHash: raw.provenance.codeGeneratorAssetBundleHash,
            executionProfileId: raw.provenance.executionProfileId,
            executionProfileVersion: raw.provenance.executionProfileVersion,
            executionProfileContractVersion: raw.provenance.executionProfileContractVersion,
            executionProfileHash: raw.provenance.executionProfileHash,
            generationProjectionHash: raw.provenance.generationProjectionHash,
            profileValidationHash: raw.provenance.profileValidationHash,
            workspaceVersion: raw.provenance.workspaceVersion,
            workspaceContractVersion: raw.provenance.workspaceContractVersion,
            workspacePolicyHash: raw.provenance.workspacePolicyHash,
            workspaceConfigurationHash: raw.provenance.workspaceConfigurationHash,
            sandboxRunnerVersion: raw.provenance.sandboxRunnerVersion,
            sandboxContractVersion: raw.provenance.sandboxContractVersion,
            sandboxSanitizerVersion: raw.provenance.sandboxSanitizerVersion,
            sandboxHelperAbiVersion: raw.provenance.sandboxHelperAbiVersion,
            sandboxDependencySnapshotHash: raw.provenance.sandboxDependencySnapshotHash,
            sandboxPolicyId: raw.provenance.sandboxPolicyId,
            sandboxPolicyVersion: raw.provenance.sandboxPolicyVersion,
            sandboxPolicyHash: raw.provenance.sandboxPolicyHash,
            sandboxCommandPolicyHash: raw.provenance.sandboxCommandPolicyHash,
            sandboxLimitsHash: raw.provenance.sandboxLimitsHash,
            sandboxAdapter: raw.provenance.sandboxAdapter,
            sandboxImageDigest: raw.provenance.sandboxImageDigest,
            sandboxImageId: raw.provenance.sandboxImageId,
            sandboxPlatform: raw.provenance.sandboxPlatform,
            sandboxRuntimeName: raw.provenance.sandboxRuntimeName,
            sandboxRuntimeVersion: raw.provenance.sandboxRuntimeVersion,
            toolchainVersions: Object.fromEntries(
              raw.toolchainVersions.map((entry) => [entry.name, entry.version]),
            ),
          },
  };
}

function mapRecord(value: unknown): ExecutionRecord {
  const raw = value as RawExecutionRecord;
  return immutableClone(
    executionRecordSchema.parse({
      storageId: raw.storageId,
      workflowId: raw.workflowId,
      executionId: raw.executionId,
      requestId: raw.requestId,
      traceId: raw.traceId,
      projectName: raw.projectName,
      status: raw.status,
      workflowStatus: raw.workflowStatus,
      readiness: raw.readiness,
      createdAt: raw.createdAt.toISOString(),
      startedAt: iso(raw.startedAt),
      finishedAt: iso(raw.finishedAt),
      durationMs: raw.durationMs,
      job:
        raw.job === null
          ? null
          : {
              jobId: raw.job.jobId,
              status: raw.job.status,
              queuedAt: raw.job.queuedAt.toISOString(),
              startedAt: iso(raw.job.startedAt),
              finishedAt: iso(raw.job.finishedAt),
            },
      metadata: {
        engineVersion: raw.engineVersion,
        contractVersion: raw.contractVersion,
        attempt: raw.attempt,
      },
      hashes: mapHashes(raw.hashes),
      failure:
        raw.failureKind === null || raw.failureCode === null
          ? null
          : {
              kind: raw.failureKind,
              code: raw.failureCode,
              sourceCode: raw.failureSourceCode,
            },
      lineage:
        raw.lineageOutput === null
          ? null
          : {
              outputs: {
                productOwnerSpecificationHash: raw.lineageOutput.productOwnerSpecificationHash,
                technicalSpecificationHash: raw.lineageOutput.technicalSpecificationHash,
                qaSpecificationHash: raw.lineageOutput.qaSpecificationHash,
              },
              handoffs: raw.lineageHandoffs.map((handoff) => ({
                from: handoff.fromStage,
                to: handoff.toStage,
                specification: handoff.specification,
                calculatedHash: handoff.calculatedHash,
                declaredHash: handoff.declaredHash,
                verified: handoff.verified,
              })),
            },
      provenance:
        raw.provenanceStages.length === 0
          ? null
          : {
              stages: raw.provenanceStages.map((stage) => ({
                stage: stage.stage,
                agent: stage.agent,
                executionId: stage.executionId,
                agentExecutionId: stage.agentExecutionId,
                agentVersion: stage.agentVersion,
                outcome: stage.outcome,
                readiness: stage.readiness,
                readinessDecision: stage.readinessDecision,
                assetBundleHash: stage.assetBundleHash,
                knowledgeContextHash: stage.knowledgeContextHash,
                promptHash: stage.promptHash,
                responseHash: stage.responseHash,
                validationHash: stage.validationHash,
                generationHash: stage.generationHash,
                artifactHashes: stage.artifactHashes.map((artifact) => artifact.hash),
              })),
            },
      factoryResult: mapFactoryResult(raw.factoryResult),
      observation: mapObservation(raw),
      lifecycle: raw.lifecycleEvents.map((event) => ({
        sequence: event.sequence,
        event: event.event,
        state: event.state,
        occurredAt: event.occurredAt.toISOString(),
        durationMs: event.durationMs,
      })),
      revision: raw.revision,
    }),
  );
}

function mapTechnicalCheckpoint(value: unknown): FactoryTechnicalCheckpointRecord {
  const raw = value as {
    payload: unknown;
    createdAt: Date;
    cleanup: null | {
      factoryResultHash: string;
      releaseStatus: string;
      completedAt: Date;
    };
  };
  return immutableClone(
    factoryTechnicalCheckpointRecordSchema.parse({
      checkpoint: raw.payload,
      createdAt: raw.createdAt.toISOString(),
      cleanup:
        raw.cleanup === null
          ? null
          : {
              factoryResultHash: raw.cleanup.factoryResultHash,
              releaseStatus: raw.cleanup.releaseStatus,
              completedAt: raw.cleanup.completedAt.toISOString(),
            },
    }),
  );
}

function mapTechnicalResumeAttempt(value: unknown): FactoryTechnicalResumeAttemptRecord {
  const raw = value as {
    attemptId: string;
    checkpointHash: string;
    ownerId: string;
    requestId: string;
    status: string;
    activePhase: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    heartbeatAt: Date | null;
    leaseExpiresAt: Date | null;
    pendingRecordedAt: Date | null;
    result: unknown | null;
    cleanupConfirmed: boolean;
    failureReasonCode: string | null;
    recoveryReasonCode: string | null;
  };
  return immutableClone(
    factoryTechnicalResumeAttemptRecordSchema.parse({
      attemptId: raw.attemptId,
      checkpointHash: raw.checkpointHash,
      ownerId: raw.ownerId,
      requestId: raw.requestId,
      status: raw.status,
      activePhase: raw.activePhase,
      startedAt: raw.startedAt.toISOString(),
      finishedAt: raw.finishedAt?.toISOString() ?? null,
      heartbeatAt: raw.heartbeatAt?.toISOString() ?? null,
      leaseExpiresAt: raw.leaseExpiresAt?.toISOString() ?? null,
      completionRecordedAt: raw.pendingRecordedAt?.toISOString() ?? null,
      result: raw.result,
      cleanupConfirmed: raw.cleanupConfirmed,
      failureReasonCode: raw.failureReasonCode,
      recoveryReasonCode: raw.recoveryReasonCode,
    }),
  );
}

function persistenceError(error: unknown): never {
  if (error instanceof ExecutionRepositoryError) throw error;
  const code =
    error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  if (code === 'P2002' || code === 'P2003') {
    throw new ExecutionRepositoryError('Conflito ao persistir o registro de execução.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
      cause: error,
    });
  }
  if (code === 'P2025') {
    throw new ExecutionRepositoryError('Registro de execução não encontrado.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
      cause: error,
    });
  }
  throw new ExecutionRepositoryError('Falha ao persistir o registro de execução.', {
    code: EXECUTION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
    cause: error,
  });
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return persistenceError(error);
  }
}

function observationData(snapshot: ExecutionObservabilitySnapshot) {
  const summary = snapshot.summary;
  return {
    observabilityVersion: snapshot.observabilityVersion,
    revision: snapshot.revision,
    executionId: snapshot.executionId,
    workflowId: snapshot.workflowId,
    requestId: snapshot.requestId,
    status: snapshot.status,
    updatedAt: new Date(snapshot.updatedAt),
    summaryWorkflowStatus: summary?.workflowStatus ?? null,
    summaryFactoryStatus:
      summary !== null && 'factoryStatus' in summary ? summary.factoryStatus : null,
    summaryFactoryResultHash:
      summary !== null && 'factoryResultHash' in summary ? summary.factoryResultHash : null,
    summaryReadinessFinal: summary?.readinessFinal ?? null,
    summaryTotalDurationMs: summary?.totalDurationMs ?? null,
    summaryTotalTokens: summary?.totalTokens ?? null,
    summaryCostAmount: summary?.totalCostEstimate?.amount ?? null,
    summaryCostCurrency: summary?.totalCostEstimate?.currency ?? null,
    summaryRateCardVersion: summary?.totalCostEstimate?.rateCardVersion ?? null,
  };
}

export class PrismaExecutionRecordRepository implements FactoryExecutionRecordRepository {
  private readonly repositoryAccess: PrismaExecutionRecordRepositoryAccess;

  constructor(
    private readonly client: DatabaseClient,
    access: PrismaExecutionRecordRepositoryAccess,
  ) {
    this.repositoryAccess = parseAccess(access);
  }

  private ownerIdForCreation(): string {
    if (this.repositoryAccess.access !== 'OWNER') {
      throw accessError('Criação de execução exige um repositório ligado a um usuário.');
    }
    return this.repositoryAccess.userId;
  }

  private assertLifecycleAccess(): void {
    if (this.repositoryAccess.access === 'GLOBAL_READ_ONLY') {
      throw accessError('A capability global de leitura não permite alterar execuções.');
    }
  }

  private publicReadWhere(): { readonly userId?: string } {
    if (this.repositoryAccess.access === 'INTERNAL') {
      throw accessError('A capability interna não permite consultas públicas de execução.');
    }
    return this.repositoryAccess.access === 'OWNER' ? { userId: this.repositoryAccess.userId } : {};
  }

  private lifecycleWhere(): { readonly userId?: string } {
    this.assertLifecycleAccess();
    return this.repositoryAccess.access === 'OWNER' ? { userId: this.repositoryAccess.userId } : {};
  }

  private async loadByJobIdForLifecycle(jobId: string): Promise<ExecutionRecord | null> {
    const record = await this.client.executionRecord.findFirst({
      where: { ...this.lifecycleWhere(), job: { is: { jobId } } },
      include: aggregateInclude,
    });
    return record === null ? null : mapRecord(record);
  }

  private async loadByWorkflowIdForLifecycle(workflowId: string): Promise<ExecutionRecord | null> {
    const record = await this.client.executionRecord.findFirst({
      where: { ...this.lifecycleWhere(), workflowId },
      include: aggregateInclude,
    });
    return record === null ? null : mapRecord(record);
  }

  private async replaceObservation(
    client: DatabaseClient,
    storageId: string,
    snapshot: ExecutionObservabilitySnapshot,
  ): Promise<void> {
    await client.executionStageMetric.deleteMany({
      where: { executionObservedStage: { executionObservationId: storageId } },
    });
    await client.executionObservationEvent.deleteMany({
      where: { executionObservationId: storageId },
    });
    await client.executionObservedStage.deleteMany({
      where: { executionObservationId: storageId },
    });
    await client.executionObservation.upsert({
      where: { executionRecordId: storageId },
      create: {
        executionRecordId: storageId,
        ...observationData(snapshot),
      },
      update: observationData(snapshot),
    });
    for (const [index, stage] of snapshot.stages.entries()) {
      const metrics = snapshot.stageMetrics.find((entry) => entry.stageId === stage.stageId);
      await client.executionObservedStage.create({
        data: {
          executionObservationId: storageId,
          ordinal: index,
          stageId: stage.stageId,
          stageName: stage.stageName,
          status: stage.status,
          startedAt: stage.startedAt === null ? null : new Date(stage.startedAt),
          finishedAt: stage.finishedAt === null ? null : new Date(stage.finishedAt),
          durationMs: stage.durationMs,
          requestId: stage.requestId,
          executionId: stage.executionId,
          ...(metrics === undefined
            ? {}
            : {
                metrics: {
                  create: {
                    stageId: metrics.stageId,
                    durationMs: metrics.durationMs,
                    promptBytes: metrics.promptBytes,
                    completionBytes: metrics.completionBytes,
                    inputTokens: metrics.inputTokens,
                    outputTokens: metrics.outputTokens,
                    totalTokens: metrics.totalTokens,
                    providerLatencyMs: metrics.providerLatencyMs,
                    validationDurationMs: metrics.validationDurationMs,
                    artifactGenerationDurationMs: metrics.artifactGenerationDurationMs,
                  },
                },
              }),
        },
      });
    }
    if (snapshot.events.length > 0) {
      await client.executionObservationEvent.createMany({
        data: snapshot.events.map((event) => ({
          executionObservationId: storageId,
          sequence: event.sequence,
          type: event.type,
          stageId: event.stageId,
          stageName: event.stageName,
          status: event.status,
          startedAt: event.startedAt === null ? null : new Date(event.startedAt),
          finishedAt: event.finishedAt === null ? null : new Date(event.finishedAt),
          durationMs: event.durationMs,
          requestId: event.requestId,
          executionId: event.executionId,
          errorCode: event.errorCode,
        })),
      });
    }
  }

  private async createFactoryResult(
    client: DatabaseClient,
    storageId: string,
    factory: NonNullable<ExecutionRecord['factoryResult']>,
  ): Promise<void> {
    const provenance = factory.provenance;
    await client.executionFactoryResult.create({
      data: {
        executionRecordId: storageId,
        factoryVersion: factory.factoryVersion,
        contractVersion: factory.contractVersion,
        status: factory.status,
        terminalStage: factory.terminalStage,
        startedAt: new Date(factory.startedAt),
        finishedAt: new Date(factory.finishedAt),
        durationMs: factory.durationMs,
        readiness: factory.readiness,
        factoryResultHash: factory.hashes.factoryResultHash,
        lineageHash: factory.hashes.lineageHash,
        provenanceHash: factory.hashes.provenanceHash,
        generationStatus: factory.generationStatus,
        generatedFileCount: factory.generatedFileCount,
        generatedTotalBytes: factory.generatedTotalBytes,
        workspaceId: factory.workspaceId,
        workspaceFileCount: factory.workspaceFileCount,
        workspaceTotalBytes: factory.workspaceTotalBytes,
        workspaceReleaseStatus: factory.workspaceReleaseStatus,
        sandboxStatus: factory.sandboxStatus,
        sandboxRunId: factory.sandboxRunId,
        sandboxResourceOutcome: factory.sandboxResourceOutcome,
        sandboxCleanupFailureCode: factory.sandboxCleanupFailureCode,
        sandboxCleanupSourceCode: factory.sandboxCleanupSourceCode,
        failureKind: factory.failure?.kind ?? null,
        failureCode: factory.failure?.code ?? null,
        failureSourceCode: factory.failure?.sourceCode ?? null,
        failureReasonCode: factory.failure?.reasonCode ?? null,
        failureProfileRuleId: factory.failure?.profileRuleId ?? null,
        failureDiagnosticCount: factory.failure?.diagnosticSummary?.diagnosticCount ?? null,
        failureDiagnosticTruncated: factory.failure?.diagnosticSummary?.truncated ?? null,
        ...(factory.failure?.diagnosticSummary === null ||
        factory.failure?.diagnosticSummary === undefined
          ? {}
          : {
              failureDiagnosticCodes: [...factory.failure.diagnosticSummary.diagnosticCodes],
            }),
        failureStageId: factory.failure?.stageId ?? null,
        stages: {
          create: factory.stages.map((stage, ordinal) => ({
            ordinal,
            stageId: stage.stageId,
            status: stage.status,
            startedAt: stage.startedAt === null ? null : new Date(stage.startedAt),
            finishedAt: stage.finishedAt === null ? null : new Date(stage.finishedAt),
            durationMs: stage.durationMs,
            outputHash: stage.outputHash,
            failureCode: stage.failureCode,
            reasonCode: stage.reasonCode,
            profileRuleId: stage.profileRuleId,
            diagnosticCount: stage.diagnosticSummary?.diagnosticCount ?? null,
            diagnosticTruncated: stage.diagnosticSummary?.truncated ?? null,
            ...(stage.diagnosticSummary === null
              ? {}
              : { diagnosticCodes: [...stage.diagnosticSummary.diagnosticCodes] }),
            resourceOutcome: stage.resourceOutcome,
          })),
        },
        lineage: { create: { ...factory.lineage } },
        provenance: {
          create: {
            codeGeneratorAgentVersion: provenance.codeGeneratorAgentVersion,
            codeGeneratorContractVersion: provenance.codeGeneratorContractVersion,
            codeGeneratorAssetBundleHash: provenance.codeGeneratorAssetBundleHash,
            executionProfileId: provenance.executionProfileId,
            executionProfileVersion: provenance.executionProfileVersion,
            executionProfileContractVersion: provenance.executionProfileContractVersion,
            executionProfileHash: provenance.executionProfileHash,
            generationProjectionHash: provenance.generationProjectionHash,
            profileValidationHash: provenance.profileValidationHash,
            workspaceVersion: provenance.workspaceVersion,
            workspaceContractVersion: provenance.workspaceContractVersion,
            workspacePolicyHash: provenance.workspacePolicyHash,
            workspaceConfigurationHash: provenance.workspaceConfigurationHash,
            sandboxRunnerVersion: provenance.sandboxRunnerVersion,
            sandboxContractVersion: provenance.sandboxContractVersion,
            sandboxSanitizerVersion: provenance.sandboxSanitizerVersion,
            sandboxHelperAbiVersion: provenance.sandboxHelperAbiVersion,
            sandboxDependencySnapshotHash: provenance.sandboxDependencySnapshotHash,
            sandboxPolicyId: provenance.sandboxPolicyId,
            sandboxPolicyVersion: provenance.sandboxPolicyVersion,
            sandboxPolicyHash: provenance.sandboxPolicyHash,
            sandboxCommandPolicyHash: provenance.sandboxCommandPolicyHash,
            sandboxLimitsHash: provenance.sandboxLimitsHash,
            sandboxAdapter: provenance.sandboxAdapter,
            sandboxImageDigest: provenance.sandboxImageDigest,
            sandboxImageId: provenance.sandboxImageId,
            sandboxPlatform: provenance.sandboxPlatform,
            sandboxRuntimeName: provenance.sandboxRuntimeName,
            sandboxRuntimeVersion: provenance.sandboxRuntimeVersion,
          },
        },
        toolchainVersions: {
          create: Object.entries(provenance.toolchainVersions).map(([name, version]) => ({
            name,
            version,
          })),
        },
      },
    });
  }

  async create(input: ExecutionRecordCreatedInput): Promise<ExecutionRecord> {
    const userId = this.ownerIdForCreation();
    const parsed = executionRecordCreatedInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Entrada de criação do registro inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const skeleton = createExecutionRecord('pending-storage-id', parsed.data);
      const record = await this.client.executionRecord.create({
        data: {
          userId,
          workflowId: skeleton.workflowId,
          requestId: skeleton.requestId,
          traceId: skeleton.traceId,
          projectName: skeleton.projectName,
          status: skeleton.status,
          createdAt: new Date(skeleton.createdAt),
          engineVersion: skeleton.metadata.engineVersion,
          contractVersion: skeleton.metadata.contractVersion,
          attempt: skeleton.metadata.attempt,
          hashes: { create: { ...skeleton.hashes } },
          lifecycleEvents: {
            create: skeleton.lifecycle.map((event) => ({
              sequence: event.sequence,
              event: event.event,
              state: event.state,
              occurredAt: new Date(event.occurredAt),
              durationMs: event.durationMs,
            })),
          },
        },
        include: aggregateInclude,
      });
      return mapRecord(record);
    });
  }

  async createQueued(input: ExecutionRecordQueuedInput): Promise<ExecutionRecord> {
    const userId = this.ownerIdForCreation();
    const parsed = executionRecordQueuedInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Entrada de enfileiramento inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const skeleton = createQueuedExecutionRecord('pending-storage-id', parsed.data);
      const record = await this.client.executionRecord.create({
        data: {
          userId,
          workflowId: skeleton.workflowId,
          executionId: skeleton.executionId,
          requestId: skeleton.requestId,
          traceId: skeleton.traceId,
          projectName: skeleton.projectName,
          status: skeleton.status,
          createdAt: new Date(skeleton.createdAt),
          engineVersion: skeleton.metadata.engineVersion,
          contractVersion: skeleton.metadata.contractVersion,
          attempt: skeleton.metadata.attempt,
          hashes: { create: { ...skeleton.hashes } },
          job: {
            create: {
              jobId: skeleton.job!.jobId,
              status: skeleton.job!.status,
              queuedAt: new Date(skeleton.job!.queuedAt),
            },
          },
          lifecycleEvents: {
            create: skeleton.lifecycle.map((event) => ({
              sequence: event.sequence,
              event: event.event,
              state: event.state,
              occurredAt: new Date(event.occurredAt),
              durationMs: event.durationMs,
            })),
          },
        },
        include: aggregateInclude,
      });
      return mapRecord(record);
    });
  }

  async markJobRunning(input: ExecutionRecordJobRunningInput): Promise<ExecutionRecord> {
    this.assertLifecycleAccess();
    const parsed = executionRecordJobRunningInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Entrada de início do job inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const current = await this.loadByJobIdForLifecycle(parsed.data.jobId);
      if (current === null) {
        throw new ExecutionRepositoryError('Job de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      const projected = projectJobRunningExecutionRecord(current, parsed.data);
      await this.client.$transaction([
        this.client.executionJob.update({
          where: { jobId: parsed.data.jobId, status: 'QUEUED' },
          data: { status: projected.job!.status, startedAt: new Date(projected.job!.startedAt!) },
        }),
        this.client.executionRecord.update({
          where: { storageId: projected.storageId },
          data: { revision: { increment: 1 } },
        }),
      ]);
      return (await this.loadByJobIdForLifecycle(parsed.data.jobId))!;
    });
  }

  async markJobTerminal(input: ExecutionRecordJobTerminalInput): Promise<ExecutionRecord> {
    this.assertLifecycleAccess();
    const parsed = executionRecordJobTerminalInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Entrada terminal do job inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const current = await this.loadByJobIdForLifecycle(parsed.data.jobId);
      if (current === null) {
        throw new ExecutionRepositoryError('Job de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      if (
        current.job?.status === parsed.data.status &&
        current.job.finishedAt === parsed.data.finishedAt
      ) {
        return current;
      }
      const projected = projectJobTerminalExecutionRecord(current, parsed.data);
      await this.client.$transaction([
        this.client.executionJob.update({
          where: { jobId: parsed.data.jobId, status: current.job!.status },
          data: {
            status: projected.job!.status,
            finishedAt: new Date(projected.job!.finishedAt!),
          },
        }),
        this.client.executionRecord.update({
          where: { storageId: projected.storageId },
          data: { revision: { increment: 1 } },
        }),
      ]);
      return (await this.loadByJobIdForLifecycle(parsed.data.jobId))!;
    });
  }

  async failInfrastructure(
    input: ExecutionRecordInfrastructureFailureInput,
  ): Promise<ExecutionRecord> {
    this.assertLifecycleAccess();
    const parsed = executionRecordInfrastructureFailureInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Entrada de falha infraestrutural inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const current = await this.loadByJobIdForLifecycle(parsed.data.jobId);
      if (current === null) {
        throw new ExecutionRepositoryError('Job de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      if (
        current.status === 'FAILED' &&
        current.job?.status === 'FAILED' &&
        current.finishedAt === parsed.data.finishedAt &&
        current.job.finishedAt === parsed.data.finishedAt &&
        current.failure?.kind === 'INFRASTRUCTURE' &&
        current.failure.code === parsed.data.code
      ) {
        return current;
      }
      const projected = projectInfrastructureFailedExecutionRecord(current, parsed.data);
      const terminalEvent = projected.lifecycle.at(-1)!;
      await this.client.executionRecord.update({
        where: {
          storageId: current.storageId,
          status: current.status,
          revision: current.revision,
        },
        data: {
          status: projected.status,
          workflowStatus: projected.workflowStatus,
          finishedAt: new Date(projected.finishedAt!),
          durationMs: projected.durationMs,
          failureKind: projected.failure!.kind,
          failureCode: projected.failure!.code,
          failureSourceCode: null,
          revision: { increment: 1 },
          job: {
            update: {
              status: projected.job!.status,
              finishedAt: new Date(projected.job!.finishedAt!),
            },
          },
          lifecycleEvents: {
            create: {
              sequence: terminalEvent.sequence,
              event: terminalEvent.event,
              state: terminalEvent.state,
              occurredAt: new Date(terminalEvent.occurredAt),
              durationMs: terminalEvent.durationMs,
            },
          },
        },
      });
      return (await this.loadByJobIdForLifecycle(parsed.data.jobId))!;
    });
  }

  async markRunning(input: ExecutionRecordRunningInput): Promise<ExecutionRecord> {
    this.assertLifecycleAccess();
    const parsed = executionRecordRunningInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Entrada de execução em andamento inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const current = await this.client.executionRecord.findFirst({
        where: { ...this.lifecycleWhere(), workflowId: parsed.data.workflowId },
        include: aggregateInclude,
      });
      if (current === null) {
        throw new ExecutionRepositoryError('Registro de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      const projected = projectRunningExecutionRecord(mapRecord(current), parsed.data.startedAt);
      const event = projected.lifecycle.at(-1)!;
      const updated = await this.client.executionRecord.update({
        where: { workflowId: projected.workflowId, status: 'CREATED' },
        data: {
          status: projected.status,
          startedAt: new Date(projected.startedAt!),
          revision: { increment: 1 },
          lifecycleEvents: {
            create: {
              sequence: event.sequence,
              event: event.event,
              state: event.state,
              occurredAt: new Date(event.occurredAt),
              durationMs: event.durationMs,
            },
          },
        },
        include: aggregateInclude,
      });
      return mapRecord(updated);
    });
  }

  async saveObservation(
    workflowId: string,
    snapshot: ExecutionObservabilitySnapshot,
  ): Promise<ExecutionRecord> {
    this.assertLifecycleAccess();
    return run(async () => {
      const record = await this.client.executionRecord.findFirst({
        where: { ...this.lifecycleWhere(), workflowId },
        include: aggregateInclude,
      });
      if (record === null) {
        throw new ExecutionRepositoryError('Registro de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      const current = mapRecord(record);
      if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(current.status)) return current;
      const projected = projectObservedExecutionRecord(current, snapshot);
      await this.client.$transaction(async (transaction) => {
        await transaction.executionRecord.update({
          where: { storageId: current.storageId },
          data: {
            executionId: projected.executionId,
            revision: { increment: 1 },
            ...(snapshot.summary === null
              ? {}
              : {
                  hashes: {
                    upsert: {
                      create: { ...snapshot.summary.hashes },
                      update: { ...snapshot.summary.hashes },
                    },
                  },
                }),
          },
        });
        await this.replaceObservation(
          transaction as unknown as DatabaseClient,
          current.storageId,
          snapshot,
        );
      });
      return (await this.loadByWorkflowIdForLifecycle(workflowId))!;
    });
  }

  async complete(
    workflowId: string,
    result: ExecutionResult,
    snapshot: ExecutionObservabilitySnapshot | null,
  ): Promise<ExecutionRecord> {
    this.assertLifecycleAccess();
    return run(async () => {
      const record = await this.client.executionRecord.findFirst({
        where: { ...this.lifecycleWhere(), workflowId },
        include: aggregateInclude,
      });
      if (record === null) {
        throw new ExecutionRepositoryError('Registro de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      const current = mapRecord(record);
      if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(current.status)) {
        if (
          current.executionId === result.executionId &&
          current.hashes.executionHash === result.hashes.executionHash
        ) {
          return current;
        }
        throw new ExecutionRepositoryError('Resultado terminal divergente.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      const projected = projectTerminalExecutionRecord(current, result, snapshot);
      const terminalEvent = projected.lifecycle.at(-1)!;

      await this.client.$transaction(async (transaction) => {
        await transaction.executionProvenanceArtifactHash.deleteMany({
          where: { executionProvenanceStage: { executionRecordId: current.storageId } },
        });
        await transaction.executionProvenanceStage.deleteMany({
          where: { executionRecordId: current.storageId },
        });
        await transaction.executionLineageHandoff.deleteMany({
          where: { executionRecordId: current.storageId },
        });
        await transaction.executionLineageOutput.deleteMany({
          where: { executionRecordId: current.storageId },
        });
        await transaction.executionRecord.update({
          where: { storageId: current.storageId },
          data: {
            executionId: projected.executionId,
            status: projected.status,
            workflowStatus: projected.workflowStatus,
            readiness: projected.readiness,
            startedAt: projected.startedAt === null ? null : new Date(projected.startedAt),
            finishedAt: new Date(projected.finishedAt!),
            durationMs: projected.durationMs,
            ...(projected.job === null
              ? {}
              : {
                  job: {
                    update: {
                      status: projected.job.status,
                      finishedAt: new Date(projected.job.finishedAt!),
                    },
                  },
                }),
            engineVersion: projected.metadata.engineVersion,
            contractVersion: projected.metadata.contractVersion,
            attempt: projected.metadata.attempt,
            revision: { increment: 1 },
            failureKind: projected.failure?.kind ?? null,
            failureCode: projected.failure?.code ?? null,
            failureSourceCode: projected.failure?.sourceCode ?? null,
            hashes: {
              upsert: {
                create: { ...projected.hashes },
                update: { ...projected.hashes },
              },
            },
            lifecycleEvents: {
              create: {
                sequence: terminalEvent.sequence,
                event: terminalEvent.event,
                state: terminalEvent.state,
                occurredAt: new Date(terminalEvent.occurredAt),
                durationMs: terminalEvent.durationMs,
              },
            },
            ...(projected.lineage === null
              ? {}
              : {
                  lineageOutput: { create: { ...projected.lineage.outputs } },
                  lineageHandoffs: {
                    create: projected.lineage.handoffs.map((handoff, ordinal) => ({
                      ordinal,
                      fromStage: handoff.from,
                      toStage: handoff.to,
                      specification: handoff.specification,
                      calculatedHash: handoff.calculatedHash,
                      declaredHash: handoff.declaredHash,
                      verified: handoff.verified,
                    })),
                  },
                }),
            ...(projected.provenance === null
              ? {}
              : {
                  provenanceStages: {
                    create: projected.provenance.stages.map((stage, ordinal) => ({
                      ordinal,
                      stage: stage.stage,
                      agent: stage.agent,
                      executionId: stage.executionId,
                      agentExecutionId: stage.agentExecutionId,
                      agentVersion: stage.agentVersion,
                      outcome: stage.outcome,
                      readiness: stage.readiness,
                      ...(stage.readinessDecision === null
                        ? {}
                        : {
                            readinessDecision: {
                              version: stage.readinessDecision.version,
                              readiness: stage.readinessDecision.readiness,
                              decisiveFactors: stage.readinessDecision.decisiveFactors.map(
                                (factor) => ({ ...factor }),
                              ),
                            },
                          }),
                      assetBundleHash: stage.assetBundleHash,
                      knowledgeContextHash: stage.knowledgeContextHash,
                      promptHash: stage.promptHash,
                      responseHash: stage.responseHash,
                      validationHash: stage.validationHash,
                      generationHash: stage.generationHash,
                      artifactHashes: {
                        create: stage.artifactHashes.map((hash, artifactOrdinal) => ({
                          ordinal: artifactOrdinal,
                          hash,
                        })),
                      },
                    })),
                  },
                }),
          },
        });
        if (snapshot !== null) {
          await this.replaceObservation(
            transaction as unknown as DatabaseClient,
            current.storageId,
            snapshot,
          );
        }
      });
      return (await this.loadByWorkflowIdForLifecycle(workflowId))!;
    });
  }

  async completeFactory(
    workflowId: string,
    result: FactoryExecutionResult,
    snapshot: FactoryExecutionObservabilitySnapshot | null,
  ): Promise<ExecutionRecord> {
    this.assertLifecycleAccess();
    return run(async () => {
      const record = await this.client.executionRecord.findFirst({
        where: { ...this.lifecycleWhere(), workflowId },
        include: aggregateInclude,
      });
      if (record === null) {
        throw new ExecutionRepositoryError('Registro de execução não encontrado.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      const current = mapRecord(record);
      if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(current.status)) {
        if (
          current.executionId === result.executionId &&
          current.factoryResult?.hashes.factoryResultHash === result.hashes.factoryResultHash
        ) {
          return current;
        }
        throw new ExecutionRepositoryError('Resultado terminal da Factory divergente.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      const projected = projectTerminalFactoryExecutionRecord(current, result, snapshot);
      const terminalEvent = projected.lifecycle.at(-1)!;

      await this.client.$transaction(async (transaction) => {
        await transaction.executionProvenanceArtifactHash.deleteMany({
          where: { executionProvenanceStage: { executionRecordId: current.storageId } },
        });
        await transaction.executionProvenanceStage.deleteMany({
          where: { executionRecordId: current.storageId },
        });
        await transaction.executionLineageHandoff.deleteMany({
          where: { executionRecordId: current.storageId },
        });
        await transaction.executionLineageOutput.deleteMany({
          where: { executionRecordId: current.storageId },
        });
        await transaction.executionRecord.update({
          where: { storageId: current.storageId },
          data: {
            executionId: projected.executionId,
            status: projected.status,
            workflowStatus: projected.workflowStatus,
            readiness: projected.readiness,
            startedAt: new Date(projected.startedAt!),
            finishedAt: new Date(projected.finishedAt!),
            durationMs: projected.durationMs,
            ...(projected.job === null
              ? {}
              : {
                  job: {
                    update: {
                      status: projected.job.status,
                      finishedAt: new Date(projected.job.finishedAt!),
                    },
                  },
                }),
            revision: { increment: 1 },
            failureKind: projected.failure?.kind ?? null,
            failureCode: projected.failure?.code ?? null,
            failureSourceCode: projected.failure?.sourceCode ?? null,
            hashes: {
              upsert: {
                create: { ...projected.hashes },
                update: { ...projected.hashes },
              },
            },
            lifecycleEvents: {
              create: {
                sequence: terminalEvent.sequence,
                event: terminalEvent.event,
                state: terminalEvent.state,
                occurredAt: new Date(terminalEvent.occurredAt),
                durationMs: terminalEvent.durationMs,
              },
            },
            ...(projected.lineage === null
              ? {}
              : {
                  lineageOutput: { create: { ...projected.lineage.outputs } },
                  lineageHandoffs: {
                    create: projected.lineage.handoffs.map((handoff, ordinal) => ({
                      ordinal,
                      fromStage: handoff.from,
                      toStage: handoff.to,
                      specification: handoff.specification,
                      calculatedHash: handoff.calculatedHash,
                      declaredHash: handoff.declaredHash,
                      verified: handoff.verified,
                    })),
                  },
                }),
            ...(projected.provenance === null
              ? {}
              : {
                  provenanceStages: {
                    create: projected.provenance.stages.map((stage, ordinal) => ({
                      ordinal,
                      stage: stage.stage,
                      agent: stage.agent,
                      executionId: stage.executionId,
                      agentExecutionId: stage.agentExecutionId,
                      agentVersion: stage.agentVersion,
                      outcome: stage.outcome,
                      readiness: stage.readiness,
                      ...(stage.readinessDecision === null
                        ? {}
                        : {
                            readinessDecision: {
                              version: stage.readinessDecision.version,
                              readiness: stage.readinessDecision.readiness,
                              decisiveFactors: stage.readinessDecision.decisiveFactors.map(
                                (factor) => ({ ...factor }),
                              ),
                            },
                          }),
                      assetBundleHash: stage.assetBundleHash,
                      knowledgeContextHash: stage.knowledgeContextHash,
                      promptHash: stage.promptHash,
                      responseHash: stage.responseHash,
                      validationHash: stage.validationHash,
                      generationHash: stage.generationHash,
                      artifactHashes: {
                        create: stage.artifactHashes.map((hash, artifactOrdinal) => ({
                          ordinal: artifactOrdinal,
                          hash,
                        })),
                      },
                    })),
                  },
                }),
          },
        });
        await this.createFactoryResult(
          transaction as unknown as DatabaseClient,
          current.storageId,
          projected.factoryResult!,
        );
        if (
          result.workspace.releaseStatus === 'RELEASED' ||
          result.workspace.releaseStatus === 'NOT_REQUIRED'
        ) {
          if (result.sandbox.cleanupFailure === null) {
            const checkpoint = await transaction.factoryTechnicalCheckpoint.findUnique({
              where: { executionRecordId: current.storageId },
              select: { checkpointHash: true },
            });
            if (checkpoint !== null) {
              await transaction.factoryTechnicalCheckpointCleanup.create({
                data: {
                  checkpointHash: checkpoint.checkpointHash,
                  factoryResultHash: result.hashes.factoryResultHash,
                  releaseStatus: result.workspace.releaseStatus,
                  completedAt: new Date(result.finishedAt),
                },
              });
            }
          }
        }
        if (snapshot !== null) {
          await this.replaceObservation(
            transaction as unknown as DatabaseClient,
            current.storageId,
            snapshot,
          );
        }
      });
      return (await this.loadByWorkflowIdForLifecycle(workflowId))!;
    });
  }

  async saveTechnicalCheckpoint(
    input: FactoryTechnicalCheckpointSaveInput,
  ): Promise<FactoryTechnicalCheckpointRecord> {
    this.assertLifecycleAccess();
    const parsed = factoryTechnicalCheckpointSaveInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Checkpoint técnico inválido.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const checkpoint = parsed.data.checkpoint;
      const source = await this.client.executionRecord.findFirst({
        where: {
          ...this.lifecycleWhere(),
          workflowId: checkpoint.source.workflowId,
          status: 'RUNNING',
        },
        select: { storageId: true, executionId: true },
      });
      if (
        source === null ||
        (source.executionId !== null && source.executionId !== checkpoint.source.executionId)
      ) {
        throw new ExecutionRepositoryError(
          'O checkpoint não pertence à execução RUNNING informada.',
          { code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT },
        );
      }
      const existing = await this.client.factoryTechnicalCheckpoint.findUnique({
        where: { executionRecordId: source.storageId },
        include: { cleanup: true },
      });
      if (existing !== null) {
        if (existing.checkpointHash !== checkpoint.checkpointHash) {
          throw new ExecutionRepositoryError(
            'A execução já possui um checkpoint técnico imutável divergente.',
            { code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT },
          );
        }
        return mapTechnicalCheckpoint(existing);
      }
      const created = await this.client.factoryTechnicalCheckpoint.create({
        data: {
          checkpointHash: checkpoint.checkpointHash,
          executionRecordId: source.storageId,
          sourceExecutionId: checkpoint.source.executionId,
          checkpointVersion: checkpoint.checkpointVersion,
          bundleHash: checkpoint.bundle.hashes.bundleHash,
          profileValidationHash: checkpoint.profileValidation.profileValidationHash,
          payload: checkpoint,
          createdAt: new Date(parsed.data.createdAt),
        },
        include: { cleanup: true },
      });
      return mapTechnicalCheckpoint(created);
    });
  }

  async findTechnicalCheckpointOwned(
    lookup: FactoryTechnicalCheckpointLookup,
  ): Promise<FactoryTechnicalCheckpointRecord | null> {
    const parsed = factoryTechnicalCheckpointLookupSchema.safeParse(lookup);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Consulta de checkpoint técnico inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    this.assertLifecycleAccess();
    if (
      this.repositoryAccess.access === 'OWNER' &&
      this.repositoryAccess.userId !== parsed.data.ownerId
    ) {
      return null;
    }
    return run(async () => {
      const checkpoint = await this.client.factoryTechnicalCheckpoint.findFirst({
        where: {
          sourceExecutionId: parsed.data.sourceExecutionId,
          executionRecord: { is: { userId: parsed.data.ownerId } },
        },
        include: { cleanup: true },
      });
      return checkpoint === null ? null : mapTechnicalCheckpoint(checkpoint);
    });
  }

  async createTechnicalResumeAttempt(
    input: FactoryTechnicalResumeAttemptCreateInput,
  ): Promise<FactoryTechnicalResumeAttemptRecord> {
    this.assertLifecycleAccess();
    const parsed = factoryTechnicalResumeAttemptCreateInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Tentativa técnica inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    if (
      this.repositoryAccess.access === 'OWNER' &&
      this.repositoryAccess.userId !== parsed.data.ownerId
    ) {
      throw new ExecutionRepositoryError('Checkpoint técnico não encontrado.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
      });
    }
    return run(async () =>
      this.client.$transaction(async (transaction) => {
        const eligible = await transaction.factoryTechnicalCheckpoint.findFirst({
          where: {
            checkpointHash: parsed.data.checkpointHash,
            executionRecord: { is: { userId: parsed.data.ownerId, status: 'FAILED' } },
            cleanup: { isNot: null },
            resumeAttempts: {
              none: {
                OR: [
                  { status: 'SUCCESS' },
                  { status: { not: 'RUNNING' }, cleanupConfirmed: false },
                ],
              },
            },
          },
          select: { checkpointHash: true },
        });
        if (eligible === null) {
          throw new ExecutionRepositoryError(
            'O checkpoint não está elegível para uma nova tentativa técnica.',
            { code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT },
          );
        }
        const created = await transaction.factoryTechnicalResumeAttempt.create({
          data: {
            attemptId: parsed.data.attemptId,
            checkpointHash: parsed.data.checkpointHash,
            activeCheckpointHash: parsed.data.checkpointHash,
            ownerId: parsed.data.ownerId,
            requestId: parsed.data.requestId,
            status: 'RUNNING',
            activePhase: 'EXECUTING',
            startedAt: new Date(parsed.data.startedAt),
            leaseId: parsed.data.leaseId,
            leaseVersion: parsed.data.leaseVersion,
            heartbeatAt: new Date(parsed.data.heartbeatAt),
            leaseExpiresAt: new Date(parsed.data.leaseExpiresAt),
            cleanupConfirmed: false,
          },
        });
        return mapTechnicalResumeAttempt(created);
      }),
    );
  }

  async renewTechnicalResumeAttemptLease(
    input: FactoryTechnicalResumeAttemptHeartbeatInput,
  ): Promise<boolean> {
    this.assertLifecycleAccess();
    const parsed = factoryTechnicalResumeAttemptHeartbeatInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Heartbeat da tentativa técnica inválido.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const transition = await this.client.factoryTechnicalResumeAttempt.updateMany({
        where: {
          attemptId: parsed.data.attemptId,
          status: 'RUNNING',
          activePhase: 'EXECUTING',
          leaseId: parsed.data.leaseId,
          leaseVersion: parsed.data.leaseVersion,
          heartbeatAt: { lte: new Date(parsed.data.heartbeatAt) },
          leaseExpiresAt: { gte: new Date(parsed.data.heartbeatAt) },
          AND: [{ leaseExpiresAt: { lte: new Date(parsed.data.leaseExpiresAt) } }],
          activeCheckpointHash: { not: null },
          ...(this.repositoryAccess.access === 'OWNER'
            ? { ownerId: this.repositoryAccess.userId }
            : {}),
        },
        data: {
          heartbeatAt: new Date(parsed.data.heartbeatAt),
          leaseExpiresAt: new Date(parsed.data.leaseExpiresAt),
        },
      });
      return transition.count === 1;
    });
  }

  async stageTechnicalResumeAttemptResult(
    input: FactoryTechnicalResumeAttemptStageResultInput,
  ): Promise<FactoryTechnicalResumeAttemptRecord> {
    this.assertLifecycleAccess();
    const parsed = factoryTechnicalResumeAttemptStageResultInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Journal da tentativa técnica inválido.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const current = await this.client.factoryTechnicalResumeAttempt.findFirst({
        where: {
          attemptId: parsed.data.attemptId,
          ...(this.repositoryAccess.access === 'OWNER'
            ? {
                ownerId: this.repositoryAccess.userId,
                checkpoint: {
                  is: {
                    executionRecord: { is: { userId: this.repositoryAccess.userId } },
                  },
                },
              }
            : {}),
        },
        include: {
          checkpoint: {
            include: {
              executionRecord: { select: { userId: true, workflowId: true } },
            },
          },
        },
      });
      if (current === null) {
        throw new ExecutionRepositoryError('Tentativa técnica não encontrada.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      if (current.status !== 'RUNNING') {
        if (current.resultHash === parsed.data.result.resultHash) {
          return mapTechnicalResumeAttempt(current);
        }
        throw new ExecutionRepositoryError('TECHNICAL_TERMINAL_RESULT_DIVERGENCE', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      if (
        current.activePhase === 'COMPLETION_PENDING' &&
        current.pendingResultHash === parsed.data.result.resultHash
      ) {
        return mapTechnicalResumeAttempt(current);
      }
      const checkpoint = factoryTechnicalCheckpointSchema.safeParse(current.checkpoint.payload);
      if (
        !checkpoint.success ||
        current.ownerId !== current.checkpoint.executionRecord.userId ||
        current.checkpointHash !== current.checkpoint.checkpointHash ||
        current.checkpoint.checkpointHash !== checkpoint.data.checkpointHash ||
        current.checkpoint.sourceExecutionId !== checkpoint.data.source.executionId ||
        current.checkpoint.executionRecord.workflowId !== checkpoint.data.source.workflowId ||
        current.attemptId !== parsed.data.result.attemptId ||
        parsed.data.result.checkpointHash !== checkpoint.data.checkpointHash ||
        parsed.data.result.sourceExecutionId !== checkpoint.data.source.executionId ||
        parsed.data.result.sourceWorkflowId !== checkpoint.data.source.workflowId ||
        Date.parse(parsed.data.result.startedAt) < current.startedAt.getTime() ||
        Date.parse(parsed.data.result.finishedAt) < current.startedAt.getTime()
      ) {
        throw new ExecutionRepositoryError(
          'A tentativa técnica não aceita este journal terminal.',
          { code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT },
        );
      }
      const transition = await this.client.factoryTechnicalResumeAttempt.updateMany({
        where: {
          attemptId: current.attemptId,
          checkpointHash: current.checkpointHash,
          activeCheckpointHash: current.checkpointHash,
          ownerId: current.ownerId,
          status: 'RUNNING',
          activePhase: 'EXECUTING',
          leaseId: parsed.data.leaseId,
          leaseVersion: parsed.data.leaseVersion,
          leaseExpiresAt: { gte: new Date(parsed.data.recordedAt) },
        },
        data: {
          activePhase: 'COMPLETION_PENDING',
          pendingResultHash: parsed.data.result.resultHash,
          pendingResult: parsed.data.result,
          pendingRecordedAt: new Date(parsed.data.recordedAt),
        },
      });
      if (transition.count !== 1) {
        throw new ExecutionRepositoryError('A lease da tentativa técnica não está ativa.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      const updated = await this.client.factoryTechnicalResumeAttempt.findUnique({
        where: { attemptId: current.attemptId },
      });
      if (updated === null) {
        throw new ExecutionRepositoryError('Tentativa técnica não encontrada após o journal.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      return mapTechnicalResumeAttempt(updated);
    });
  }

  async completeTechnicalResumeAttempt(
    input: FactoryTechnicalResumeAttemptCompleteInput,
  ): Promise<FactoryTechnicalResumeAttemptRecord> {
    this.assertLifecycleAccess();
    const parsed = factoryTechnicalResumeAttemptCompleteInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Resultado da tentativa técnica inválido.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const current = await this.client.factoryTechnicalResumeAttempt.findFirst({
        where: {
          attemptId: parsed.data.attemptId,
          ...(this.repositoryAccess.access === 'OWNER'
            ? {
                ownerId: this.repositoryAccess.userId,
                checkpoint: {
                  is: {
                    executionRecord: { is: { userId: this.repositoryAccess.userId } },
                  },
                },
              }
            : {}),
        },
        include: {
          checkpoint: {
            include: {
              executionRecord: { select: { userId: true, workflowId: true } },
            },
          },
        },
      });
      if (current === null) {
        throw new ExecutionRepositoryError('Tentativa técnica não encontrada.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      if (current.status !== 'RUNNING') {
        if (current.resultHash === parsed.data.pendingResultHash) {
          return mapTechnicalResumeAttempt(current);
        }
        throw new ExecutionRepositoryError('TECHNICAL_TERMINAL_RESULT_DIVERGENCE', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      const pendingResult = factoryTechnicalResumeResultSchema.safeParse(current.pendingResult);
      if (
        !pendingResult.success ||
        current.ownerId !== current.checkpoint.executionRecord.userId ||
        current.activePhase !== 'COMPLETION_PENDING' ||
        current.pendingResultHash !== parsed.data.pendingResultHash ||
        pendingResult.data.resultHash !== parsed.data.pendingResultHash
      ) {
        throw new ExecutionRepositoryError(
          'A tentativa técnica não possui este journal terminal.',
          {
            code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
          },
        );
      }
      const transition = await this.client.factoryTechnicalResumeAttempt.updateMany({
        where: {
          attemptId: current.attemptId,
          checkpointHash: current.checkpointHash,
          activeCheckpointHash: current.checkpointHash,
          ownerId: current.ownerId,
          status: 'RUNNING',
          activePhase: 'COMPLETION_PENDING',
          pendingResultHash: parsed.data.pendingResultHash,
        },
        data: {
          status: pendingResult.data.status,
          activePhase: null,
          activeCheckpointHash: null,
          finishedAt: new Date(pendingResult.data.finishedAt),
          resultHash: pendingResult.data.resultHash,
          result: pendingResult.data,
          pendingResultHash: null,
          pendingResult: Prisma.DbNull,
          leaseId: null,
          cleanupConfirmed: isTechnicalResumeResultCleanupConfirmed(pendingResult.data),
          failureReasonCode: pendingResult.data.failure?.reasonCode ?? null,
          recoveryReasonCode: null,
        },
      });
      if (transition.count !== 1) {
        throw new ExecutionRepositoryError('A tentativa técnica já está terminal.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      const updated = await this.client.factoryTechnicalResumeAttempt.findUnique({
        where: { attemptId: current.attemptId },
      });
      if (updated === null) {
        throw new ExecutionRepositoryError('Tentativa técnica não encontrada após finalização.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      return mapTechnicalResumeAttempt(updated);
    });
  }

  async failTechnicalResumeAttempt(
    input: FactoryTechnicalResumeAttemptFailInput,
  ): Promise<FactoryTechnicalResumeAttemptRecord> {
    this.assertLifecycleAccess();
    const parsed = factoryTechnicalResumeAttemptFailInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Falha da tentativa técnica inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    return run(async () => {
      const current = await this.client.factoryTechnicalResumeAttempt.findFirst({
        where: {
          attemptId: parsed.data.attemptId,
          ...(this.repositoryAccess.access === 'OWNER'
            ? {
                ownerId: this.repositoryAccess.userId,
                checkpoint: {
                  is: {
                    executionRecord: { is: { userId: this.repositoryAccess.userId } },
                  },
                },
              }
            : {}),
        },
        include: {
          checkpoint: {
            include: { executionRecord: { select: { userId: true } } },
          },
        },
      });
      if (current === null) {
        throw new ExecutionRepositoryError('Tentativa técnica não encontrada.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      if (current.ownerId !== current.checkpoint.executionRecord.userId) {
        throw new ExecutionRepositoryError(
          'A tentativa técnica não pertence ao checkpoint informado.',
          { code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT },
        );
      }
      if (
        current.status !== 'RUNNING' ||
        current.activePhase !== 'EXECUTING' ||
        current.leaseId !== parsed.data.leaseId ||
        current.leaseVersion !== parsed.data.leaseVersion ||
        Date.parse(parsed.data.finishedAt) < current.startedAt.getTime()
      ) {
        throw new ExecutionRepositoryError('A tentativa técnica já está terminal.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      const transition = await this.client.factoryTechnicalResumeAttempt.updateMany({
        where: {
          attemptId: current.attemptId,
          checkpointHash: current.checkpointHash,
          activeCheckpointHash: current.checkpointHash,
          ownerId: current.ownerId,
          status: 'RUNNING',
          activePhase: 'EXECUTING',
          leaseId: parsed.data.leaseId,
          leaseVersion: parsed.data.leaseVersion,
          leaseExpiresAt: { gte: new Date(parsed.data.finishedAt) },
        },
        data: {
          status: 'FAILED',
          activePhase: null,
          activeCheckpointHash: null,
          leaseId: null,
          finishedAt: new Date(parsed.data.finishedAt),
          cleanupConfirmed: parsed.data.cleanupConfirmed,
          failureReasonCode: parsed.data.reasonCode,
          recoveryReasonCode: null,
        },
      });
      if (transition.count !== 1) {
        throw new ExecutionRepositoryError('A tentativa técnica já está terminal.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      const updated = await this.client.factoryTechnicalResumeAttempt.findUnique({
        where: { attemptId: current.attemptId },
      });
      if (updated === null) {
        throw new ExecutionRepositoryError('Tentativa técnica não encontrada após finalização.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      return mapTechnicalResumeAttempt(updated);
    });
  }

  async findLatestTechnicalResumeAttemptOwned(
    lookup: FactoryTechnicalResumeAttemptLookup,
  ): Promise<FactoryTechnicalResumeAttemptRecord | null> {
    const parsed = factoryTechnicalResumeAttemptLookupSchema.safeParse(lookup);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Consulta de tentativa técnica inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    if (
      this.repositoryAccess.access === 'OWNER' &&
      this.repositoryAccess.userId !== parsed.data.ownerId
    ) {
      return null;
    }
    return run(async () => {
      const attemptWhere = {
        ownerId: parsed.data.ownerId,
        checkpoint: {
          is: {
            sourceExecutionId: parsed.data.sourceExecutionId,
            executionRecord: { is: { userId: parsed.data.ownerId } },
          },
        },
      } as const;
      const attempt =
        (await this.client.factoryTechnicalResumeAttempt.findFirst({
          where: { ...attemptWhere, status: 'RUNNING' },
          orderBy: [{ startedAt: 'desc' }, { attemptId: 'desc' }],
        })) ??
        (await this.client.factoryTechnicalResumeAttempt.findFirst({
          where: { ...attemptWhere, status: 'SUCCESS' },
          orderBy: [{ startedAt: 'desc' }, { attemptId: 'desc' }],
        })) ??
        (await this.client.factoryTechnicalResumeAttempt.findFirst({
          where: attemptWhere,
          orderBy: [{ startedAt: 'desc' }, { attemptId: 'desc' }],
        }));
      return attempt === null ? null : mapTechnicalResumeAttempt(attempt);
    });
  }

  async reconcileTechnicalResumeAttemptOwned(
    input: FactoryTechnicalResumeAttemptReconcileInput,
  ): Promise<FactoryTechnicalResumeReconciliation> {
    this.assertLifecycleAccess();
    const parsed = factoryTechnicalResumeAttemptReconcileInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Reconciliação da tentativa técnica inválida.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    if (
      this.repositoryAccess.access === 'OWNER' &&
      this.repositoryAccess.userId !== parsed.data.ownerId
    ) {
      return factoryTechnicalResumeReconciliationSchema.parse({ outcome: 'NONE', attempt: null });
    }
    return run(async () => {
      const attemptWhere = {
        ownerId: parsed.data.ownerId,
        checkpoint: {
          is: {
            sourceExecutionId: parsed.data.sourceExecutionId,
            executionRecord: { is: { userId: parsed.data.ownerId } },
          },
        },
      } as const;
      const loadPreferred = async () =>
        (await this.client.factoryTechnicalResumeAttempt.findFirst({
          where: { ...attemptWhere, status: 'RUNNING' },
          orderBy: [{ startedAt: 'desc' as const }, { attemptId: 'desc' as const }],
        })) ??
        (await this.client.factoryTechnicalResumeAttempt.findFirst({
          where: { ...attemptWhere, status: 'SUCCESS' },
          orderBy: [{ startedAt: 'desc' as const }, { attemptId: 'desc' as const }],
        })) ??
        (await this.client.factoryTechnicalResumeAttempt.findFirst({
          where: attemptWhere,
          orderBy: [{ startedAt: 'desc' as const }, { attemptId: 'desc' as const }],
        }));
      let attempt = await loadPreferred();
      if (attempt === null) {
        return factoryTechnicalResumeReconciliationSchema.parse({ outcome: 'NONE', attempt: null });
      }
      if (attempt.status !== 'RUNNING') {
        return factoryTechnicalResumeReconciliationSchema.parse({
          outcome: 'TERMINAL',
          attempt: mapTechnicalResumeAttempt(attempt),
        });
      }
      const pendingResult = factoryTechnicalResumeResultSchema.safeParse(attempt.pendingResult);
      if (
        attempt.activePhase === 'COMPLETION_PENDING' &&
        attempt.pendingResultHash !== null &&
        pendingResult.success &&
        pendingResult.data.resultHash === attempt.pendingResultHash
      ) {
        const terminal = await this.completeTechnicalResumeAttempt({
          attemptId: attempt.attemptId,
          pendingResultHash: attempt.pendingResultHash,
        });
        return factoryTechnicalResumeReconciliationSchema.parse({
          outcome: 'FINALIZED',
          attempt: terminal,
        });
      }
      if (
        attempt.activePhase === 'EXECUTING' &&
        attempt.leaseExpiresAt !== null &&
        attempt.leaseExpiresAt.getTime() > Date.parse(parsed.data.observedAt)
      ) {
        return factoryTechnicalResumeReconciliationSchema.parse({
          outcome: 'ACTIVE',
          attempt: mapTechnicalResumeAttempt(attempt),
        });
      }
      const reasonCode =
        attempt.activePhase === 'COMPLETION_PENDING'
          ? 'TECHNICAL_COMPLETION_JOURNAL_INVALID'
          : (attempt.recoveryReasonCode ?? 'TECHNICAL_ATTEMPT_LEASE_EXPIRED');
      if (attempt.activePhase !== 'RECOVERY_REQUIRED') {
        const transition = await this.client.factoryTechnicalResumeAttempt.updateMany({
          where: {
            attemptId: attempt.attemptId,
            checkpointHash: attempt.checkpointHash,
            activeCheckpointHash: attempt.checkpointHash,
            ownerId: attempt.ownerId,
            status: 'RUNNING',
            activePhase: attempt.activePhase,
            ...(attempt.activePhase === 'EXECUTING' && attempt.leaseExpiresAt !== null
              ? { leaseExpiresAt: { lte: new Date(parsed.data.observedAt) } }
              : {}),
          },
          data: {
            activePhase: 'RECOVERY_REQUIRED',
            leaseId: null,
            recoveryReasonCode: reasonCode,
          },
        });
        if (transition.count !== 1) {
          attempt = await loadPreferred();
          if (attempt === null) {
            return factoryTechnicalResumeReconciliationSchema.parse({
              outcome: 'NONE',
              attempt: null,
            });
          }
          if (attempt.status !== 'RUNNING') {
            return factoryTechnicalResumeReconciliationSchema.parse({
              outcome: 'TERMINAL',
              attempt: mapTechnicalResumeAttempt(attempt),
            });
          }
          const reloadedPendingResult = factoryTechnicalResumeResultSchema.safeParse(
            attempt.pendingResult,
          );
          if (
            attempt.activePhase === 'COMPLETION_PENDING' &&
            attempt.pendingResultHash !== null &&
            reloadedPendingResult.success &&
            reloadedPendingResult.data.resultHash === attempt.pendingResultHash
          ) {
            const terminal = await this.completeTechnicalResumeAttempt({
              attemptId: attempt.attemptId,
              pendingResultHash: attempt.pendingResultHash,
            });
            return factoryTechnicalResumeReconciliationSchema.parse({
              outcome: 'FINALIZED',
              attempt: terminal,
            });
          }
          if (attempt.activePhase === 'EXECUTING') {
            return factoryTechnicalResumeReconciliationSchema.parse({
              outcome: 'ACTIVE',
              attempt: mapTechnicalResumeAttempt(attempt),
            });
          }
        } else {
          attempt = await this.client.factoryTechnicalResumeAttempt.findUnique({
            where: { attemptId: attempt.attemptId },
          });
        }
      }
      if (attempt === null) {
        throw new ExecutionRepositoryError('Tentativa técnica não encontrada após recovery.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.NOT_FOUND,
        });
      }
      return factoryTechnicalResumeReconciliationSchema.parse({
        outcome: 'RECOVERY_REQUIRED',
        attempt: mapTechnicalResumeAttempt(attempt),
      });
    });
  }

  async findByExecutionId(executionId: string): Promise<ExecutionRecord | null> {
    const accessWhere = this.publicReadWhere();
    return run(async () => {
      const record = await this.client.executionRecord.findFirst({
        where: { ...accessWhere, executionId },
        include: aggregateInclude,
      });
      return record === null ? null : mapRecord(record);
    });
  }

  async findByJobId(jobId: string): Promise<ExecutionRecord | null> {
    const accessWhere = this.publicReadWhere();
    return run(async () => {
      const record = await this.client.executionRecord.findFirst({
        where: { ...accessWhere, job: { is: { jobId } } },
        include: aggregateInclude,
      });
      return record === null ? null : mapRecord(record);
    });
  }

  async findByWorkflowId(workflowId: string): Promise<ExecutionRecord | null> {
    if (this.repositoryAccess.access === 'INTERNAL') {
      return run(() => this.loadByWorkflowIdForLifecycle(workflowId));
    }
    const accessWhere = this.publicReadWhere();
    return run(async () => {
      const record = await this.client.executionRecord.findFirst({
        where: { ...accessWhere, workflowId },
        include: aggregateInclude,
      });
      return record === null ? null : mapRecord(record);
    });
  }

  async list(rawQuery: ExecutionRecordListQuery = {}): Promise<ExecutionRecordPage> {
    const accessWhere = this.publicReadWhere();
    const parsed = executionRecordListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ExecutionRepositoryError('Filtros de execução inválidos.', {
        code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
        cause: parsed.error,
      });
    }
    const query = parsed.data;
    return run(async () => {
      if (query.cursor !== undefined) {
        const cursor = await this.client.executionRecord.findFirst({
          where: { ...accessWhere, workflowId: query.cursor },
          select: { workflowId: true },
        });
        if (cursor === null) {
          throw new ExecutionRepositoryError('Cursor de execução inválido.', {
            code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
          });
        }
      }
      const records = await this.client.executionRecord.findMany({
        where: {
          ...accessWhere,
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.readiness === undefined ? {} : { readiness: query.readiness }),
          ...(query.createdAfter === undefined && query.createdBefore === undefined
            ? {}
            : {
                createdAt: {
                  ...(query.createdAfter === undefined
                    ? {}
                    : { gte: new Date(query.createdAfter) }),
                  ...(query.createdBefore === undefined
                    ? {}
                    : { lte: new Date(query.createdBefore) }),
                },
              }),
        },
        orderBy: [{ createdAt: 'desc' }, { workflowId: 'desc' }],
        ...(query.cursor === undefined ? {} : { cursor: { workflowId: query.cursor }, skip: 1 }),
        take: query.limit + 1,
        include: aggregateInclude,
      });
      const hasMore = records.length > query.limit;
      const page = records.slice(0, query.limit).map(mapRecord);
      return immutableClone({
        items: page,
        nextCursor: hasMore ? page.at(-1)!.workflowId : null,
      });
    });
  }
}
