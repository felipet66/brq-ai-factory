import Link from 'next/link';

import { ArtifactCard } from './artifact-card';
import { displayValue, formatDateTime, formatDuration, formatMetric } from './factory-format';
import type { FactoryAgent, FactoryHandoff } from './factory-view-model';
import styles from './factory.module.css';

interface AgentDetailPanelProps {
  readonly agent: FactoryAgent;
  readonly handoffs: readonly FactoryHandoff[];
  readonly executionId: string;
  readonly canAccessPlayground: boolean;
}

function monogram(agent: FactoryAgent): string {
  if (agent.id === 'PRODUCT_OWNER') return 'PO';
  if (agent.id === 'DEVELOPER') return 'DEV';
  return 'QA';
}

function hashLabel(kind: FactoryAgent['hashes']['inputs'][number]['kind']): string {
  return kind
    .split('_')
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(' ');
}

export function AgentDetailPanel({
  agent,
  handoffs,
  executionId,
  canAccessPlayground,
}: AgentDetailPanelProps) {
  const supplemental = handoffs.filter(
    (handoff) => handoff.kind === 'SUPPLEMENTAL' && handoff.to === agent.id,
  );

  return (
    <aside
      id="factory-agent-detail"
      className={styles.detailPanel}
      aria-labelledby="factory-agent-detail-heading"
    >
      <header className={styles.panelHeader}>
        <h2 id="factory-agent-detail-heading">Agent inspection</h2>
        <span>Safe metadata only</span>
      </header>
      <div className={styles.detailBody}>
        <div className={styles.detailIdentity}>
          <span className={styles.detailMonogram} aria-hidden="true">
            {monogram(agent)}
          </span>
          <div>
            <h3>{agent.name}</h3>
            <p>
              {agent.role} · {agent.status.replace('_', ' ')}
            </p>
          </div>
        </div>

        <dl className={styles.detailFacts}>
          <div>
            <dt>Readiness</dt>
            <dd>{displayValue(agent.readiness)}</dd>
          </div>
          <div>
            <dt>Agent version</dt>
            <dd>{displayValue(agent.agentVersion)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(agent.durationMs)}</dd>
          </div>
          <div>
            <dt>Validation</dt>
            <dd>{displayValue(agent.outcome)}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatDateTime(agent.startedAt)}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{formatDateTime(agent.finishedAt)}</dd>
          </div>
        </dl>

        <section className={styles.detailSection} aria-labelledby="agent-metrics-heading">
          <h4 className={styles.detailSectionHeading} id="agent-metrics-heading">
            Stage metrics <span>observed</span>
          </h4>
          <dl className={styles.metricGrid}>
            <div>
              <dt>Prompt</dt>
              <dd>{formatMetric(agent.metrics.promptBytes, ' B')}</dd>
            </div>
            <div>
              <dt>Completion</dt>
              <dd>{formatMetric(agent.metrics.completionBytes, ' B')}</dd>
            </div>
            <div>
              <dt>Total tokens</dt>
              <dd>{formatMetric(agent.metrics.totalTokens)}</dd>
            </div>
            <div>
              <dt>Provider latency</dt>
              <dd>{formatDuration(agent.metrics.providerLatencyMs)}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>{formatDuration(agent.metrics.validationDurationMs)}</dd>
            </div>
            <div>
              <dt>Artifact generation</dt>
              <dd>{formatDuration(agent.metrics.artifactGenerationDurationMs)}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.detailSection} aria-labelledby="agent-hashes-heading">
          <h4 className={styles.detailSectionHeading} id="agent-hashes-heading">
            Hash boundary <span>SHA-256</span>
          </h4>
          <dl className={styles.hashGrid}>
            {agent.hashes.inputs.map((hash) => (
              <div key={`${hash.kind}:${hash.hash}`}>
                <dt>Input · {hashLabel(hash.kind)}</dt>
                <dd title={hash.hash}>{hash.hash}</dd>
              </div>
            ))}
            <div>
              <dt>Output specification</dt>
              <dd title={agent.hashes.output?.hash}>
                {displayValue(agent.hashes.output?.hash ?? null)}
              </dd>
            </div>
            <div>
              <dt>Prompt hash</dt>
              <dd title={agent.hashes.promptHash ?? undefined}>
                {displayValue(agent.hashes.promptHash)}
              </dd>
            </div>
            <div>
              <dt>Validation hash</dt>
              <dd title={agent.hashes.validationHash ?? undefined}>
                {displayValue(agent.hashes.validationHash)}
              </dd>
            </div>
          </dl>
        </section>

        {supplemental.map((handoff) => (
          <div className={styles.supplementalHandoff} key={handoff.id}>
            <strong>Supplemental handoff · Product Owner → QA</strong>
            <span>
              {handoff.status} · timestamp{' '}
              {handoff.timestampBasis === null
                ? 'not recorded'
                : handoff.timestampBasis.toLowerCase().replaceAll('_', ' ')}
            </span>
            <code>{handoff.hash ?? 'Specification hash not available'}</code>
          </div>
        ))}

        <section className={styles.detailSection} aria-labelledby="agent-artifacts-heading">
          <h4 className={styles.detailSectionHeading} id="agent-artifacts-heading">
            Recorded artifacts <span>{agent.artifacts.length}</span>
          </h4>
          {agent.artifacts.length === 0 ? (
            <p className={styles.emptyArtifacts}>
              No artifact hashes have been recorded for this stage. Filenames are not exposed by the
              public execution contract.
            </p>
          ) : (
            <ul className={styles.artifactList}>
              {agent.artifacts.map((artifact) => (
                <ArtifactCard artifact={artifact} key={artifact.id} />
              ))}
            </ul>
          )}
        </section>

        <nav className={styles.detailLinks} aria-label={`${agent.name} inspection links`}>
          <Link className={styles.detailLink} href={`/executions/${executionId}`}>
            Open execution detail
          </Link>
          {canAccessPlayground ? (
            <Link className={styles.detailLink} href="/playground">
              Open Prompt Playground
            </Link>
          ) : null}
        </nav>
      </div>
    </aside>
  );
}
