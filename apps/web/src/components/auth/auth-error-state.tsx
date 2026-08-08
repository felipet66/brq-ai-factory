import styles from './auth.module.css';

interface AuthErrorStateProps {
  readonly message: string;
}

export function AuthErrorState({ message }: AuthErrorStateProps) {
  return (
    <div className={styles.errorState} role="alert">
      <strong>Unable to complete authentication</strong>
      <span>{message}</span>
    </div>
  );
}
