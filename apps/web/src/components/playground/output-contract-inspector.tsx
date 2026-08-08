import type { PlaygroundBuiltPreview } from '@/api/playground-contracts';

import styles from './playground.module.css';

interface OutputContractInspectorProps {
  readonly contract: PlaygroundBuiltPreview['outputContract'];
}

export function OutputContractInspector({ contract }: OutputContractInspectorProps) {
  const { schema, summary } = contract;
  return (
    <section className={styles.contentPanel} aria-labelledby="output-contract-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Expected response</p>
          <h2 id="output-contract-heading">Output contract</h2>
        </div>
        <span className={styles.formatBadge}>{contract.format}</span>
      </div>
      <dl className={styles.contractFacts}>
        <div>
          <dt>Contract</dt>
          <dd>{contract.id}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{contract.version}</dd>
        </div>
        <div>
          <dt>Contract hash</dt>
          <dd>
            <code>{contract.contractHash}</code>
          </dd>
        </div>
        <div>
          <dt>Dialect</dt>
          <dd>{contract.dialect ?? 'Not applicable'}</dd>
        </div>
        <div>
          <dt>Schema hash</dt>
          <dd>
            <code>{contract.schemaHash ?? 'Not applicable'}</code>
          </dd>
        </div>
      </dl>
      <dl className={styles.contractSummary} aria-label="Schema summary">
        <div>
          <dt>Root types</dt>
          <dd>{summary.rootTypes.length === 0 ? 'None' : summary.rootTypes.join(', ')}</dd>
        </div>
        <div>
          <dt>Nodes</dt>
          <dd>{summary.totalNodes}</dd>
        </div>
        <div>
          <dt>Properties</dt>
          <dd>{summary.propertyCount}</dd>
        </div>
        <div>
          <dt>Required</dt>
          <dd>{summary.requiredCount}</dd>
        </div>
        <div>
          <dt>Objects</dt>
          <dd>{summary.objectCount}</dd>
        </div>
        <div>
          <dt>Arrays</dt>
          <dd>{summary.arrayCount}</dd>
        </div>
        <div>
          <dt>Enums</dt>
          <dd>{summary.enumCount}</dd>
        </div>
      </dl>
      {summary.truncated ? (
        <p className={styles.inlineWarning}>
          The schema summary was truncated at its safety limit.
        </p>
      ) : null}
      {contract.instructions.length === 0 ? null : (
        <div className={styles.contractInstructions}>
          <h3>Contract instructions</h3>
          <ol>
            {contract.instructions.map((instruction, index) => (
              <li key={`${index}-${instruction}`}>{instruction}</li>
            ))}
          </ol>
        </div>
      )}
      {summary.nodes.length === 0 ? null : (
        <div className={styles.requiredProperties}>
          <h3>Schema nodes</h3>
          <ul>
            {summary.nodes.map((node, index) => (
              <li key={`${node.path}-${index}`}>
                <code>{node.path}</code>
                <span>
                  {node.types.join(' | ') || 'untyped'} · {node.required ? 'required' : 'optional'}
                </span>
                {node.enumValues.length === 0 ? null : (
                  <small>
                    Enum: {node.enumValues.map((value) => JSON.stringify(value)).join(', ')}
                  </small>
                )}
                {node.constraints.length === 0 ? null : (
                  <small>
                    Constraints:{' '}
                    {node.constraints
                      .map(({ key, value }) => `${key}=${JSON.stringify(value)}`)
                      .join(', ')}
                  </small>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {schema === null ? null : (
        <details className={styles.schemaDetails}>
          <summary>View read-only JSON Schema</summary>
          <pre className={styles.codePreview}>
            <code>{JSON.stringify(schema, null, 2)}</code>
          </pre>
        </details>
      )}
    </section>
  );
}
