import type {
  FactoryAgent,
  FactoryAgentId,
  FactoryViewModel,
  FactoryVisualStatus,
} from './factory-view-model';

export type AgentVisualState =
  | 'IDLE'
  | 'WAITING'
  | 'WORKING'
  | 'HANDOFF'
  | 'SUCCESS'
  | 'ERROR'
  | 'CANCELLED'
  | 'SKIPPED'
  | 'NOT_OBSERVED';

export type AgentVisualMotion = 'STILL' | 'ACTIVE' | 'TRANSFER' | 'TERMINAL' | 'MUTED';

export interface AgentVisualPresentation {
  readonly agentId: FactoryAgentId;
  readonly state: AgentVisualState;
  readonly assetPath: string;
  readonly technicalStatus: FactoryVisualStatus;
  readonly badgeLabel: string;
  readonly microcopy: string;
  readonly motion: AgentVisualMotion;
}

const ASSET_DIRECTORIES = Object.freeze({
  PRODUCT_OWNER: 'po',
  DEVELOPER: 'developer',
  QA: 'qa',
} satisfies Record<FactoryAgentId, string>);

const ROLE_LABELS = Object.freeze({
  PRODUCT_OWNER: 'Product Owner',
  DEVELOPER: 'Developer',
  QA: 'QA',
} satisfies Record<FactoryAgentId, string>);

const WORKING_COPY = Object.freeze({
  PRODUCT_OWNER: 'Product Owner stage is preparing the product specification.',
  DEVELOPER: 'Developer stage is preparing the technical specification.',
  QA: 'QA stage is preparing the quality specification.',
} satisfies Record<FactoryAgentId, string>);

const WAITING_COPY = Object.freeze({
  PRODUCT_OWNER: 'Waiting for the Product Owner stage to start.',
  DEVELOPER: 'Waiting for an observable Product Owner handoff.',
  QA: 'Waiting for an observable Developer handoff.',
} satisfies Record<FactoryAgentId, string>);

const HANDOFF_COPY = Object.freeze({
  PRODUCT_OWNER: 'Product specification handoff to Developer is observed.',
  DEVELOPER: 'Technical specification handoff to QA is observed.',
  QA: 'QA has no primary outbound handoff in this workflow.',
} satisfies Record<FactoryAgentId, string>);

function hasActiveOutboundHandoff(model: FactoryViewModel, agent: FactoryAgent): boolean {
  return model.handoffs.some((handoff) => {
    if (handoff.kind !== 'PRIMARY' || handoff.status !== 'OBSERVED' || handoff.from !== agent.id)
      return false;

    const target = model.agents.find((candidate) => candidate.id === handoff.to);
    return target?.status === 'WORKING';
  });
}

function deriveState(model: FactoryViewModel, agent: FactoryAgent): AgentVisualState {
  if (
    (model.execution.status === 'CREATED' || model.execution.status === 'QUEUED') &&
    agent.status === 'WAITING'
  ) {
    return 'IDLE';
  }

  if (agent.status === 'COMPLETED' && hasActiveOutboundHandoff(model, agent)) return 'HANDOFF';

  switch (agent.status) {
    case 'WAITING':
      return 'WAITING';
    case 'WORKING':
      return 'WORKING';
    case 'COMPLETED':
      return 'SUCCESS';
    case 'FAILED':
      return 'ERROR';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'SKIPPED':
      return 'SKIPPED';
    case 'NOT_OBSERVED':
      return 'NOT_OBSERVED';
  }
}

function assetFile(state: AgentVisualState): string {
  switch (state) {
    case 'IDLE':
    case 'SKIPPED':
    case 'NOT_OBSERVED':
      return '01-idle.png';
    case 'WAITING':
      return '05-waiting.png';
    case 'WORKING':
      return '03-working.png';
    case 'HANDOFF':
      return '04-handoff.png';
    case 'SUCCESS':
      return '06-success.png';
    case 'ERROR':
    case 'CANCELLED':
      return '07-error.png';
  }
}

function badgeLabel(state: AgentVisualState): string {
  if (state === 'NOT_OBSERVED') return 'NOT OBSERVED';
  return state;
}

function motion(state: AgentVisualState): AgentVisualMotion {
  switch (state) {
    case 'WORKING':
      return 'ACTIVE';
    case 'HANDOFF':
      return 'TRANSFER';
    case 'SUCCESS':
    case 'ERROR':
    case 'CANCELLED':
      return 'TERMINAL';
    case 'SKIPPED':
    case 'NOT_OBSERVED':
      return 'MUTED';
    case 'IDLE':
    case 'WAITING':
      return 'STILL';
  }
}

function microcopy(state: AgentVisualState, agentId: FactoryAgentId): string {
  const role = ROLE_LABELS[agentId];
  switch (state) {
    case 'IDLE':
      return `Execution has not started the ${role} stage.`;
    case 'WAITING':
      return WAITING_COPY[agentId];
    case 'WORKING':
      return WORKING_COPY[agentId];
    case 'HANDOFF':
      return HANDOFF_COPY[agentId];
    case 'SUCCESS':
      return `${role} stage completed.`;
    case 'ERROR':
      return `${role} stage failed.`;
    case 'CANCELLED':
      return `${role} stage was cancelled.`;
    case 'SKIPPED':
      return `${role} stage was skipped.`;
    case 'NOT_OBSERVED':
      return `No timeline evidence is available for the ${role} stage.`;
  }
}

export function resolveAgentVisualState(
  model: FactoryViewModel,
  agent: FactoryAgent,
): AgentVisualPresentation {
  const state = deriveState(model, agent);
  return Object.freeze({
    agentId: agent.id,
    state,
    assetPath: `/assets/${ASSET_DIRECTORIES[agent.id]}/${assetFile(state)}`,
    technicalStatus: agent.status,
    badgeLabel: badgeLabel(state),
    microcopy: microcopy(state, agent.id),
    motion: motion(state),
  });
}
