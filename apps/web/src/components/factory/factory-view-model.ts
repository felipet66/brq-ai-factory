import type {
  ExecutionHistoryDetail,
  ExecutionHistoryJob,
  ExecutionHistoryTimeline,
  ExecutionHistoryTimelineEvent,
} from '@/api/execution-history-contracts';

export const FACTORY_VIEW_MODEL_VERSION = '1.0.0' as const;

export type FactoryAgentId = 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';
export type FactoryStageId = 'KNOWLEDGE' | FactoryAgentId;
export type FactoryVisualStatus =
  'WAITING' | 'WORKING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | 'NOT_OBSERVED';
export type FactoryExecutionStatus =
  'CREATED' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
export type FactoryHandoffStatus = 'PENDING' | 'OBSERVED' | 'VERIFIED' | 'BLOCKED';
export type FactoryHandoffTimestampBasis = 'TARGET_STARTED_AT' | 'SOURCE_FINISHED_AT';

export type FactoryJobMetadata = ExecutionHistoryJob;
export type FactoryObservabilityEvent = ExecutionHistoryTimelineEvent;
export type FactoryExecutionSource = ExecutionHistoryDetail;
export type FactoryTimelineSource = ExecutionHistoryTimeline;

export interface FactoryViewModelInput {
  readonly execution: FactoryExecutionSource;
  readonly timeline: FactoryTimelineSource | null;
}

export interface FactoryHashReference {
  readonly kind:
    | 'EXECUTION_REQUEST'
    | 'WORKFLOW_REQUEST'
    | 'PRODUCT_OWNER_SPECIFICATION'
    | 'TECHNICAL_SPECIFICATION'
    | 'QA_SPECIFICATION';
  readonly hash: string;
}

export interface FactoryAgentHashes {
  readonly inputs: readonly FactoryHashReference[];
  readonly output: FactoryHashReference | null;
  readonly assetBundleHash: string | null;
  readonly knowledgeContextHash: string | null;
  readonly promptHash: string | null;
  readonly responseHash: string | null;
  readonly validationHash: string | null;
  readonly generationHash: string | null;
}

export interface FactoryAgentMetrics {
  readonly durationMs: number | null;
  readonly promptBytes: number | null;
  readonly completionBytes: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly providerLatencyMs: number | null;
  readonly validationDurationMs: number | null;
  readonly artifactGenerationDurationMs: number | null;
}

export interface FactoryArtifact {
  readonly id: string;
  readonly ordinal: number;
  readonly stageId: FactoryAgentId;
  readonly hash: string;
  readonly status: 'RECORDED';
  readonly outcome: 'GENERATED' | 'VALIDATION_REJECTED';
  readonly generationHash: string | null;
}

export interface FactoryAgent {
  readonly id: FactoryAgentId;
  readonly name: string;
  readonly role: string;
  readonly status: FactoryVisualStatus;
  readonly sourceStatus:
    'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly readiness: string | null;
  readonly agentVersion: string | null;
  readonly outcome: 'GENERATED' | 'VALIDATION_REJECTED' | null;
  readonly metrics: FactoryAgentMetrics;
  readonly hashes: FactoryAgentHashes;
  readonly artifacts: readonly FactoryArtifact[];
}

export interface FactorySystemStage {
  readonly id: 'KNOWLEDGE';
  readonly name: 'Knowledge System';
  readonly status: FactoryVisualStatus;
  readonly sourceStatus:
    'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
}

export interface FactoryHandoff {
  readonly id: 'PRODUCT_OWNER_TO_DEVELOPER' | 'DEVELOPER_TO_QA' | 'PRODUCT_OWNER_TO_QA';
  readonly kind: 'PRIMARY' | 'SUPPLEMENTAL';
  readonly from: 'PRODUCT_OWNER' | 'DEVELOPER';
  readonly to: 'DEVELOPER' | 'QA';
  readonly specification: 'PRODUCT_OWNER_SPECIFICATION' | 'TECHNICAL_SPECIFICATION';
  readonly status: FactoryHandoffStatus;
  readonly verified: boolean;
  readonly hash: string | null;
  readonly observedAt: string | null;
  readonly timestampBasis: FactoryHandoffTimestampBasis | null;
}

