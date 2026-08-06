import type { ExecutionSummary } from '@/api/execution-contracts';

interface ExecutionResultProps {
  readonly result: ExecutionSummary;
}

const HASH_LABELS = [
  ['Execution request', 'executionRequestHash'],
  ['Workflow request', 'workflowRequestHash'],
  ['Workflow', 'workflowHash'],
  ['Lineage', 'lineageHash'],
  ['Provenance', 'provenanceHash'],
  ['Execution', 'executionHash'],
] as const satisfies readonly (readonly [string, keyof ExecutionSummary['hashes']])[];

function displayValue(value: string | null): string {
  return value ?? 'Not available';
}

export function ExecutionResult({ result }: ExecutionResultProps) {
  return (
    <section className="execution-result" aria-labelledby="execution-result-heading">
      <div className="execution-result__heading">
        <div>
          <p className="state-label">Workflow complete</p>
          <h2 id="execution-result-heading">Execution result</h2>
        </div>
        <span className="status-badge" data-status={result.status}>
          {result.status}
        </span>
      </div>

      <dl className="result-overview">
        <div>
          <dt>Execution ID</dt>
          <dd>
            <code>{result.executionId}</code>
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{result.durationMs} ms</dd>
        </div>
        <div>
          <dt>Readiness</dt>
          <dd>{displayValue(result.readiness)}</dd>
        </div>
      </dl>

      <section className="result-section" aria-labelledby="hashes-heading">
        <h3 id="hashes-heading">Hashes</h3>
        <dl className="hash-list">
          {HASH_LABELS.map(([label, key]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                <code>{displayValue(result.hashes[key])}</code>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="result-summary-grid">
        <section className="result-section" aria-labelledby="lineage-heading">
          <h3 id="lineage-heading">Lineage summary</h3>
          {result.lineage === null ? (
            <p>Not available for this execution.</p>
          ) : (
            <dl className="compact-facts">
              <div>
                <dt>Outputs</dt>
                <dd>{result.lineage.outputCount}</dd>
              </div>
              <div>
                <dt>Verified handoffs</dt>
                <dd>{result.lineage.verifiedHandoffs}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="result-section" aria-labelledby="provenance-heading">
          <h3 id="provenance-heading">Provenance summary</h3>
          {result.provenance === null || result.provenance.stages.length === 0 ? (
            <p>Not available for this execution.</p>
          ) : (
            <ul className="provenance-list">
              {result.provenance.stages.map((stage) => (
                <li key={stage.stage}>
                  <div>
                    <strong>{stage.stage}</strong>
                    <span>{stage.outcome}</span>
                  </div>
                  <p>
                    Version {stage.agentVersion} · Readiness {displayValue(stage.readiness)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
