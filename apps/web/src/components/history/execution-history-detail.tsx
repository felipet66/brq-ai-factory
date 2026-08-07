import Link from 'next/link';

import type { ExecutionHistoryDetail as ExecutionHistoryDetailView } from '@/api/execution-history-contracts';

import styles from './history.module.css';

interface ExecutionHistoryDetailProps {
  readonly execution: ExecutionHistoryDetailView;
}

const HASH_LABELS = [
  ['Execution request', 'executionRequestHash'],
  ['Workflow request', 'workflowRequestHash'],
  ['Workflow', 'workflowHash'],
  ['Lineage', 'lineageHash'],
  ['Provenance', 'provenanceHash'],
  ['Execution', 'executionHash'],
] as const satisfies readonly (readonly [string, keyof ExecutionHistoryDetailView['hashes']])[];

function displayValue(value: string | number | null): string {
  return value === null ? 'Not available' : String(value);
}

export function ExecutionHistoryDetail({ execution }: ExecutionHistoryDetailProps) {
  return (
    <>
      <section className={styles.panel} aria-labelledby="execution-detail-heading">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Persisted execution</p>
            <h2 id="execution-detail-heading">Execution details</h2>
          </div>
          <span className={styles.statusBadge} data-status={execution.status}>
            {execution.status}
          </span>
        </div>

        <dl className={styles.overview}>
          <div>
            <dt>Execution ID</dt>
            <dd>
              <code>{execution.executionId}</code>
            </dd>
          </div>
          <div>
            <dt>Project name</dt>
            <dd>{execution.projectName}</dd>
          </div>
          <div>
            <dt>Workflow ID</dt>
            <dd>
              <code>{execution.workflowId}</code>
            </dd>
          </div>
          <div>
            <dt>Request ID</dt>
            <dd>
              <code>{displayValue(execution.requestId)}</code>
            </dd>
          </div>
          <div>
            <dt>Readiness</dt>
            <dd>{displayValue(execution.readiness)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>
              {execution.durationMs === null ? 'Not available' : `${execution.durationMs} ms`}
            </dd>
          </div>
          <div>
            <dt>Created at</dt>
            <dd>
              <time dateTime={execution.createdAt}>{execution.createdAt}</time>
            </dd>
          </div>
          <div>
            <dt>Started at</dt>
            <dd>
              {execution.startedAt === null ? (
                'Not available'
              ) : (
                <time dateTime={execution.startedAt}>{execution.startedAt}</time>
              )}
            </dd>
          </div>
          <div>
            <dt>Finished at</dt>
            <dd>
              {execution.finishedAt === null ? (
                'Not available'
              ) : (
                <time dateTime={execution.finishedAt}>{execution.finishedAt}</time>
              )}
            </dd>
          </div>
          <div>
            <dt>Engine version</dt>
            <dd>{execution.metadata.engineVersion}</dd>
          </div>
          <div>
            <dt>Contract version</dt>
            <dd>{execution.metadata.contractVersion}</dd>
          </div>
          <div>
            <dt>Attempt</dt>
            <dd>{execution.metadata.attempt}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.panel} aria-labelledby="execution-hashes-heading">
        <div className={styles.panelHeading}>
          <h2 id="execution-hashes-heading">Final hashes</h2>
        </div>
        <dl className={styles.hashList}>
          {HASH_LABELS.map(([label, key]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                <code>{displayValue(execution.hashes[key])}</code>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className={styles.summaryGrid}>
        <section className={styles.panel} aria-labelledby="execution-lineage-heading">
          <div className={styles.panelHeading}>
            <h2 id="execution-lineage-heading">Lineage</h2>
          </div>
          {execution.lineage === null ? (
            <p className={styles.muted}>Not available for this execution.</p>
          ) : (
            <dl className={styles.compactFacts}>
              <div>
                <dt>Product Owner output</dt>
                <dd>{displayValue(execution.lineage.outputs.productOwnerSpecificationHash)}</dd>
              </div>
              <div>
                <dt>Developer output</dt>
                <dd>{displayValue(execution.lineage.outputs.technicalSpecificationHash)}</dd>
              </div>
              <div>
                <dt>QA output</dt>
                <dd>{displayValue(execution.lineage.outputs.qaSpecificationHash)}</dd>
              </div>
              <div>
                <dt>Verified handoffs</dt>
                <dd>{execution.lineage.handoffs.length}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="execution-provenance-heading">
          <div className={styles.panelHeading}>
            <h2 id="execution-provenance-heading">Provenance</h2>
          </div>
          {execution.provenance === null || execution.provenance.stages.length === 0 ? (
            <p className={styles.muted}>Not available for this execution.</p>
          ) : (
            <ul className={styles.provenanceList}>
              {execution.provenance.stages.map((stage) => (
                <li key={stage.stage}>
                  <strong>{stage.stage}</strong>
                  <span>{stage.outcome}</span>
                  <small>
                    Version {stage.agentVersion} · Readiness {displayValue(stage.readiness)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Link className={styles.backLink} href="/executions">
        Back to execution history
      </Link>
    </>
  );
}
