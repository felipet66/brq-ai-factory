import type { ExecutionRequest, ExecutionResult } from '@brq/execution-engine';
import type { LogLevel } from '@brq/shared/logger/logger';

import type {
  CreateInMemoryExecutionHistoryOptions,
  ExecutionHistoryRecorder,
  ExecutionObservabilityEvent,
  ExecutionObservabilitySnapshot,
  ExecutionObservabilitySummary,
  ExecutionStage,
  ExecutionStageMetrics,
  ObservableAgentStageId,
  ObservabilityStageId,
  ObservabilityStatus,
} from './contracts';
import { OBSERVABILITY_ERROR_CODES, ObservabilityError } from './errors';
import { createExecutionObservabilitySummary } from './execution-summary';
import { deepFreeze } from './immutability';
import { executionObservabilitySnapshotSchema } from './schemas';
import { emptyStageMetrics, stageMetricsFromResult } from './stage-metrics';

export const OBSERVABILITY_VERSION = '1.0.0';
export const DEFAULT_EXECUTION_HISTORY_MAX_ENTRIES = 100;
export const MAX_EXECUTION_HISTORY_ENTRIES = 10_000;

const STAGE_ORDER = ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const;
const AGENT_STAGE_ORDER = ['PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const;
const EXECUTION_ID_PATTERN = /^execution-[a-f0-9]{32}$/;
const CAPTURED_LOG_EVENTS = new Set([
  'execution.created',
  'execution.started',
  'execution.completed',
  'execution.failed',
  'execution.cancelled',
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
]);
const STAGE_NAMES: Record<ObservabilityStageId, string> = {
  EXECUTION: 'Execution',
  KNOWLEDGE: 'Knowledge',
  PRODUCT_OWNER: 'Product Owner',
  DEVELOPER: 'Developer',
  QA: 'QA',
  WORKFLOW: 'Workflow',
};

interface MutableStage {
  stageId: (typeof STAGE_ORDER)[number];
  status: ObservabilityStatus;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  durationMs: number | null;
}

interface MutableRecord {
  readonly workflowId: string;
  readonly requestId: string | null;
  readonly agentStages: ReadonlyMap<string, ObservableAgentStageId>;
  executionId: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  revision: number;
  updatedAtMs: number;
  lastTimestampMs: number;
  readonly events: ExecutionObservabilityEvent[];
  readonly stages: Map<MutableStage['stageId'], MutableStage>;
  readonly metrics: Map<ObservableAgentStageId, ExecutionStageMetrics>;
  summary: ExecutionObservabilitySummary | null;
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
  if (nested !== null && typeof nested === 'object') {
    return asString((nested as Readonly<Record<string, unknown>>).code);
  }
  return null;
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
      'Configuração do histórico de execução inválida.',
      OBSERVABILITY_ERROR_CODES.INVALID_CONFIGURATION,
    );
  }
  return maxEntries;
}

