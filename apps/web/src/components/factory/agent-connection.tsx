import { shortHash } from './factory-format';
import type { FactoryHandoff } from './factory-view-model';
import styles from './factory.module.css';

interface AgentConnectionProps {
  readonly handoff: FactoryHandoff;
}

export function AgentConnection({ handoff }: AgentConnectionProps) {
  const statusLabel = handoff.status === 'OBSERVED' ? 'Observed' : handoff.status.toLowerCase();
  const fromLabel = handoff.from === 'PRODUCT_OWNER' ? 'PO' : 'DEV';
  const toLabel = handoff.to === 'DEVELOPER' ? 'DEV' : 'QA';

  return (
    <li className={styles.connection} data-state={handoff.status}>
      <div
        className={styles.connectionInner}
        role="group"
        aria-label={`${handoff.from} to ${handoff.to} handoff, ${statusLabel}`}
      >
        <div className={styles.connectionLabel}>
          <span>Observable handoff</span>
          <strong className={styles.handoffState}>{statusLabel}</strong>
        </div>
        <div className={styles.handoffRoute} aria-hidden="true">
          <strong>{fromLabel}</strong>
          <span>to</span>
          <strong>{toLabel}</strong>
        </div>
        <div className={styles.dataBus} aria-hidden="true">
          <span className={styles.dataPacket} />
        </div>
        <code className={styles.handoffHash}>{shortHash(handoff.hash)}</code>
      </div>
    </li>
  );
}
