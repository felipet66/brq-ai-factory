import type { FactoryViewModel } from './factory-view-model';
import styles from './factory.module.css';

interface FactoryProgressProps {
  readonly progress: FactoryViewModel['progress'];
  readonly agents: FactoryViewModel['agents'];
}

export function FactoryProgress({ progress, agents }: FactoryProgressProps) {
  return (
    <section className={styles.progressPanel} aria-labelledby="factory-progress-heading">
      <div className={styles.sectionHeading}>
        <h2 id="factory-progress-heading">Factory progress</h2>
        <span>
          {progress.resolvedAgentCount}/{progress.totalAgentCount} agent stages resolved
          {progress.totalTechnicalStageCount === 0
            ? ''
            : ` · ${progress.resolvedTechnicalStageCount}/${progress.totalTechnicalStageCount} technical stages resolved`}
        </span>
      </div>
      <ol className={styles.progressList}>
        {agents.map((agent) => (
          <li className={styles.progressItem} data-state={agent.status} key={agent.id}>
            <div className={styles.progressMeta}>
              <strong>{agent.name}</strong>
              <span>{agent.status.replace('_', ' ')}</span>
            </div>
            <div className={styles.progressTrack} aria-hidden="true">
              <span className={styles.progressFill} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