export type FactoryActivityKind =
  | 'JOB_QUEUED'
  | 'JOB_STARTED'
  | 'JOB_FINISHED'
  | 'JOB_FAILED'
  | 'JOB_CANCELLED'
  | 'EXECUTION_STARTED'
  | 'EXECUTION_FINISHED'
  | 'EXECUTION_FAILED'
  | 'EXECUTION_CANCELLED'
  | 'STAGE_STARTED'
  | 'STAGE_FINISHED'
  | 'STAGE_FAILED'
  | 'STAGE_CANCELLED'
  | 'STAGE_SKIPPED';

export interface FactoryActivity {
  readonly id: string;
  readonly source: 'JOB_METADATA' | 'OBSERVABILITY_EVENT';
  readonly kind: FactoryActivityKind;
  readonly stageId: 'JOB' | 'EXECUTION' | 'KNOWLEDGE' | FactoryAgentId | 'WORKFLOW';
  readonly label: string;
  readonly status: 'NEUTRAL' | 'ACTIVE' | 'SUCCESS' | 'ERROR' | 'CANCELLED';
  readonly occurredAt: string;
  readonly sequence: number;
}

export interface FactoryProgress {
  readonly status: FactoryExecutionStatus;
  readonly knowledgeStatus: FactoryVisualStatus;
  readonly activeAgentId: FactoryAgentId | null;
  readonly failedAgentId: FactoryAgentId | null;
  readonly completedAgentCount: number;
  readonly resolvedAgentCount: number;
  readonly totalAgentCount: 3;
  readonly totalTokens: number | null;
  readonly totalCostEstimate: {
    readonly amount: number;
    readonly currency: 'USD';
    readonly rateCardVersion: string;
  } | null;
}

export interface FactoryViewModel {
  readonly version: typeof FACTORY_VIEW_MODEL_VERSION;
  readonly execution: {
    readonly executionId: string;
    readonly workflowId: string;
    readonly jobId: string | null;
    readonly requestId: string | null;
    readonly projectName: string;
    readonly status: FactoryExecutionStatus;
    readonly readiness: string | null;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly durationMs: number | null;
    readonly timelineRevision: number | null;
    readonly hashes: ExecutionHistoryDetail['hashes'];
  };
  readonly knowledge: FactorySystemStage;
  readonly agents: readonly [FactoryAgent, FactoryAgent, FactoryAgent];
  readonly handoffs: readonly [FactoryHandoff, FactoryHandoff, FactoryHandoff];
  readonly activity: readonly FactoryActivity[];
  readonly progress: FactoryProgress;
}

type TimelineStage = FactoryTimelineSource['stages'][number];
type TimelineStageStatus = TimelineStage['status'];
type ProvenanceStage = NonNullable<FactoryExecutionSource['provenance']>['stages'][number];

const AGENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'PRODUCT_OWNER',
    name: 'Product Owner',
    role: 'Product strategy & backlog',
  }),
  Object.freeze({ id: 'DEVELOPER', name: 'Developer', role: 'Technical design' }),
  Object.freeze({ id: 'QA', name: 'QA', role: 'Quality specification' }),
] as const);

const STAGE_LABELS = Object.freeze({
  EXECUTION: 'Execution',
  KNOWLEDGE: 'Knowledge',
  PRODUCT_OWNER: 'Product Owner',
  DEVELOPER: 'Developer',
  QA: 'QA',
  WORKFLOW: 'Workflow',
} as const);

const HANDOFF_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'PRODUCT_OWNER_TO_DEVELOPER',
    kind: 'PRIMARY',
    from: 'PRODUCT_OWNER',
    to: 'DEVELOPER',
    specification: 'PRODUCT_OWNER_SPECIFICATION',
  }),
  Object.freeze({
    id: 'DEVELOPER_TO_QA',
    kind: 'PRIMARY',
    from: 'DEVELOPER',
    to: 'QA',
    specification: 'TECHNICAL_SPECIFICATION',
  }),
  Object.freeze({
    id: 'PRODUCT_OWNER_TO_QA',
    kind: 'SUPPLEMENTAL',
    from: 'PRODUCT_OWNER',
    to: 'QA',
    specification: 'PRODUCT_OWNER_SPECIFICATION',
  }),
] as const);

function freezeArray<Value>(values: Value[]): readonly Value[] {
  return Object.freeze(values);
}

