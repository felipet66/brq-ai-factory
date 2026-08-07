import type { ExecutionHistoryTimeline as ExecutionHistoryTimelineView } from '@/api/execution-history-contracts';

import styles from './history.module.css';

interface ExecutionHistoryTimelineProps {
  readonly timeline: ExecutionHistoryTimelineView;
}

function displayMetric(value: number | null, unit = ''): string {
  return value === null ? 'Not available' : `${value}${unit}`;
}

export function ExecutionHistoryTimeline({ timeline }: ExecutionHistoryTimelineProps) {
  return (
    <section className={styles.panel} aria-labelledby="persisted-timeline-heading">
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>Revision {timeline.revision}</p>
          <h2 id="persisted-timeline-heading">Execution timeline</h2>
        </div>
        <time dateTime={timeline.updatedAt}>{timeline.updatedAt}</time>
      </div>

      <ol className={styles.timeline}>
        {timeline.stages.map((stage) => (
          <li key={stage.stageId} data-status={stage.status}>
            <span className={styles.timelineDot} aria-hidden="true" />
            <div>
              <strong>{stage.stageName}</strong>
              <span>{stage.status}</span>
            </div>
            <small>{displayMetric(stage.durationMs, ' ms')}</small>
          </li>
        ))}
      </ol>

      <div className={styles.metricsGrid} aria-label="Stage metrics">
        {timeline.stageMetrics.map((metrics) => (
          <article key={metrics.stageId}>
            <h3>{metrics.stageId}</h3>
            <dl className={styles.compactFacts}>
              <div>
                <dt>Total tokens</dt>
                <dd>{displayMetric(metrics.totalTokens)}</dd>
              </div>
              <div>
                <dt>Prompt bytes</dt>
                <dd>{displayMetric(metrics.promptBytes)}</dd>
              </div>
              <div>
                <dt>Completion bytes</dt>
                <dd>{displayMetric(metrics.completionBytes)}</dd>
              </div>
              <div>
                <dt>Provider latency</dt>
                <dd>{displayMetric(metrics.providerLatencyMs, ' ms')}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
