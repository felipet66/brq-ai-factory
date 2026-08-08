import { formatDuration, formatTimestamp } from './factory-format';
import type { FactorySystemStage } from './factory-view-model';
import styles from './factory.module.css';

interface KnowledgeStageProps {
  readonly knowledge: FactorySystemStage;
}

export function KnowledgeStage({ knowledge }: KnowledgeStageProps) {
  return (
    <section
      className={styles.knowledgeRail}
      data-state={knowledge.status}
      aria-labelledby="factory-knowledge-heading"
    >
      <div className={styles.knowledgeCore}>
        <div className={styles.knowledgeGlyph} aria-hidden="true">
          K-LD
        </div>
        <div className={styles.knowledgeCopy}>
          <h2 id="factory-knowledge-heading">Knowledge system preflight</h2>
          <span>Initial Product Owner context boundary</span>
        </div>
      </div>
      <div className={styles.knowledgeState}>
        <div className={styles.signalBars} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <strong>{knowledge.status.replace('_', ' ')}</strong>
        <time dateTime={knowledge.finishedAt ?? knowledge.startedAt ?? undefined}>
          {knowledge.durationMs === null
            ? formatTimestamp(knowledge.startedAt)
            : formatDuration(knowledge.durationMs)}
        </time>
      </div>
    </section>
  );
}
