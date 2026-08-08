import styles from './factory.module.css';

export function FactoryLoadingState() {
  return (
    <section className={styles.stateShell} aria-live="polite" aria-busy="true">
      <div className={styles.stateContent}>
        <span className={styles.loadingCore} aria-hidden="true" />
        <p className={styles.eyebrow}>Connecting control plane</p>
        <h2>Loading factory state</h2>
        <p>Reading execution metadata and the latest observable timeline.</p>
      </div>
    </section>
  );
}

interface FactoryErrorStateProps {
  readonly message: string;
  readonly onReload: () => void;
}

export function FactoryErrorState({ message, onReload }: FactoryErrorStateProps) {
  return (
    <section className={styles.stateShell} role="alert">
      <div className={styles.stateContent}>
        <span className={styles.errorMark} aria-hidden="true">
          !
        </span>
        <p className={styles.eyebrow}>Control plane unavailable</p>
        <h2>Factory state could not be loaded</h2>
        <p>{message}</p>
        <button className={styles.reloadButton} type="button" onClick={onReload}>
          Reload factory state
        </button>
      </div>
    </section>
  );
}
