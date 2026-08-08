import type { PlaygroundAgent, PlaygroundAgentDescriptor } from '@/api/playground-contracts';

import styles from './playground.module.css';

interface AgentSelectorProps {
  readonly agents: readonly PlaygroundAgentDescriptor[];
  readonly disabled: boolean;
  readonly onChange: (agent: PlaygroundAgent) => void;
  readonly value: PlaygroundAgent;
}

export function AgentSelector({ agents, disabled, onChange, value }: AgentSelectorProps) {
  return (
    <fieldset className={styles.agentSelector} disabled={disabled}>
      <legend>Agent</legend>
      <p>Select the participant whose prompt pipeline you want to inspect.</p>
      <div className={styles.agentOptions}>
        {agents.map((agent, index) => (
          <label
            key={agent.agent}
            className={styles.agentOption}
            data-selected={value === agent.agent}
          >
            <input
              type="radio"
              name="playground-agent"
              value={agent.agent}
              checked={value === agent.agent}
              onChange={() => onChange(agent.agent)}
            />
            <span className={styles.agentSequence} aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span>
              <strong>{agent.label}</strong>
              <small>{agent.description}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
