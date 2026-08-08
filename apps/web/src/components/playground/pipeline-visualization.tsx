import type { PlaygroundPipelineNode, PlaygroundPipelineStage } from '@/api/playground-contracts';

import styles from './playground.module.css';

interface PipelineVisualizationProps {
  readonly nodes: readonly PlaygroundPipelineNode[];
  readonly onSelect: (stage: PlaygroundPipelineStage) => void;
  readonly selected: PlaygroundPipelineStage;
}

const STATUS_LABELS = {
  IDLE: 'Idle',
  VALID: 'Valid',
  WARNING: 'Warning',
  ERROR: 'Error',
} as const;

export function PipelineVisualization({ nodes, onSelect, selected }: PipelineVisualizationProps) {
  return (
    <section className={styles.pipelinePanel} aria-labelledby="prompt-pipeline-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Build telemetry</p>
          <h2 id="prompt-pipeline-heading">Prompt build pipeline</h2>
        </div>
        <span>{nodes.every((node) => node.status === 'IDLE') ? 'Awaiting build' : 'Resolved'}</span>
      </div>
      <ol className={styles.pipeline} aria-label="Prompt build stages">
        {nodes.map((node, index) => (
          <li key={node.stage} data-status={node.status}>
            <button
              type="button"
              aria-pressed={selected === node.stage}
              aria-describedby={`pipeline-${node.stage.toLowerCase()}-status`}
              onClick={() => onSelect(node.stage)}
            >
              <span className={styles.pipelineIndex} aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <strong>{node.stage}</strong>
              <span id={`pipeline-${node.stage.toLowerCase()}-status`}>
                {STATUS_LABELS[node.status]}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface PipelineNodeDetailsProps {
  readonly node: PlaygroundPipelineNode;
}

export function PipelineNodeDetails({ node }: PipelineNodeDetailsProps) {
  return (
    <section className={styles.nodeDetails} aria-labelledby="pipeline-node-details-heading">
      <div>
        <p className={styles.kicker}>Selected stage · {node.status}</p>
        <h3 id="pipeline-node-details-heading">{node.stage}</h3>
        <p>{node.detail ?? 'This stage has not run yet.'}</p>
      </div>
    </section>
  );
}
