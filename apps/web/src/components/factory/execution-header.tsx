'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { formatDateTime, formatDuration } from './factory-format';
import type { FactoryViewModel } from './factory-view-model';
import styles from './factory.module.css';

interface ExecutionHeaderProps {
  readonly execution: FactoryViewModel['execution'];
  readonly canAccessPlayground: boolean;
}

function runningElapsed(startedAt: string | null, now: number): number | null {
  if (startedAt === null) return null;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) ? Math.max(0, now - started) : null;
}

export function ExecutionHeader({ execution, canAccessPlayground }: ExecutionHeaderProps) {
  const [now, setNow] = useState(() => Date.now());
  const active = execution.status === 'RUNNING';

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const elapsed = useMemo(
    () => execution.durationMs ?? runningElapsed(execution.startedAt, now),
    [execution.durationMs, execution.startedAt, now],
  );

  return (
    <>
      <div className={styles.executionHeader}>
        <div className={styles.executionTitleRow}>
          <div>
            <p className={styles.microLabel}>Active production line</p>
            <h2>{execution.projectName}</h2>
          </div>
          <span className={styles.overallStatus} data-status={execution.status}>
            {execution.status}
          </span>
        </div>
        <dl className={styles.headerFacts}>
          <div>
            <dt>Execution ID</dt>
            <dd className={styles.mono}>{execution.executionId}</dd>
          </div>
          <div>
            <dt>Job ID</dt>
            <dd className={styles.mono}>{execution.jobId ?? 'Not available'}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>
              {execution.startedAt === null ? (
                'Not available'
              ) : (
                <time dateTime={execution.startedAt}>{formatDateTime(execution.startedAt)}</time>
              )}
            </dd>
          </div>
          <div>
            <dt>Elapsed</dt>
            <dd className={styles.mono}>{formatDuration(elapsed)}</dd>
          </div>
          <div>
            <dt>Readiness</dt>
            <dd>{execution.readiness ?? 'Not available'}</dd>
          </div>
          <div>
            <dt>Timeline revision</dt>
            <dd className={styles.mono}>{execution.timelineRevision ?? '—'}</dd>
          </div>
        </dl>
      </div>
      <nav className={styles.viewNav} aria-label="Execution views">
        <Link className={styles.navLink} href={`/executions/${execution.executionId}`}>
          Technical detail
        </Link>
        <Link
          className={styles.navLink}
          href={`/executions/${execution.executionId}/factory`}
          aria-current="page"
        >
          Factory view
        </Link>
        {canAccessPlayground ? (
          <Link className={styles.navLink} href="/playground">
            Playground
          </Link>
        ) : null}
      </nav>
    </>
  );
}