export function toFactoryVisualStatus(status: TimelineStageStatus | null): FactoryVisualStatus {
  switch (status) {
    case 'PENDING':
      return 'WAITING';
    case 'RUNNING':
      return 'WORKING';
    case 'SUCCESS':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'SKIPPED':
      return 'SKIPPED';
    default:
      return 'NOT_OBSERVED';
  }
}

function findStage(
  timeline: FactoryTimelineSource | null,
  stageId: FactoryStageId,
): TimelineStage | null {
  return timeline?.stages.find((stage) => stage.stageId === stageId) ?? null;
}

function findProvenance(
  execution: FactoryExecutionSource,
  stageId: FactoryAgentId,
): ProvenanceStage | null {
  return execution.provenance?.stages.find((stage) => stage.stage === stageId) ?? null;
}

function statusWithoutTimeline(execution: FactoryExecutionSource): FactoryVisualStatus {
  const status = overallStatus(execution);
  return status === 'CREATED' || status === 'QUEUED' ? 'WAITING' : 'NOT_OBSERVED';
}

function createHashReference(
  kind: FactoryHashReference['kind'],
  hash: string | null,
): FactoryHashReference | null {
  return hash === null ? null : Object.freeze({ kind, hash });
}

function inputHashes(
  execution: FactoryExecutionSource,
  stageId: FactoryAgentId,
): readonly FactoryHashReference[] {
  const hashes: (FactoryHashReference | null)[] = [];
  if (stageId === 'PRODUCT_OWNER') {
    hashes.push(
      createHashReference('EXECUTION_REQUEST', execution.hashes.executionRequestHash),
      createHashReference('WORKFLOW_REQUEST', execution.hashes.workflowRequestHash),
    );
  }
  if (stageId === 'DEVELOPER' || stageId === 'QA') {
    hashes.push(
      createHashReference(
        'PRODUCT_OWNER_SPECIFICATION',
        execution.lineage?.outputs.productOwnerSpecificationHash ?? null,
      ),
    );
  }
  if (stageId === 'QA') {
    hashes.push(
      createHashReference(
        'TECHNICAL_SPECIFICATION',
        execution.lineage?.outputs.technicalSpecificationHash ?? null,
      ),
    );
  }
  return freezeArray(hashes.filter((hash): hash is FactoryHashReference => hash !== null));
}

function outputHash(
  execution: FactoryExecutionSource,
  stageId: FactoryAgentId,
): FactoryHashReference | null {
  const outputs = execution.lineage?.outputs;
  if (outputs === undefined) return null;
  if (stageId === 'PRODUCT_OWNER')
    return createHashReference(
      'PRODUCT_OWNER_SPECIFICATION',
      outputs.productOwnerSpecificationHash,
    );
  if (stageId === 'DEVELOPER')
    return createHashReference('TECHNICAL_SPECIFICATION', outputs.technicalSpecificationHash);
  return createHashReference('QA_SPECIFICATION', outputs.qaSpecificationHash);
}

function createMetrics(
  timeline: FactoryTimelineSource | null,
  stageId: FactoryAgentId,
): FactoryAgentMetrics {
  const metrics = timeline?.stageMetrics.find((candidate) => candidate.stageId === stageId);
  return Object.freeze({
    durationMs: metrics?.durationMs ?? null,
    promptBytes: metrics?.promptBytes ?? null,
    completionBytes: metrics?.completionBytes ?? null,
    inputTokens: metrics?.inputTokens ?? null,
    outputTokens: metrics?.outputTokens ?? null,
    totalTokens: metrics?.totalTokens ?? null,
    providerLatencyMs: metrics?.providerLatencyMs ?? null,
    validationDurationMs: metrics?.validationDurationMs ?? null,
    artifactGenerationDurationMs: metrics?.artifactGenerationDurationMs ?? null,
  });
}

function createArtifacts(
  stageId: FactoryAgentId,
  provenance: ProvenanceStage | null,
): readonly FactoryArtifact[] {
  if (provenance === null) return Object.freeze([]);
  return freezeArray(
    provenance.hashes.artifactHashes.map((hash, index) =>
      Object.freeze({
        id: `${stageId}:${index + 1}:${hash}`,
        ordinal: index + 1,
        stageId,
        hash,
        status: 'RECORDED' as const,
        outcome: provenance.outcome,
        generationHash: provenance.hashes.generationHash,
      }),
    ),
  );
}

