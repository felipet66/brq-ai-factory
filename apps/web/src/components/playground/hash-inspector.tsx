import type { PlaygroundBuiltPreview } from '@/api/playground-contracts';

import styles from './playground.module.css';

interface HashInspectorProps {
  readonly hashes: PlaygroundBuiltPreview['hashes'];
}

export function HashInspector({ hashes }: HashInspectorProps) {
  const primary = [
    ['Template', hashes.templateHash],
    ['Asset bundle', hashes.bundleHash],
    ['Instructions', hashes.instructionsHash],
    ['Input', hashes.inputHash],
    ['Output contract', hashes.outputContractHash],
    ['Prompt', hashes.promptHash],
  ] as const;
  const secondary = [
    ...hashes.ruleSetHashes.map(({ ruleSetId, scope, hash }) => ({
      kind: scope,
      id: ruleSetId,
      hash,
      contentHash: null,
    })),
    ...hashes.contextHashes.map(({ contextId, kind, contentHash, hash }) => ({
      kind,
      id: contextId,
      hash,
      contentHash,
    })),
  ];

  return (
    <section className={styles.contentPanel} aria-labelledby="hash-inspector-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Integrity metadata</p>
          <h2 id="hash-inspector-heading">Hash inspector</h2>
        </div>
        <span>Server generated</span>
      </div>
      <dl className={styles.hashGrid}>
        {primary.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
      <h3 className={styles.subheading}>Resolved sources</h3>
      <ul className={styles.sourceHashes}>
        {secondary.map((source) => (
          <li key={`${source.kind}-${source.id}`}>
            <span>{source.kind}</span>
            <strong>{source.id}</strong>
            <code>{source.hash}</code>
            {source.contentHash === null ? null : <code>Content: {source.contentHash}</code>}
          </li>
        ))}
      </ul>
    </section>
  );
}
