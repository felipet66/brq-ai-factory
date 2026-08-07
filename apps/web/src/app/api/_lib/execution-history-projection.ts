import type { ExecutionRecord } from '@brq/execution-repository';

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
  });
}
