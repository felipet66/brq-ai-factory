export interface FrontendAgentProfile {
  readonly agentVersion: string;
  readonly model: string;
}

export interface FrontendExecutionProfile {
  readonly productOwner: FrontendAgentProfile;
  readonly developer: FrontendAgentProfile;
  readonly qa: FrontendAgentProfile;
}

const MVP_AGENT_PROFILE = Object.freeze({
  agentVersion: '1.0.0',
  model: 'gpt-5-mini',
});

/**
 * Host-owned technical profile for the synchronous Frontend MVP.
 *
 * This is presentation-host configuration, not a domain default. Future API evolution should
 * resolve the agent profile in the backend instead of requiring the browser to transport it.
 */
export const FRONTEND_EXECUTION_PROFILE: FrontendExecutionProfile = Object.freeze({
  productOwner: MVP_AGENT_PROFILE,
  developer: MVP_AGENT_PROFILE,
  qa: MVP_AGENT_PROFILE,
});
