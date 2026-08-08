import styles from './playground.module.css';

export function PlaygroundLoadingState() {
  return (
    <div className={styles.fullState} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <div>
        <strong>Loading inspection catalog</strong>
        <p>Resolving the available agents and safe examples.</p>
      </div>
    </div>
  );
}

interface PlaygroundErrorStateProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function PlaygroundErrorState({ message, onRetry }: PlaygroundErrorStateProps) {
  return (
    <div className={`${styles.fullState} ${styles.errorState}`} role="alert">
      <div>
        <strong>Playground unavailable</strong>
        <p>{message}</p>
      </div>
      {onRetry === undefined ? null : (
        <button type="button" className={styles.secondaryButton} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

interface EmptyInspectorStateProps {
  readonly title: string;
}

export function EmptyInspectorState({ title }: EmptyInspectorStateProps) {
  return (
    <div className={styles.emptyInspector} role="status">
      <span aria-hidden="true">◇</span>
      <div>
        <strong>{title}</strong>
        <p>Load an example or provide input, then build a preview to resolve this view.</p>
      </div>
    </div>
  );
}
