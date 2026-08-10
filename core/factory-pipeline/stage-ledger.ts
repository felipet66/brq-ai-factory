import type { FactoryPipelineFailure, FactoryPipelineStageResult } from './contracts';
import {
  FACTORY_PIPELINE_STAGE_IDS,
  transitionFactoryPipelineStage,
  type FactoryPipelineStageId,
  type FactoryPipelineStageStatus,
} from './state-machine';

interface MutableStage {
  readonly stageId: FactoryPipelineStageId;
  status: FactoryPipelineStageStatus;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  outputHash: string | null;
  failure: FactoryPipelineFailure | null;
}

export interface FactoryStageLedger {
  readonly start: (stage: FactoryPipelineStageId, timestampMs: number) => void;
  readonly finish: (
    stage: FactoryPipelineStageId,
    status: 'SUCCESS' | 'FAILED' | 'CANCELLED',
    timestampMs: number,
    outputHash?: string | null,
    failure?: FactoryPipelineFailure | null,
  ) => void;
  readonly replace: (stage: FactoryPipelineStageResult) => void;
  readonly skipPending: () => void;
  readonly result: () => readonly FactoryPipelineStageResult[];
  readonly statusOf: (stage: FactoryPipelineStageId) => FactoryPipelineStageStatus;
}

export function createFactoryStageLedger(
  initialStages: readonly FactoryPipelineStageResult[] = [],
): FactoryStageLedger {
  const stages = new Map<FactoryPipelineStageId, MutableStage>(
    FACTORY_PIPELINE_STAGE_IDS.map((stageId) => [
      stageId,
      {
        stageId,
        status: 'PENDING',
        startedAtMs: null,
        finishedAtMs: null,
        outputHash: null,
        failure: null,
      },
    ]),
  );

  const replace = (stage: FactoryPipelineStageResult): void => {
    stages.set(stage.stageId, {
      stageId: stage.stageId,
      status: stage.status,
      startedAtMs: stage.startedAt === null ? null : Date.parse(stage.startedAt),
      finishedAtMs: stage.finishedAt === null ? null : Date.parse(stage.finishedAt),
      outputHash: stage.outputHash,
      failure: stage.failure,
    });
  };
  initialStages.forEach(replace);

  return {
    start(stageId, timestampMs) {
      const stage = stages.get(stageId)!;
      stage.status = transitionFactoryPipelineStage(stage.status, 'RUNNING', stageId);
      stage.startedAtMs = timestampMs;
    },
    finish(stageId, status, timestampMs, outputHash = null, failure = null) {
      const stage = stages.get(stageId)!;
      stage.status = transitionFactoryPipelineStage(stage.status, status, stageId);
      stage.finishedAtMs = Math.max(stage.startedAtMs ?? timestampMs, timestampMs);
      stage.outputHash = outputHash;
      stage.failure = failure;
    },
    replace,
    skipPending() {
      for (const stage of stages.values()) {
        if (stage.status === 'PENDING') {
          stage.status = transitionFactoryPipelineStage(stage.status, 'SKIPPED', stage.stageId);
        }
      }
    },
    result() {
      return FACTORY_PIPELINE_STAGE_IDS.map((stageId) => {
        const stage = stages.get(stageId)!;
        if (stage.status === 'PENDING' || stage.status === 'RUNNING') {
          throw new Error(`Etapa ${stageId} não terminal.`);
        }
        if (stage.status === 'SKIPPED') {
          return {
            stageId,
            status: 'SKIPPED' as const,
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            outputHash: null,
            failure: null,
          };
        }
        const startedAtMs = stage.startedAtMs!;
        const finishedAtMs = stage.finishedAtMs!;
        return {
          stageId,
          status: stage.status,
          startedAt: new Date(startedAtMs).toISOString(),
          finishedAt: new Date(finishedAtMs).toISOString(),
          durationMs: Math.max(0, finishedAtMs - startedAtMs),
          outputHash: stage.outputHash,
          failure: stage.failure,
        };
      });
    },
    statusOf(stageId) {
      return stages.get(stageId)!.status;
    },
  };
}
