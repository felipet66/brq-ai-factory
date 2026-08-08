import styles from './auth.module.css';

interface AuthLoadingStateProps {
  readonly label: string;
}

export function AuthLoadingState({ label }: AuthLoadingStateProps) {
  return (
    <div className={styles.loadingState} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
