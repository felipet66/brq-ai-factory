'use client';

import { useEffect, useRef, useState } from 'react';

import { AgentConnection } from './agent-connection';
import { AgentDetailPanel } from './agent-detail-panel';
import { AgentStation } from './agent-station';
import { ExecutionHeader } from './execution-header';
import { FactoryActivityFeed } from './factory-activity-feed';
import { FactoryProgress } from './factory-progress';
import type { FactoryAgentId, FactoryViewModel } from './factory-view-model';
import { KnowledgeStage } from './knowledge-stage';
import styles from './factory.module.css';

interface FactoryWorkspaceProps {
  readonly model: FactoryViewModel;
  readonly canAccessPlayground: boolean;
  readonly updateError: string | null;
  readonly onReload: () => void;
}

export function FactoryWorkspace({
  model,
  canAccessPlayground,
  updateError,
  onReload,
}: FactoryWorkspaceProps) {
  const initialSelection = model.progress.activeAgentId ?? model.agents[0].id;
  const [selectedId, setSelectedId] = useState<FactoryAgentId>(initialSelection);
  const manualSelection = useRef(false);
  const stationRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!manualSelection.current && model.progress.activeAgentId !== null) {
      setSelectedId(model.progress.activeAgentId);
    }
  }, [model.progress.activeAgentId]);

  const selectedAgent = model.agents.find((agent) => agent.id === selectedId) ?? model.agents[0];
  const primaryHandoffs = model.handoffs.filter((handoff) => handoff.kind === 'PRIMARY');

  function selectAgent(agentId: FactoryAgentId): void {
    manualSelection.current = true;
    setSelectedId(agentId);
  }

  function navigateFrom(index: number, direction: -1 | 1): void {
    const nextIndex = (index + direction + model.agents.length) % model.agents.length;
    const next = model.agents[nextIndex]!;
    selectAgent(next.id);
    stationRefs.current[nextIndex]?.focus();
  }

  return (
    <section className={styles.controlRoom} aria-label="AI Software Factory control room">
      <header className={styles.controlTopbar}>
        <div className={styles.controlIdentity}>
          <span className={styles.controlMark} aria-hidden="true" />
          <span>
            <strong>BRQ / Factory control plane</strong>
            <small>Read-only execution visualization · VM {model.version}</small>
          </span>
        </div>
        <div className={styles.statusLights} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </header>

      <ExecutionHeader execution={model.execution} canAccessPlayground={canAccessPlayground} />
      <FactoryProgress progress={model.progress} agents={model.agents} />
      <KnowledgeStage knowledge={model.knowledge} />

      <ol className={styles.factoryFloor} aria-label="Agent production line">
        {model.agents.map((agent, index) => (
          <AgentSequence
            key={agent.id}
            agent={agent}
            index={index}
            selected={selectedAgent.id === agent.id}
            buttonRef={(element) => {
              stationRefs.current[index] = element;
            }}
            onSelect={() => selectAgent(agent.id)}
            onNavigate={(direction) => navigateFrom(index, direction)}
            {...(index < primaryHandoffs.length ? { handoff: primaryHandoffs[index]! } : {})}
          />
        ))}
      </ol>

      <div className={styles.operationsGrid}>
        <FactoryActivityFeed activity={model.activity} />
        <AgentDetailPanel
          agent={selectedAgent}
          handoffs={model.handoffs}
          executionId={model.execution.executionId}
          canAccessPlayground={canAccessPlayground}
        />
      </div>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {model.progress.activeAgentId === null
          ? `Factory status ${model.progress.status}`
          : `${model.agents.find((agent) => agent.id === model.progress.activeAgentId)?.name} working`}
      </p>

      {updateError === null ? null : (
        <div className={styles.updateNotice} role="status">
          <span>{updateError} The last verified factory state remains visible.</span>
          <button className={styles.reloadButton} type="button" onClick={onReload}>
            Reload live data
          </button>
        </div>
      )}
    </section>
  );
}

interface AgentSequenceProps {
  readonly agent: FactoryViewModel['agents'][number];
  readonly index: number;
  readonly selected: boolean;
  readonly buttonRef: (element: HTMLButtonElement | null) => void;
  readonly onSelect: () => void;
  readonly onNavigate: (direction: -1 | 1) => void;
  readonly handoff?: FactoryViewModel['handoffs'][number];
}

function AgentSequence({ handoff, ...stationProps }: AgentSequenceProps) {
  return (
    <>
      <AgentStation {...stationProps} />
      {handoff === undefined ? null : <AgentConnection handoff={handoff} />}
    </>
  );
}
