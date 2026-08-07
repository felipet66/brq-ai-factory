import type { ExecutionSummary } from '@/api/execution-contracts';

interface ExecutionTimelineProps {
  readonly loading?: boolean;
  readonly observability: ExecutionSummary['observability'];
}

const INITIAL_STAGES = Object.freeze([
  { stageId: 'KNOWLEDGE', stageName: 'Knowledge', status: 'PENDING', durationMs: null },
  {
    stageId: 'PRODUCT_OWNER',
    stageName: 'Product Owner',
    status: 'PENDING',
    durationMs: null,
  },
  { stageId: 'DEVELOPER', stageName: 'Developer', status: 'PENDING', durationMs: null },
  { stageId: 'QA', stageName: 'QA', status: 'PENDING', durationMs: null },
] as const satisfies NonNullable<ExecutionSummary['observability']>['stages']);

const STATUS_LABELS = Object.freeze({
  PENDING: 'Pending',
  RUNNING: 'In progress',
  SUCCESS: 'Complete',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  SKIPPED: 'Skipped',
});

export function ExecutionTimeline({ loading = false, observability }: ExecutionTimelineProps) {
  const stages = observability?.stages ?? INITIAL_STAGES;
  const metadataLabel =
    observability === null ? (loading ? 'Connecting' : 'Unavailable') : 'Live metadata';

  return (
    <section className="execution-timeline" aria-labelledby="execution-timeline-heading">
      <div className="execution-timeline__heading">
        <h3 id="execution-timeline-heading">Execution timeline</h3>
        <span>{metadataLabel}</span>
      </div>

      <ol className="execution-timeline__stages">
        {stages.map((stage) => (
          <li key={stage.stageId} data-status={stage.status}>
            <span className="timeline-status-dot" aria-hidden="true" />
            <div>
              <strong>{stage.stageName}</strong>
              <span>{STATUS_LABELS[stage.status]}</span>
            </div>
            {stage.durationMs === null ? null : <small>{stage.durationMs} ms</small>}
          </li>
        ))}
      </ol>

      {observability === null ? (
        <p className="execution-timeline__note">
          {loading
            ? 'Waiting for execution metadata. The workflow continues normally.'
            : 'Timeline metadata is not available for this execution.'}
        </p>
      ) : null}
    </section>
  );
}
