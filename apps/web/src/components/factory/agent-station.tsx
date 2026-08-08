import type { KeyboardEvent, Ref } from 'react';

import { formatDuration, shortHash } from './factory-format';
import type { FactoryAgent } from './factory-view-model';
import styles from './factory.module.css';

interface AgentStationProps {
  readonly agent: FactoryAgent;
  readonly index: number;
  readonly selected: boolean;
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly onSelect: () => void;
  readonly onNavigate: (direction: -1 | 1) => void;
}

function monogram(agent: FactoryAgent): string {
  if (agent.id === 'PRODUCT_OWNER') return 'PO';
  if (agent.id === 'DEVELOPER') return 'DEV';
  return 'QA';
}

function handleStationKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  onNavigate: AgentStationProps['onNavigate'],
): void {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    onNavigate(1);
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    onNavigate(-1);
  }
}

export function AgentStation({
  agent,
  index,
  selected,
  buttonRef,
  onSelect,
  onNavigate,
}: AgentStationProps) {
  return (
    <li className={styles.stationSlot}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.station}
        data-agent={agent.id}
        data-state={agent.status}
        aria-pressed={selected}
        aria-controls="factory-agent-detail"
        aria-label={`${agent.name} station, ${agent.status.replace('_', ' ')}`}
        onClick={onSelect}
        onKeyDown={(event) => handleStationKeyDown(event, onNavigate)}
      >
        <span className={styles.stationTop}>
          <span className={styles.stationNumber}>STATION {String(index + 1).padStart(2, '0')}</span>
          <span className={styles.stationSignal} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </span>
        <span className={styles.stationBody}>
          <span className={styles.agentCore}>
            <span className={styles.agentGlyph} aria-hidden="true">
              <span>{monogram(agent)}</span>
            </span>
            <span className={styles.agentIdentity}>
              <span className={styles.agentRole}>{agent.role}</span>
              <strong className={styles.agentName}>{agent.name}</strong>
              <span className={styles.stateBadge} data-state={agent.status}>
                {agent.status.replace('_', ' ')}
              </span>
            </span>
          </span>
          <span className={styles.telemetry}>
            <span>
              <span>Readiness</span>
              <strong>{agent.readiness ?? '—'}</strong>
            </span>
            <span>
              <span>Runtime</span>
              <strong>{formatDuration(agent.durationMs)}</strong>
            </span>
          </span>
          <span className={styles.stationFooter}>
            <span>OUTPUT SIGNAL</span>
            <strong>{shortHash(agent.hashes.output?.hash ?? null)}</strong>
          </span>
        </span>
      </button>
    </li>
  );
}
