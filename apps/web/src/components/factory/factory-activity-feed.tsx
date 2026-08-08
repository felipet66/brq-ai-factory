import { formatTimestamp } from './factory-format';
import type { FactoryActivity } from './factory-view-model';
import styles from './factory.module.css';

interface FactoryActivityFeedProps {
  readonly activity: readonly FactoryActivity[];
}

function activityDataStatus(activity: FactoryActivity): string {
  if (activity.status === 'ACTIVE') return 'RUNNING';
  if (activity.status === 'ERROR') return 'FAILED';
  if (activity.status === 'NEUTRAL') return 'PENDING';
  return activity.status;
}

export function FactoryActivityFeed({ activity }: FactoryActivityFeedProps) {
  return (
    <section className={styles.activityPanel} aria-labelledby="factory-activity-heading">
      <header className={styles.panelHeader}>
        <h2 id="factory-activity-heading">Live activity</h2>
        <span>{activity.length} recorded events</span>
      </header>
      {activity.length === 0 ? (
        <p className={styles.emptyActivity}>
          No observable activity has been recorded for this execution yet.
        </p>
      ) : (
        <ol className={styles.activityList}>
          {activity.map((item) => (
            <li
              className={styles.activityItem}
              data-status={activityDataStatus(item)}
              key={item.id}
            >
              <time dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt)}</time>
              <span className={styles.activityDot} aria-hidden="true" />
              <span className={styles.activityCopy}>
                <strong>{item.label}</strong>
                <span>{item.stageId.replace('_', ' ')}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
