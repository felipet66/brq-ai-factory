import Link from 'next/link';

import type { ExecutionHistoryItem } from '@/api/execution-history-contracts';

import styles from './history.module.css';

interface ExecutionHistoryListProps {
  readonly items: readonly ExecutionHistoryItem[];
  readonly hasNextPage: boolean;
  readonly loadingNextPage: boolean;
  readonly onNextPage: () => void;
}

function displayValue(value: string | null): string {
  return value ?? 'Not available';
}

function displayDuration(durationMs: number | null): string {
  return durationMs === null ? 'Not available' : `${durationMs} ms`;
}

export function ExecutionHistoryList({
  items,
  hasNextPage,
  loadingNextPage,
  onNextPage,
}: ExecutionHistoryListProps) {
  return (
    <section className={styles.panel} aria-labelledby="execution-history-list-heading">
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>Persisted metadata</p>
          <h2 id="execution-history-list-heading">Executions</h2>
        </div>
        <span>{items.length} on this page</span>
      </div>

      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Execution ID</th>
              <th scope="col">Status</th>
              <th scope="col">Readiness</th>
              <th scope="col">Started at</th>
              <th scope="col">Duration</th>
              <th scope="col">Project name</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.workflowId}:${item.executionId ?? 'pending'}`}>
                <td>
                  {item.executionId === null ? (
                    <span>Pending assignment</span>
                  ) : (
                    <Link className={styles.executionLink} href={`/executions/${item.executionId}`}>
                      <code>{item.executionId}</code>
                    </Link>
                  )}
                </td>
                <td>
                  <span className={styles.statusBadge} data-status={item.status}>
                    {item.status}
                  </span>
                </td>
                <td>{displayValue(item.readiness)}</td>
                <td>
                  {item.startedAt === null ? (
                    'Not available'
                  ) : (
                    <time dateTime={item.startedAt}>{item.startedAt}</time>
                  )}
                </td>
                <td>{displayDuration(item.durationMs)}</td>
                <td>{item.projectName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <span>Ordered by newest execution</span>
        <button type="button" onClick={onNextPage} disabled={!hasNextPage || loadingNextPage}>
          {loadingNextPage ? 'Loading…' : 'Next'}
        </button>
      </div>
    </section>
  );
}
