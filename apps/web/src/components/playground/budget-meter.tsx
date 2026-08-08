import type { PlaygroundBuiltPreview } from '@/api/playground-contracts';

import styles from './playground.module.css';

interface BudgetMeterProps {
  readonly budget: PlaygroundBuiltPreview['budget'];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

export function BudgetMeter({ budget }: BudgetMeterProps) {
  const warning = budget.status === 'WARNING';
  const segments = [
    ['Instructions', budget.instructionsBytes],
    ['Input', budget.inputBytes],
    ['Output contract', budget.outputContractBytes],
  ] as const;

  return (
    <section className={styles.budgetCard} aria-labelledby="prompt-budget-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Runtime constraint</p>
          <h2 id="prompt-budget-heading">Prompt budget</h2>
        </div>
        <span data-warning={warning}>{warning ? 'Near limit' : 'Within limit'}</span>
      </div>
      <progress
        className={styles.budgetProgress}
        value={Math.min(budget.usedBytes, budget.maxBytes)}
        max={budget.maxBytes}
        aria-label="Prompt budget usage"
      />
      <p className={styles.budgetValue}>
        <strong>{formatBytes(budget.usedBytes)}</strong> / {formatBytes(budget.maxBytes)} ·{' '}
        {budget.utilizationPercent.toFixed(1)}%
      </p>
      {warning ? (
        <p className={styles.warningText} role="status">
          Prompt usage is approaching the configured runtime limit.
        </p>
      ) : null}
      <dl className={styles.budgetBreakdown}>
        {segments.map(([label, bytes]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatBytes(bytes)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
