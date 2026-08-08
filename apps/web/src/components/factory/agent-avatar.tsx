import Image from 'next/image';

import type { AgentVisualPresentation } from './agent-visual-state';
import styles from './factory.module.css';

interface AgentAvatarProps {
  readonly agentName: string;
  readonly presentation: AgentVisualPresentation;
}

export function AgentAvatar({ agentName, presentation }: AgentAvatarProps) {
  return (
    <span
      className={styles.agentPortrait}
      data-visual-state={presentation.state}
      data-motion={presentation.motion}
      aria-label={`${agentName} visual state: ${presentation.badgeLabel}`}
      role="img"
    >
      <span className={styles.agentPortraitGlow} aria-hidden="true" />
      <Image
        className={styles.agentPortraitImage}
        src={presentation.assetPath}
        alt=""
        aria-hidden="true"
        width={1254}
        height={1254}
        sizes="(max-width: 48rem) 72vw, (max-width: 72rem) 34vw, 20vw"
        loading={presentation.agentId === 'PRODUCT_OWNER' ? 'eager' : 'lazy'}
      />
    </span>
  );
}