function createAgent(
  execution: FactoryExecutionSource,
  timeline: FactoryTimelineSource | null,
  definition: (typeof AGENT_DEFINITIONS)[number],
): FactoryAgent {
  const stage = findStage(timeline, definition.id);
  const provenance = findProvenance(execution, definition.id);
  const hashes = Object.freeze({
    inputs: inputHashes(execution, definition.id),
    output: outputHash(execution, definition.id),
    assetBundleHash: provenance?.hashes.assetBundleHash ?? null,
    knowledgeContextHash: provenance?.hashes.knowledgeContextHash ?? null,
    promptHash: provenance?.hashes.promptHash ?? null,
    responseHash: provenance?.hashes.responseHash ?? null,
    validationHash: provenance?.hashes.validationHash ?? null,
    generationHash: provenance?.hashes.generationHash ?? null,
  });
  return Object.freeze({
    ...definition,
    status: stage === null ? statusWithoutTimeline(execution) : toFactoryVisualStatus(stage.status),
    sourceStatus: stage?.status ?? null,
    startedAt: stage?.startedAt ?? null,
    finishedAt: stage?.finishedAt ?? null,
    durationMs: stage?.durationMs ?? null,
    readiness: provenance?.readiness ?? null,
    agentVersion: provenance?.agentVersion ?? null,
    outcome: provenance?.outcome ?? null,
    metrics: createMetrics(timeline, definition.id),
    hashes,
    artifacts: createArtifacts(definition.id, provenance),
  });
}

function createKnowledge(
  execution: FactoryExecutionSource,
  timeline: FactoryTimelineSource | null,
): FactorySystemStage {
  const stage = findStage(timeline, 'KNOWLEDGE');
  return Object.freeze({
    id: 'KNOWLEDGE',
    name: 'Knowledge System',
    status: stage === null ? statusWithoutTimeline(execution) : toFactoryVisualStatus(stage.status),
    sourceStatus: stage?.status ?? null,
    startedAt: stage?.startedAt ?? null,
    finishedAt: stage?.finishedAt ?? null,
    durationMs: stage?.durationMs ?? null,
  });
}

function isBlockingStatus(status: FactoryVisualStatus): boolean {
  return ['FAILED', 'CANCELLED', 'SKIPPED', 'NOT_OBSERVED'].includes(status);
}

function handoffHash(
  execution: FactoryExecutionSource,
  specification: FactoryHandoff['specification'],
): string | null {
  if (specification === 'PRODUCT_OWNER_SPECIFICATION')
    return execution.lineage?.outputs.productOwnerSpecificationHash ?? null;
  return execution.lineage?.outputs.technicalSpecificationHash ?? null;
}

function createHandoff(
  execution: FactoryExecutionSource,
  agents: readonly FactoryAgent[],
  definition: (typeof HANDOFF_DEFINITIONS)[number],
): FactoryHandoff {
  const source = agents.find((agent) => agent.id === definition.from)!;
  const target = agents.find((agent) => agent.id === definition.to)!;
  const verified =
    execution.lineage?.handoffs.some(
      (handoff) =>
        handoff.from === definition.from &&
        handoff.to === definition.to &&
        handoff.specification === definition.specification &&
        handoff.verified,
    ) ?? false;
  const observed = source.status === 'COMPLETED' && target.startedAt !== null;
  const blocked = isBlockingStatus(source.status) || target.status === 'SKIPPED';
  const status: FactoryHandoffStatus = verified
    ? 'VERIFIED'
    : observed
      ? 'OBSERVED'
      : blocked
        ? 'BLOCKED'
        : 'PENDING';
  const observedAt =
    status === 'VERIFIED' || status === 'OBSERVED' ? (target.startedAt ?? source.finishedAt) : null;
  const timestampBasis =
    observedAt === null
      ? null
      : target.startedAt !== null
        ? 'TARGET_STARTED_AT'
        : 'SOURCE_FINISHED_AT';

  return Object.freeze({
    ...definition,
    status,
    verified,
    hash: verified ? handoffHash(execution, definition.specification) : null,
    observedAt,
    timestampBasis,
  });
}

