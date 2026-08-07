import styles from './history.module.css';

interface HistoryLoadingStateProps {
  readonly label: string;
}

interface HistoryErrorStateProps {
  readonly message: string;
}

export function HistoryLoadingState({ label }: HistoryLoadingStateProps) {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function HistoryErrorState({ message }: HistoryErrorStateProps) {
  return (
    <div className={`${styles.state} ${styles.errorState}`} role="alert">
      <strong>Unable to load execution history</strong>
      <p>{message}</p>
    </div>
  );
}

export function HistoryEmptyState() {
  return (
    <div className={styles.state} role="status">
      <strong>No executions yet</strong>
      <p>Completed and active workflows will appear here.</p>
    </div>
  );
}