function initialStages(): Map<MutableStage['stageId'], MutableStage> {
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

function eventTime(event: ExecutionObservabilityEvent): number {
  return Date.parse(event.finishedAt ?? event.startedAt!);
}

export function createInMemoryExecutionHistory(
  options: CreateInMemoryExecutionHistoryOptions = {},
): ExecutionHistoryRecorder {
  const maxEntries = assertOptions(options);
  const now = options.now ?? Date.now;
  const records = new Map<string, MutableRecord>();
  const aliases = new Map<string, MutableRecord>();

  const observeTime = (record: MutableRecord): number => {
    const value = now();
    if (!Number.isFinite(value)) return record.lastTimestampMs;
    record.lastTimestampMs = Math.max(record.lastTimestampMs, Math.max(0, Math.round(value)));
    record.updatedAtMs = record.lastTimestampMs;
    return record.lastTimestampMs;
  };

  const touch = (record: MutableRecord): void => {
    record.revision += 1;
  };

  const attachExecutionId = (record: MutableRecord, executionId: string): void => {
    if (record.executionId === executionId) return;
    if (record.executionId !== null) aliases.delete(record.executionId);
    record.executionId = executionId;
    aliases.set(executionId, record);
    touch(record);
  };

  const addEvent = (
    record: MutableRecord,
    type: ExecutionObservabilityEvent['type'],
    stageId: ObservabilityStageId,
    status: ObservabilityStatus,
    at: number,
    options: {
      readonly startedAtMs?: number | null;
      readonly finishedAtMs?: number | null;
      readonly durationMs?: number | null;
      readonly errorCode?: string | null;
    } = {},
  ): void => {
    if (record.executionId === null) return;
    const event = deepFreeze({
      sequence: record.events.length + 1,
      type,
      stageId,
      stageName: STAGE_NAMES[stageId],
      status,
      startedAt:
        options.startedAtMs === undefined || options.startedAtMs === null
          ? type.endsWith('.started')
            ? iso(at)
            : null
          : iso(options.startedAtMs),
      finishedAt:
        options.finishedAtMs === undefined || options.finishedAtMs === null
          ? type.endsWith('.started')
            ? null
            : iso(at)
          : iso(options.finishedAtMs),
      durationMs: options.durationMs ?? null,
      requestId: record.requestId,
      executionId: record.executionId,
      errorCode: options.errorCode ?? null,
    });
    const previous = record.events.at(-1);
    if (previous !== undefined && eventTime(event) < eventTime(previous)) return;
    record.events.push(event);
    touch(record);
  };

  const startStage = (
    record: MutableRecord,
    stageId: MutableStage['stageId'],
    at: number,
  ): void => {
    const stage = record.stages.get(stageId)!;
    if (stage.status !== 'PENDING') return;
    stage.status = 'RUNNING';
    stage.startedAtMs = at;
    addEvent(record, 'stage.started', stageId, 'RUNNING', at);
  };

  const finishStage = (
    record: MutableRecord,
    stageId: MutableStage['stageId'],
    status: Extract<ObservabilityStatus, 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED'>,
    at: number,
    code: string | null = null,
  ): void => {
    const stage = record.stages.get(stageId)!;
    if (!['PENDING', 'RUNNING'].includes(stage.status)) return;
    stage.status = status;
    stage.finishedAtMs = at;
    stage.durationMs = stage.startedAtMs === null ? null : elapsed(stage.startedAtMs, at);
    addEvent(
      record,
      status === 'FAILED' || status === 'CANCELLED' ? 'stage.failed' : 'stage.finished',
      stageId,
      status,
      at,
      {
        startedAtMs: stage.startedAtMs,
        finishedAtMs: at,
        durationMs: stage.durationMs,
        errorCode: code,
      },
    );
  };

  const skipPendingStages = (record: MutableRecord, at: number): void => {
    for (const stageId of STAGE_ORDER) {
      if (record.stages.get(stageId)!.status === 'PENDING')
        finishStage(record, stageId, 'SKIPPED', at);
    }
  };

  const removeActiveAliases = (record: MutableRecord): void => {
    aliases.delete(record.workflowId);
    if (record.requestId !== null) aliases.delete(record.requestId);
  };

  const executionStartedAt = (record: MutableRecord): number | null => {
    const started = record.events.find((event) => event.type === 'execution.started')?.startedAt;
    return started === undefined || started === null ? null : Date.parse(started);
  };

  const evict = (workflowId: string, record: MutableRecord): void => {
    records.delete(workflowId);
    for (const [alias, aliasedRecord] of aliases) {
      if (aliasedRecord === record) aliases.delete(alias);
    }
  };

  const findRecord = (context: Readonly<Record<string, unknown>>): MutableRecord | null => {
    const candidates = [context.executionId, context.workflowId, context.requestId];
    for (const candidate of candidates) {
      const id = asString(candidate);
      if (id !== null) {
        const record = aliases.get(id);
        if (record !== undefined) return record;
      }
    }
    return null;
  };

  const stageForContext = (
    record: MutableRecord,
    context: Readonly<Record<string, unknown>>,
  ): ObservableAgentStageId | null => {
    const explicit = asString(context.agent);
    if (explicit === 'PRODUCT_OWNER' || explicit === 'DEVELOPER' || explicit === 'QA')
      return explicit;
    const agentExecutionId = asString(context.agentExecutionId);
    return agentExecutionId === null ? null : (record.agentStages.get(agentExecutionId) ?? null);
  };

  const captureMetrics = (
    record: MutableRecord,
    event: string,
    context: Readonly<Record<string, unknown>>,
  ): void => {
    const stageId = stageForContext(record, context);
    if (stageId === null) return;
    const current = record.metrics.get(stageId)!;
    if (event === 'agent.run.completed') {
      const inputTokens = asMetric(context.usageInputCount);
      const outputTokens = asMetric(context.usageOutputCount);
      const totalTokens =
        inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens;
      record.metrics.set(stageId, {
        ...current,
        promptBytes: asMetric(context.promptBytes),
        completionBytes: asMetric(context.bytesReceived),
        inputTokens,
        outputTokens,
        totalTokens: totalTokens !== null && Number.isSafeInteger(totalTokens) ? totalTokens : null,
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

  const projectStages = (record: MutableRecord, executionId: string): ExecutionStage[] => {
    return STAGE_ORDER.map((stageId) => {
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
  };

  const snapshot = (record: MutableRecord): ExecutionObservabilitySnapshot | null => {
    if (record.executionId === null) return null;
    const executionId = record.executionId;
    const stages = projectStages(record, executionId);
    const stageMetrics = AGENT_STAGE_ORDER.map((stageId) => record.metrics.get(stageId)!);
    const parsed = executionObservabilitySnapshotSchema.safeParse({
      observabilityVersion: OBSERVABILITY_VERSION,
      revision: record.revision,
      executionId,
      workflowId: record.workflowId,
      requestId: record.requestId,
      status: record.status,
      updatedAt: iso(record.updatedAtMs),
      events: record.events,
      stages,
      stageMetrics,
      summary: record.summary,
    });
    if (!parsed.success) {
      throw new ObservabilityError(
        'Snapshot de observabilidade inválido.',
        OBSERVABILITY_ERROR_CODES.INVALID_SNAPSHOT,
        { cause: parsed.error },
      );
    }
    return deepFreeze(parsed.data) as ExecutionObservabilitySnapshot;
  };

  const history: ExecutionHistoryRecorder = {
    begin(request: ExecutionRequest): void {
      const existing = records.get(request.workflowId);
      if (existing !== undefined) {
        evict(request.workflowId, existing);
      }
      while (records.size >= maxEntries) {
        const oldestTerminal = [...records].find(([, record]) => record.status !== 'RUNNING');
        if (oldestTerminal === undefined) return;
        evict(oldestTerminal[0], oldestTerminal[1]);
      }
      const clockValue = now();
      const observedAt = Number.isFinite(clockValue) ? Math.max(0, Math.round(clockValue)) : 0;
      const agentStages = new Map<string, ObservableAgentStageId>([
        [request.agents.productOwner.agentExecutionId, 'PRODUCT_OWNER'],
        [request.agents.developer.agentExecutionId, 'DEVELOPER'],
        [request.agents.qa.agentExecutionId, 'QA'],
      ]);
      const record: MutableRecord = {
        workflowId: request.workflowId,
        requestId: request.requestId ?? null,
        agentStages,
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
      if (!CAPTURED_LOG_EVENTS.has(event)) return;
      const record = findRecord(context);
      if (record === null) return;
      const executionId = asExecutionId(context.executionId);
      if (executionId !== null) attachExecutionId(record, executionId);
      const at = observeTime(record);
      captureMetrics(record, event, context);

      if (event === 'execution.started') {
        addEvent(record, 'execution.started', 'EXECUTION', 'RUNNING', at);
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
        const stage = asString(context.stage);
        if (stage === 'DEVELOPER' || stage === 'QA') startStage(record, stage, at);
        return;
      }
      if (event === 'workflow.stage.completed' || event === 'workflow.stage.rejected') {
        const stage = asString(context.stage);
        if (stage === 'PRODUCT_OWNER' || stage === 'DEVELOPER' || stage === 'QA') {
          finishStage(
            record,
            stage,
            event.endsWith('rejected') ? 'FAILED' : 'SUCCESS',
            at,
            errorCode(context),
          );
          const durationMs = asMetric(context.durationMs);
          if (durationMs !== null) {
            record.metrics.set(stage, { ...record.metrics.get(stage)!, durationMs });
            touch(record);
          }
        }
        return;
      }
      if (event === 'workflow.failed' || event === 'workflow.cancelled') {
        const status = event.endsWith('cancelled') ? 'CANCELLED' : 'FAILED';
        const running = STAGE_ORDER.find(
          (stageId) => record.stages.get(stageId)!.status === 'RUNNING',
        );
        if (running !== undefined) finishStage(record, running, status, at, errorCode(context));
        skipPendingStages(record, at);
        return;
      }
      if (
        event === 'execution.completed' ||
        event === 'execution.failed' ||
        event === 'execution.cancelled'
      ) {
        const status =
          event === 'execution.completed'
            ? 'SUCCESS'
            : event === 'execution.cancelled'
              ? 'CANCELLED'
              : 'FAILED';
        record.status = status;
        skipPendingStages(record, at);
        addEvent(
          record,
          status === 'SUCCESS' ? 'execution.finished' : 'execution.failed',
          'WORKFLOW',
          status,
          at,
          {
            startedAtMs: executionStartedAt(record),
            finishedAtMs: at,
            durationMs: asMetric(context.durationMs),
            errorCode: errorCode(context),
          },
        );
        removeActiveAliases(record);
        touch(record);
      }
    },

    complete(result: ExecutionResult): void {
      const record = aliases.get(result.executionId) ?? aliases.get(result.workflowId);
      if (record === undefined) return;
      attachExecutionId(record, result.executionId);
      const at = Math.max(record.lastTimestampMs, Date.parse(result.finishedAt));
      record.lastTimestampMs = at;
      record.updatedAtMs = at;
      record.status = result.status;

      const workflow = result.workflowResult;
      if (workflow !== null) {
        for (const stageId of AGENT_STAGE_ORDER) {
          const key =
            stageId === 'PRODUCT_OWNER'
              ? 'productOwner'
              : stageId === 'DEVELOPER'
                ? 'developer'
                : 'qa';
          const agentResult = workflow.results[key];
          const stage = record.stages.get(stageId)!;
          if (agentResult !== null && stage.status === 'PENDING') startStage(record, stageId, at);
          if (agentResult !== null && (stage.status === 'PENDING' || stage.status === 'RUNNING')) {
            finishStage(
              record,
              stageId,
              agentResult.outcome === 'GENERATED' ? 'SUCCESS' : 'FAILED',
              at,
            );
          }
          record.metrics.set(
            stageId,
            stageMetricsFromResult(result, stageId, record.metrics.get(stageId)!),
          );
        }
      }
      skipPendingStages(record, at);
      const stages = projectStages(record, result.executionId);
      const metrics = AGENT_STAGE_ORDER.map((stageId) => record.metrics.get(stageId)!);
      record.summary = createExecutionObservabilitySummary(result, stages, metrics);
      const terminalType = result.status === 'SUCCESS' ? 'execution.finished' : 'execution.failed';
      if (
        !record.events.some((event) => event.type === terminalType && event.stageId === 'WORKFLOW')
      ) {
        addEvent(record, terminalType, 'WORKFLOW', result.status, at, {
          startedAtMs: executionStartedAt(record),
          finishedAtMs: at,
          durationMs: result.metrics.observed.totalDurationMs,
          errorCode: result.failure?.code ?? null,
        });
      }
      removeActiveAliases(record);
      touch(record);
    },

    get(id: string): ExecutionObservabilitySnapshot | null {
      const record = aliases.get(id);
      return record === undefined ? null : snapshot(record);
    },
  };

  return Object.freeze(history);
}
