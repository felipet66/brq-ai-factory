import type { ExecutionRecord } from '@brq/execution-repository';

import { safePublicFactoryProfileRuleId } from '@/api/factory-profile-rule-contracts';
import { safePublicTypeScriptDiagnosticSummary } from '@/api/typescript-diagnostic-contracts';

import { executionHistoryDetailSchema, executionHistoryItemSchema } from './schemas';

export function toExecutionHistoryItem(record: ExecutionRecord) {
  return executionHistoryItemSchema.parse({
    executionId: record.executionId,
    workflowId: record.workflowId,
    projectName: record.projectName,
    status: record.status,
    readiness: record.readiness,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: record.durationMs,
  });
}

export function toExecutionHistoryDetail(record: ExecutionRecord) {
  if (record.executionId === null) {
    throw new TypeError('A persisted execution detail requires an executionId.');
  }

  return executionHistoryDetailSchema.parse({
    ...toExecutionHistoryItem(record),
    executionId: record.executionId,
    createdAt: record.createdAt,
    requestId: record.requestId,
    metadata: record.metadata,
    job: record.job,
    hashes: record.hashes,
    lineage:
      record.lineage === null
        ? null
        : {
            outputs: record.lineage.outputs,
            handoffs: record.lineage.handoffs.map((handoff) => ({
              from: handoff.from,
              to: handoff.to,
              specification: handoff.specification,
              verified: handoff.verified,
            })),
          },
    provenance:
      record.provenance === null
        ? null
        : {
            stages: record.provenance.stages.map((stage) => ({
              stage: stage.stage,
              agentVersion: stage.agentVersion,
              outcome: stage.outcome,
              readiness: stage.readiness,
              readinessDecision: stage.readinessDecision,
              hashes: {
                assetBundleHash: stage.assetBundleHash,
                knowledgeContextHash: stage.knowledgeContextHash,
                promptHash: stage.promptHash,
                responseHash: stage.responseHash,
                validationHash: stage.validationHash,
                generationHash: stage.generationHash,
                artifactHashes: stage.artifactHashes,
              },
            })),
          },
    factoryResult:
      record.factoryResult === null
        ? null
        : {
            ...record.factoryResult,
            hashes: { ...record.factoryResult.hashes },
            failure:
              record.factoryResult.failure === null
                ? null
                : {
                    ...record.factoryResult.failure,
                    profileRuleId:
                      record.factoryResult.terminalStage === 'CODE_PROFILE_VALIDATION' &&
                      record.factoryResult.failure.stageId === 'CODE_PROFILE_VALIDATION'
                        ? safePublicFactoryProfileRuleId(record.factoryResult.failure.profileRuleId)
                        : null,
                    diagnosticSummary:
                      record.factoryResult.terminalStage === 'SANDBOX_TYPECHECK' &&
                      record.factoryResult.failure.stageId === 'SANDBOX_TYPECHECK' &&
                      record.factoryResult.failure.reasonCode === 'TYPESCRIPT_DIAGNOSTICS'
                        ? safePublicTypeScriptDiagnosticSummary(
                            record.factoryResult.failure.diagnosticSummary,
                          )
                        : null,
                  },
            stages: record.factoryResult.stages.map((stage) => ({
              ...stage,
              profileRuleId:
                stage.stageId === 'CODE_PROFILE_VALIDATION' && stage.status === 'FAILED'
                  ? safePublicFactoryProfileRuleId(stage.profileRuleId)
                  : null,
              diagnosticSummary:
                stage.stageId === 'SANDBOX_TYPECHECK' &&
                stage.status === 'FAILED' &&
                stage.reasonCode === 'TYPESCRIPT_DIAGNOSTICS'
                  ? safePublicTypeScriptDiagnosticSummary(stage.diagnosticSummary)
                  : null,
            })),
            lineage: { ...record.factoryResult.lineage },
            provenance: {
              ...record.factoryResult.provenance,
              toolchainVersions: { ...record.factoryResult.provenance.toolchainVersions },
            },
          },
  });
}