function activityStatus(status: FactoryObservabilityEvent['status']): FactoryActivity['status'] {
  if (status === 'RUNNING') return 'ACTIVE';
  if (status === 'SUCCESS' || status === 'SKIPPED') return 'SUCCESS';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'FAILED') return 'ERROR';
  return 'NEUTRAL';
}

function mapEventActivity(event: FactoryObservabilityEvent): FactoryActivity | null {
  const occurredAt = event.finishedAt ?? event.startedAt;
  if (occurredAt === null) return null;
  const stageLabel = STAGE_LABELS[event.stageId];
  let kind: FactoryActivityKind;
  let label: string;

  if (
    event.type === 'execution.started' &&
    event.stageId === 'EXECUTION' &&
    event.status === 'RUNNING'
  ) {
    kind = 'EXECUTION_STARTED';
    label = 'Execution started';
  } else if (
    event.type === 'execution.finished' &&
    (event.stageId === 'EXECUTION' || event.stageId === 'WORKFLOW') &&
    event.status === 'SUCCESS'
  ) {
    kind = 'EXECUTION_FINISHED';
    label = 'Execution finished';
  } else if (
    event.type === 'execution.failed' &&
    (event.stageId === 'EXECUTION' || event.stageId === 'WORKFLOW') &&
    (event.status === 'FAILED' || event.status === 'CANCELLED')
  ) {
    const cancelled = event.status === 'CANCELLED';
    kind = cancelled ? 'EXECUTION_CANCELLED' : 'EXECUTION_FAILED';
    label = cancelled ? 'Execution cancelled' : 'Execution failed';
  } else if (event.type === 'stage.started' && event.status === 'RUNNING') {
    kind = 'STAGE_STARTED';
    label = event.stageId === 'KNOWLEDGE' ? 'Knowledge loading started' : `${stageLabel} started`;
  } else if (
    event.type === 'stage.finished' &&
    (event.status === 'SUCCESS' || event.status === 'SKIPPED')
  ) {
    const skipped = event.status === 'SKIPPED';
    kind = skipped ? 'STAGE_SKIPPED' : 'STAGE_FINISHED';
    label = skipped
      ? `${stageLabel} skipped`
      : event.stageId === 'KNOWLEDGE'
        ? 'Knowledge loaded'
        : `${stageLabel} finished`;
  } else if (
    event.type === 'stage.failed' &&
    (event.status === 'FAILED' || event.status === 'CANCELLED')
  ) {
    const cancelled = event.status === 'CANCELLED';
    kind = cancelled ? 'STAGE_CANCELLED' : 'STAGE_FAILED';
    label = cancelled ? `${stageLabel} cancelled` : `${stageLabel} failed`;
  } else {
    return null;
  }

  return Object.freeze({
    id: `event:${event.sequence}:${event.type}:${event.stageId}`,
    source: 'OBSERVABILITY_EVENT',
    kind,
    stageId: event.stageId,
    label,
    status: activityStatus(event.status),
    occurredAt,
    sequence: event.sequence,
  });
}

function jobActivities(job: FactoryJobMetadata | null | undefined): readonly FactoryActivity[] {
  if (job === null || job === undefined) return Object.freeze([]);
  const activities: FactoryActivity[] = [
    Object.freeze({
      id: `job:${job.jobId}:queued`,
      source: 'JOB_METADATA',
      kind: 'JOB_QUEUED',
      stageId: 'JOB',
      label: 'Execution queued',
      status: 'NEUTRAL',
      occurredAt: job.queuedAt,
      sequence: 0,
    }),
  ];
  if (job.startedAt !== null) {
    activities.push(
      Object.freeze({
        id: `job:${job.jobId}:started`,
        source: 'JOB_METADATA',
        kind: 'JOB_STARTED',
        stageId: 'JOB',
        label: 'Job started',
        status: 'ACTIVE',
        occurredAt: job.startedAt,
        sequence: 1,
      }),
    );
  }
  if (job.finishedAt !== null) {
    const terminal = {
      SUCCESS: Object.freeze({ kind: 'JOB_FINISHED', label: 'Job finished', status: 'SUCCESS' }),
      FAILED: Object.freeze({ kind: 'JOB_FAILED', label: 'Job failed', status: 'ERROR' }),
      CANCELLED: Object.freeze({
        kind: 'JOB_CANCELLED',
        label: 'Job cancelled',
        status: 'CANCELLED',
      }),
    } as const;
    if (job.status === 'SUCCESS' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      activities.push(
        Object.freeze({
          id: `job:${job.jobId}:finished`,
          source: 'JOB_METADATA',
          ...terminal[job.status],
          stageId: 'JOB',
          occurredAt: job.finishedAt,
          sequence: 2,
        }),
      );
    }
  }
  return Object.freeze(activities);
}

