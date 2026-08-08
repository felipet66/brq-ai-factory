import { shortHash } from './factory-format';
import type { FactoryArtifact } from './factory-view-model';
import styles from './factory.module.css';

interface ArtifactCardProps {
  readonly artifact: FactoryArtifact;
}

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  return (
    <li className={styles.artifactCard}>
      <span className={styles.artifactIndex} aria-hidden="true">
        {String(artifact.ordinal).padStart(2, '0')}
      </span>
      <span className={styles.artifactCopy}>
        <strong>Artifact {artifact.ordinal}</strong>
        <code title={artifact.hash}>{shortHash(artifact.hash, 18)}</code>
      </span>
      <span className={styles.artifactStatus}>{artifact.status}</span>
    </li>
  );
}
