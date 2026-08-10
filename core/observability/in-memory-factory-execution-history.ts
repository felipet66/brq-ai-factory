import type { FactoryExecutionResult } from '@brq/factory-pipeline';
import type { ExecutionRequest } from '@brq/execution-engine';
import type { LogLevel } from '@brq/shared/logger/logger';

import type {
  CreateInMemoryExecutionHistoryOptions,
  ExecutionStageMetrics,
  FactoryExecutionHistoryRecorder,
  FactoryExecutionObservabilityEvent,
  FactoryExecutionObservabilitySnapshot,
  FactoryExecutionStage,
  FactoryExecutionTimelineStageId,
  ObservableAgentStageId,
  ObservabilityStatus,
} from './contracts';
import { OBSERVABILITY_ERROR_CODES, ObservabilityError } from './errors';
import { deepFreeze } from './immutability';
import {
  DEFAULT_EXECUTION_HISTORY_MAX_ENTRIES,
  MAX_EXECUTION_HISTORY_ENTRIES,
} from './in-memory-execution-history';
import { factoryExecutionObservabilitySnapshotSchema } from './schemas';
import { emptyStageMetrics } from './stage-metrics';

export const FACTORY_OBSERVABILITY_VERSION = '2.0.0';

const STAGE_ORDER = [
  'KNOWLEDGE',
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'CODE_GENERATOR',
  'WORKSPACE',
  'SANDBOX_PREPARE',
  'SANDBOX_TYPECHECK',
  'SANDBOX_BUILD',
  'SANDBOX_TEST',
] as const satisfies readonly FactoryExecutionTimelineStageId[];
const AGENT_STAGE_ORDER = ['PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const;
const EXECUTION_ID_PATTERN = /^execution-[a-f0-9]{32}$/;
const CAPTURED_EVENTS = new Set([
  'execution.started',
  'product_owner.agent.started',
  'product_owner.knowledge.loaded',
  'workflow.stage.started',
  'workflow.stage.completed',
  'workflow.stage.rejected',
  'workflow.failed',
  'workflow.cancelled',
  'agent.run.completed',
  'response.validation.accepted',
  'response.validation.rejected',
  'response.validation.failed',
  'artifact.generation.completed',
  'artifact.generation.failed',
  'factory.pipeline.started',
  'factory.pipeline.completed',
  'factory.pipeline.failed',
  'factory.pipeline.cancelled',
  'factory.stage.started',
  'factory.stage.completed',
  'factory.stage.failed',
  'factory.stage.cancelled',
  'factory.stage.skipped',
]);

const STAGE_NAMES: Record<FactoryExecutionTimelineStageId, string> = {
  KNOWLEDGE: 'Knowledge',
  PRODUCT_OWNER: 'Product Owner',
  DEVELOPER: 'Developer',
  QA: 'QA',
  CODE_GENERATOR: 'Code Generator',
  WORKSPACE: 'Workspace',
  SANDBOX_PREPARE: 'Sandbox Prepare',
  SANDBOX_TYPECHECK: 'Sandbox Typecheck',
  SANDBOX_BUILD: 'Sandbox Build',
  SANDBOX_TEST: 'Sandbox Test',
};

interface MutableStage {
  readonly stageId: FactoryExecutionTimelineStageId;
  status: ObservabilityStatus;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  durationMs: number | null;
}

interface MutableFactoryRecord {
  readonly workflowId: string;
  readonly requestId: string | null;
  readonly agentStages: ReadonlyMap<string, ObservableAgentStageId>;
  executionId: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  revision: number;
  updatedAtMs: number;
  lastTimestampMs: number;
  readonly events: FactoryExecutionObservabilityEvent[];
  readonly stages: Map<FactoryExecutionTimelineStageId, MutableStage>;
  readonly metrics: Map<ObservableAgentStageId, ExecutionStageMetrics>;
  summary: FactoryExecutionObservabilitySnapshot['summary'];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asExecutionId(value: unknown): string | null {
  const id = asString(value);
  return id !== null && EXECUTION_ID_PATTERN.test(id) ? id : null;
}

function asMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function errorCode(context: Readonly<Record<string, unknown>>): string | null {
  const direct = asString(context.errorCode);
  if (direct !== null) return direct;
  const nested = context.error;
  return nested !== null && typeof nested === 'object'
    ? asString((nested as Readonly<Record<string, unknown>>).code)
    : null;
}

function iso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function elapsed(startedAtMs: number, finishedAtMs: number): number {
  return Math.max(0, finishedAtMs - startedAtMs);
}

function assertOptions(options: CreateInMemoryExecutionHistoryOptions): number {
  const maxEntries = options.maxEntries ?? DEFAULT_EXECUTION_HISTORY_MAX_ENTRIES;
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > MAX_EXECUTION_HISTORY_ENTRIES ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new ObservabilityError(
      'Configuração do histórico da Factory inválida.',
      OBSERVABILITY_ERROR_CODES.INVALID_CONFIGURATION,
    );
  }
  return maxEntries;
}

function initialStages(): Map<FactoryExecutionTimelineStageId, MutableStage> {
  return new Map(
    STAGE_ORDER.map((stageId) => [
      stageId,
      { stageId, status: 'PENDING', startedAtMs: null, finishedAtMs: null, durationMs: null },
    ]),
  );
}

function initialMetrics(): Map<ObservableAgentStageId, ExecutionStageMetrics> {
  return new Map(AGENT_STAGE_ORDER.map((stageId) => [stageId, emptyStageMetrics(stageId)]));
}

function factoryStageId(value: unknown): FactoryExecutionTimelineStageId | null {
  const stage = asString(value);
  if (
    stage === 'PRODUCT_OWNER' ||
    stage === 'DEVELOPER' ||
    stage === 'QA' ||
    stage === 'CODE_GENERATOR' ||
    stage === 'SANDBOX_PREPARE' ||
    stage === 'SANDBOX_TYPECHECK' ||
    stage === 'SANDBOX_BUILD' ||
    stage === 'SANDBOX_TEST'
  ) {
    return stage;
  }
  if (
    stage === 'WORKSPACE_PLAN' ||
    stage === 'WORKSPACE_MATERIALIZATION' ||
    stage === 'WORKSPACE_RELEASE'
  ) {
    return 'WORKSPACE';
  }
  return null;
}

function totalTokens(metrics: readonly ExecutionStageMetrics[]): number {
  return metrics.reduce((total, stage) => {
    const next = total + (stage.totalTokens ?? 0);
    if (!Number.isSafeInteger(next))
      throw new RangeError('Token total exceeds safe integer range.');
    return next;
  }, 0);
}

export function createInMemoryFactoryExecutionHistory(
  options: CreateInMemoryExecutionHistoryOptions = {},
): FactoryExecutionHistoryRecorder {
  const maxEntries = assertOptions(options);
  const now = options.now ?? Date.now;
  const records = new Map<string, MutableFactoryRecord>();
  const aliases = new Map<string, MutableFactoryRecord>();

  const touch = (record: MutableFactoryRecord): void => {
    record.revision += 1;
  };

  const observeTime = (record: MutableFactoryRecord): number => {
    const value = now();
    if (!Number.isFinite(value)) return record.lastTimestampMs;
    record.lastTimestampMs = Math.max(record.lastTimestampMs, Math.max(0, Math.round(value)));
    record.updatedAtMs = record.lastTimestampMs;
    return record.lastTimestampMs;
  };

  const attachExecutionId = (record: MutableFactoryRecord, executionId: string): void => {
    if (record.executionId === executionId) return;
    if (record.executionId !== null) aliases.delete(record.executionId);
    record.executionId = executionId;
    aliases.set(executionId, record);
    touch(record);
  };

  const addEvent = (
    record: MutableFactoryRecord,
    type: FactoryExecutionObservabilityEvent['type'],
    stageId: FactoryExecutionObservabilityEvent['stageId'],
    status: ObservabilityStatus,
    at: number,
    values: {
      readonly startedAtMs?: number | null;
      readonly finishedAtMs?: number | null;
      readonly durationMs?: number | null;
      readonly errorCode?: string | null;
    } = {},
  ): void => {
    if (record.executionId === null || record.events.length >= 64) return;
    const stageName =
      stageId === 'EXECUTION'
        ? 'Execution'
        : stageId === 'FACTORY'
          ? 'Factory'
          : STAGE_NAMES[stageId];
    record.events.push(
      deepFreeze({
        sequence: record.events.length + 1,
        type,
        stageId,
        stageName,
        status,
        startedAt:
          values.startedAtMs === undefined || values.startedAtMs === null
            ? type.endsWith('.started')
              ? iso(at)
              : null
            : iso(values.startedAtMs),
        finishedAt:
          values.finishedAtMs === undefined || values.finishedAtMs === null
            ? type.endsWith('.started')
              ? null
              : iso(at)
            : iso(values.finishedAtMs),
        durationMs: values.durationMs ?? null,
        requestId: record.requestId,
        executionId: record.executionId,
        errorCode: values.errorCode ?? null,
      }),
    );
    touch(record);
  };

  const startStage = (
    record: MutableFactoryRecord,
    stageId: FactoryExecutionTimelineStageId,
    at: number,
  ): void => {
    const stage = record.stages.get(stageId)!;
    if (stage.status !== 'PENDING') return;
    stage.status = 'RUNNING';
    stage.startedAtMs = at;
    addEvent(record, 'stage.started', stageId, 'RUNNING', at);
  };

  const finishStage = (
    record: MutableFactoryRecord,
    stageId: FactoryExecutionTimelineStageId,
    status: Extract<ObservabilityStatus, 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED'>,
    at: number,
    code: string | null = null,
  ): void => {
    const stage = record.stages.get(stageId)!;
    if (stage.status !== 'PENDING' && stage.status !== 'RUNNING') return;
    stage.status = status;
    stage.finishedAtMs = status === 'SKIPPED' ? null : at;
    stage.durationMs =
      stage.startedAtMs === null || status === 'SKIPPED' ? null : elapsed(stage.startedAtMs, at);
    addEvent(
      record,
      status === 'FAILED' || status === 'CANCELLED' ? 'stage.failed' : 'stage.finished',
      stageId,
      status,
      at,
      {
        startedAtMs: stage.startedAtMs,
        finishedAtMs: stage.finishedAtMs,
        durationMs: stage.durationMs,
        errorCode: code,
      },
    );
  };

  const stageForContext = (
    record: MutableFactoryRecord,
    context: Readonly<Record<string, unknown>>,
  ): ObservableAgentStageId | null => {
    const explicit = asString(context.agent);
    if (explicit === 'PRODUCT_OWNER' || explicit === 'DEVELOPER' || explicit === 'QA') {
      return explicit;
    }
    const agentExecutionId = asString(context.agentExecutionId);
    return agentExecutionId === null ? null : (record.agentStages.get(agentExecutionId) ?? null);
  };

  const captureMetrics = (
    record: MutableFactoryRecord,
    event: string,
    context: Readonly<Record<string, unknown>>,
  ): void => {
    const stageId = stageForContext(record, context);
    if (stageId === null) return;
    const current = record.metrics.get(stageId)!;
    if (event === 'agent.run.completed') {
      const inputTokens = asMetric(context.usageInputCount);
      const outputTokens = asMetric(context.usageOutputCount);
      const combined =
        inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens;
      record.metrics.set(stageId, {
        ...current,
        promptBytes: asMetric(context.promptBytes),
        completionBytes: asMetric(context.bytesReceived),
        inputTokens,
        outputTokens,
        totalTokens: combined !== null && Number.isSafeInteger(combined) ? combined : null,
        providerLatencyMs: asMetric(context.providerDurationMs),
      });
      touch(record);
      return;
    }
    if (event.startsWith('response.validation.')) {
      record.metrics.set(stageId, {
        ...current,
        validationDurationMs: asMetric(context.durationMs),
      });
      touch(record);
      return;
    }
    if (event.startsWith('artifact.generation.')) {
      record.metrics.set(stageId, {
        ...current,
        artifactGenerationDurationMs: asMetric(context.durationMs),
      });
      touch(record);
    }
  };

  const projectStages = (
    record: MutableFactoryRecord,
    executionId: string,
  ): FactoryExecutionStage[] =>
    STAGE_ORDER.map((stageId) => {
      const stage = record.stages.get(stageId)!;
      return {
        stageId,
        stageName: STAGE_NAMES[stageId],
        status: stage.status,
        startedAt: stage.startedAtMs === null ? null : iso(stage.startedAtMs),
        finishedAt: stage.finishedAtMs === null ? null : iso(stage.finishedAtMs),
        durationMs: stage.durationMs,
        requestId: record.requestId,
        executionId,
      };
    });

  const snapshot = (record: MutableFactoryRecord): FactoryExecutionObservabilitySnapshot | null => {
    if (record.executionId === null) return null;
    const parsed = factoryExecutionObservabilitySnapshotSchema.safeParse({
      observabilityVersion: FACTORY_OBSERVABILITY_VERSION,
      revision: record.revision,
      executionId: record.executionId,
      workflowId: record.workflowId,
      requestId: record.requestId,
      status: record.status,
      updatedAt: iso(record.updatedAtMs),
      events: record.events,
      stages: projectStages(record, record.executionId),
      stageMetrics: AGENT_STAGE_ORDER.map((stageId) => record.metrics.get(stageId)!),
      summary: record.summary,
    });
    if (!parsed.success) {
      throw new ObservabilityError(
        'Snapshot de observabilidade da Factory inválido.',
        OBSERVABILITY_ERROR_CODES.INVALID_SNAPSHOT,
        { cause: parsed.error },
      );
    }
    return deepFreeze(parsed.data) as FactoryExecutionObservabilitySnapshot;
  };

  const findRecord = (context: Readonly<Record<string, unknown>>): MutableFactoryRecord | null => {
    for (const candidate of [context.executionId, context.workflowId, context.requestId]) {
      const id = asString(candidate);
      if (id !== null) {
        const record = aliases.get(id);
        if (record !== undefined) return record;
      }
    }
    return null;
  };

  const removeActiveAliases = (record: MutableFactoryRecord): void => {
    aliases.delete(record.workflowId);
    if (record.requestId !== null) aliases.delete(record.requestId);
  };

  const evict = (workflowId: string, record: MutableFactoryRecord): void => {
    records.delete(workflowId);
    for (const [alias, candidate] of aliases) {
      if (candidate === record) aliases.delete(alias);
    }
  };

  const history: FactoryExecutionHistoryRecorder = {
    beginFactory(request: ExecutionRequest): void {
      const existing = records.get(request.workflowId);
      if (existing !== undefined) evict(request.workflowId, existing);
      while (records.size >= maxEntries) {
        const oldestTerminal = [...records].find(([, record]) => record.status !== 'RUNNING');
        if (oldestTerminal === undefined) return;
        evict(oldestTerminal[0], oldestTerminal[1]);
      }
      const clock = now();
      const observedAt = Number.isFinite(clock) ? Math.max(0, Math.round(clock)) : 0;
      const record: MutableFactoryRecord = {
        workflowId: request.workflowId,
        requestId: request.requestId ?? null,
        agentStages: new Map([
          [request.agents.productOwner.agentExecutionId, 'PRODUCT_OWNER'],
          [request.agents.developer.agentExecutionId, 'DEVELOPER'],
          [request.agents.qa.agentExecutionId, 'QA'],
        ]),
        executionId: null,
        status: 'RUNNING',
        revision: 0,
        updatedAtMs: observedAt,
        lastTimestampMs: observedAt,
        events: [],
        stages: initialStages(),
        metrics: initialMetrics(),
        summary: null,
      };
      records.set(request.workflowId, record);
      aliases.set(request.workflowId, record);
      if (record.requestId !== null) aliases.set(record.requestId, record);
    },

    capture(_level: LogLevel, event: string, context: Readonly<Record<string, unknown>>): void {
      if (!CAPTURED_EVENTS.has(event)) return;
      const record = findRecord(context);
      if (record === null) return;
      const executionId = asExecutionId(context.executionId);
      if (executionId !== null) attachExecutionId(record, executionId);
      const at = observeTime(record);
      captureMetrics(record, event, context);

      if (event === 'execution.started' || event === 'factory.pipeline.started') {
        if (!record.events.some((entry) => entry.type === 'execution.started')) {
          addEvent(record, 'execution.started', 'EXECUTION', 'RUNNING', at);
        }
        return;
      }
      if (event === 'product_owner.agent.started') {
        startStage(record, 'KNOWLEDGE', at);
        return;
      }
      if (event === 'product_owner.knowledge.loaded') {
        finishStage(record, 'KNOWLEDGE', 'SUCCESS', at);
        startStage(record, 'PRODUCT_OWNER', at);
        return;
      }
      if (event === 'workflow.stage.started') {
        const stage = factoryStageId(context.stage);
        if (stage !== null) startStage(record, stage, at);
        return;
      }
      if (event === 'workflow.stage.completed' || event === 'workflow.stage.rejected') {
        const stage = factoryStageId(context.stage);
        if (stage !== null) {
          finishStage(
            record,
            stage,
            event.endsWith('rejected') ? 'FAILED' : 'SUCCESS',
            at,
            errorCode(context),
          );
          if (stage === 'PRODUCT_OWNER' || stage === 'DEVELOPER' || stage === 'QA') {
            const durationMs = asMetric(context.durationMs);
            if (durationMs !== null) {
              record.metrics.set(stage, { ...record.metrics.get(stage)!, durationMs });
              touch(record);
            }
          }
        }
        return;
      }
      if (event === 'workflow.failed' || event === 'workflow.cancelled') {
        const running = STAGE_ORDER.find(
          (stageId) => record.stages.get(stageId)!.status === 'RUNNING',
        );
        if (running !== undefined) {
          finishStage(
            record,
            running,
            event.endsWith('cancelled') ? 'CANCELLED' : 'FAILED',
            at,
            errorCode(context),
          );
        }
        return;
      }
      if (event.startsWith('factory.stage.')) {
        const rawStage = asString(context.stage);
        if (rawStage === 'WORKSPACE_RELEASE') return;
        const stage = factoryStageId(rawStage);
        if (stage === null) return;
        if (event === 'factory.stage.started') {
          startStage(record, stage, at);
          return;
        }
        if (
          stage === 'WORKSPACE' &&
          rawStage === 'WORKSPACE_PLAN' &&
          event === 'factory.stage.completed'
        ) {
          return;
        }
        const status =
          event === 'factory.stage.completed'
            ? 'SUCCESS'
            : event === 'factory.stage.cancelled'
              ? 'CANCELLED'
              : event === 'factory.stage.skipped'
                ? 'SKIPPED'
                : 'FAILED';
        finishStage(record, stage, status, at, errorCode(context));
      }
    },

    completeFactory(result: FactoryExecutionResult): void {
      const record = aliases.get(result.executionId) ?? aliases.get(result.workflowId);
      if (record === undefined) return;
      attachExecutionId(record, result.executionId);
      const at = Math.max(record.lastTimestampMs, Date.parse(result.finishedAt));
      record.lastTimestampMs = at;
      record.updatedAtMs = at;
      record.status = result.status;

      const byStage = new Map(result.stages.map((stage) => [stage.stageId, stage]));
      const sourceStages = new Map<
        Exclude<FactoryExecutionTimelineStageId, 'KNOWLEDGE'>,
        readonly FactoryExecutionResult['stages'][number][]
      >([
        ['PRODUCT_OWNER', [byStage.get('PRODUCT_OWNER')!]],
        ['DEVELOPER', [byStage.get('DEVELOPER')!]],
        ['QA', [byStage.get('QA')!]],
        ['CODE_GENERATOR', [byStage.get('CODE_GENERATOR')!]],
        ['WORKSPACE', [byStage.get('WORKSPACE_PLAN')!, byStage.get('WORKSPACE_MATERIALIZATION')!]],
        ['SANDBOX_PREPARE', [byStage.get('SANDBOX_PREPARE')!]],
        ['SANDBOX_TYPECHECK', [byStage.get('SANDBOX_TYPECHECK')!]],
        ['SANDBOX_BUILD', [byStage.get('SANDBOX_BUILD')!]],
        ['SANDBOX_TEST', [byStage.get('SANDBOX_TEST')!]],
      ]);

      for (const [stageId, sources] of sourceStages) {
        const stage = record.stages.get(stageId)!;
        const terminal =
          sources.find((source) => source.status === 'FAILED') ??
          sources.find((source) => source.status === 'CANCELLED');
        const status =
          terminal?.status ??
          (sources.every((source) => source.status === 'SKIPPED') ? 'SKIPPED' : 'SUCCESS');
        const executed = sources.filter((source) => source.status !== 'SKIPPED');
        const startedAtMs = executed
          .map((source) => source.startedAt)
          .filter((value): value is string => value !== null)
          .map(Date.parse)
          .sort((left, right) => left - right)[0];
        const finishedAtMs = executed
          .map((source) => source.finishedAt)
          .filter((value): value is string => value !== null)
          .map(Date.parse)
          .sort((left, right) => right - left)[0];
        const wasActive = stage.status === 'PENDING' || stage.status === 'RUNNING';
        if (status === 'SKIPPED') {
          if (wasActive) finishStage(record, stageId, 'SKIPPED', at);
          stage.status = 'SKIPPED';
          stage.startedAtMs = null;
          stage.finishedAtMs = null;
          stage.durationMs = null;
          continue;
        }
        if (wasActive) {
          if (stage.status === 'PENDING') startStage(record, stageId, at);
          finishStage(record, stageId, status, at, terminal?.failure?.code ?? null);
        }
        const projected = record.stages.get(stageId)!;
        projected.status = status;
        projected.startedAtMs = startedAtMs ?? projected.startedAtMs;
        projected.finishedAtMs = finishedAtMs ?? projected.finishedAtMs;
        projected.durationMs =
          projected.startedAtMs === null || projected.finishedAtMs === null
            ? null
            : elapsed(projected.startedAtMs, projected.finishedAtMs);
      }

      const knowledge = record.stages.get('KNOWLEDGE')!;
      if (knowledge.status === 'PENDING' || knowledge.status === 'RUNNING') {
        finishStage(record, 'KNOWLEDGE', 'SKIPPED', at);
      }
      const stages = projectStages(record, result.executionId);
      const metrics = AGENT_STAGE_ORDER.map((stageId) => record.metrics.get(stageId)!);
      record.summary = {
        executionId: result.executionId,
        workflowStatus: result.execution.status,
        factoryStatus: result.status,
        readinessFinal: result.execution.readiness,
        totalDurationMs: result.durationMs,
        totalTokens: totalTokens(metrics),
        totalCostEstimate: null,
        executedStages: stages
          .filter((stage) => stage.status !== 'PENDING' && stage.status !== 'SKIPPED')
          .map((stage) => stage.stageId),
        skippedStages: stages
          .filter((stage) => stage.status === 'PENDING' || stage.status === 'SKIPPED')
          .map((stage) => stage.stageId),
        hashes: result.execution.hashes,
        factoryResultHash: result.hashes.factoryResultHash,
      };
      addEvent(
        record,
        result.status === 'SUCCESS' ? 'execution.finished' : 'execution.failed',
        'FACTORY',
        result.status,
        at,
        {
          startedAtMs: Date.parse(result.startedAt),
          finishedAtMs: Date.parse(result.finishedAt),
          durationMs: result.durationMs,
          errorCode: result.failure?.code ?? null,
        },
      );
      removeActiveAliases(record);
      touch(record);
    },

    get(id: string): FactoryExecutionObservabilitySnapshot | null {
      const record = aliases.get(id);
      return record === undefined ? null : snapshot(record);
    },
  };

  return Object.freeze(history);
}