function createActivity(
  execution: FactoryExecutionSource,
  timeline: FactoryTimelineSource | null,
): readonly FactoryActivity[] {
  const events = (timeline?.events ?? [])
    .map(mapEventActivity)
    .filter((activity): activity is FactoryActivity => activity !== null);
  const sourcePriority = { JOB_METADATA: 0, OBSERVABILITY_EVENT: 1 } as const;
  return freezeArray(
    [...jobActivities(execution.job), ...events].sort((left, right) => {
      const timeDifference = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
      if (timeDifference !== 0) return timeDifference;
      const sourceDifference = sourcePriority[left.source] - sourcePriority[right.source];
      if (sourceDifference !== 0) return sourceDifference;
      const sequenceDifference = left.sequence - right.sequence;
      return sequenceDifference === 0 ? left.id.localeCompare(right.id) : sequenceDifference;
    }),
  );
}

function overallStatus(execution: FactoryExecutionSource): FactoryExecutionStatus {
  if (execution.status !== 'CREATED') return execution.status;
  return execution.job?.status ?? 'CREATED';
}

function isResolved(status: FactoryVisualStatus): boolean {
  return !['WAITING', 'WORKING'].includes(status);
}

function createProgress(
  execution: FactoryExecutionSource,
  timeline: FactoryTimelineSource | null,
  knowledge: FactorySystemStage,
  agents: readonly FactoryAgent[],
): FactoryProgress {
  return Object.freeze({
    status: overallStatus(execution),
    knowledgeStatus: knowledge.status,
    activeAgentId: agents.find((agent) => agent.status === 'WORKING')?.id ?? null,
    failedAgentId: agents.find((agent) => agent.status === 'FAILED')?.id ?? null,
    completedAgentCount: agents.filter((agent) => agent.status === 'COMPLETED').length,
    resolvedAgentCount: agents.filter((agent) => isResolved(agent.status)).length,
    totalAgentCount: 3,
    totalTokens: timeline?.summary?.totalTokens ?? null,
    totalCostEstimate:
      timeline?.summary?.totalCostEstimate === undefined ||
      timeline.summary.totalCostEstimate === null
        ? null
        : Object.freeze({ ...timeline.summary.totalCostEstimate }),
  });
}

export function createFactoryViewModel({
  execution,
  timeline,
}: FactoryViewModelInput): FactoryViewModel {
  const knowledge = createKnowledge(execution, timeline);
  const agents = Object.freeze(
    AGENT_DEFINITIONS.map((definition) => createAgent(execution, timeline, definition)),
  ) as readonly [FactoryAgent, FactoryAgent, FactoryAgent];
  const handoffs = Object.freeze(
    HANDOFF_DEFINITIONS.map((definition) => createHandoff(execution, agents, definition)),
  ) as readonly [FactoryHandoff, FactoryHandoff, FactoryHandoff];
  const executionView = Object.freeze({
    executionId: execution.executionId,
    workflowId: execution.workflowId,
    jobId: execution.job?.jobId ?? null,
    requestId: execution.requestId,
    projectName: execution.projectName,
    status: overallStatus(execution),
    readiness: execution.readiness,
    startedAt: execution.startedAt ?? execution.job?.startedAt ?? null,
    finishedAt: execution.finishedAt ?? execution.job?.finishedAt ?? null,
    durationMs: execution.durationMs,
    timelineRevision: timeline?.revision ?? null,
    hashes: Object.freeze({ ...execution.hashes }),
  });

  return Object.freeze({
    version: FACTORY_VIEW_MODEL_VERSION,
    execution: executionView,
    knowledge,
    agents,
    handoffs,
    activity: createActivity(execution, timeline),
    progress: createProgress(execution, timeline, knowledge, agents),
  });
}
