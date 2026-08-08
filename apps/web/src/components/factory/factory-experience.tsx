'use client';

import { FactoryErrorState, FactoryLoadingState } from './factory-state';
import { FactoryWorkspace } from './factory-workspace';
import styles from './factory.module.css';
import { useFactoryLiveData } from './use-factory-live-data';

interface FactoryExperienceProps {
  readonly executionId: string;
  readonly canAccessPlayground: boolean;
}

export function FactoryExperience({ executionId, canAccessPlayground }: FactoryExperienceProps) {
  const { state, reload } = useFactoryLiveData(executionId);

  return (
    <main className={styles.shell} lang="en">
      <span className={styles.gridBackdrop} aria-hidden="true" />
      <div className={styles.layout}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Live agent workspace</p>
            <h1>
              AI Software Factory
              <span>Control room / execution visualization</span>
            </h1>
          </div>
        </header>

        {state.status === 'loading' ? (
          <FactoryLoadingState />
        ) : state.status === 'error' ? (
          <FactoryErrorState message={state.message} onReload={reload} />
        ) : (
          <FactoryWorkspace
            model={state.model}
            canAccessPlayground={canAccessPlayground}
            updateError={state.updateError}
            onReload={reload}
          />
        )}
      </div>
    </main>
  );
}
