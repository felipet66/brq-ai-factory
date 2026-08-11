export const AGENT_CONTRACT_INVARIANT_LAYERS = [
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'CODE_GENERATOR',
  'FACTORY_EXECUTION_PROFILE',
] as const;

export const AGENT_CONTRACT_INVARIANT_CLASSIFICATIONS = [
  'AI_AUTHORED',
  'SYSTEM_DERIVED',
  'CROSS_REFERENCE',
  'PROFILE_CONSTRAINT',
  'STRUCTURAL',
  'REDUNDANT',
] as const;

export const AGENT_CONTRACT_INVARIANT_OWNERS = [
  'SCHEMA',
  'BUSINESS_VALIDATION',
  'BACKEND_DERIVATION',
  'EXECUTION_PROFILE',
] as const;

export type AgentContractInvariantLayer = (typeof AGENT_CONTRACT_INVARIANT_LAYERS)[number];
export type AgentContractInvariantClassification =
  (typeof AGENT_CONTRACT_INVARIANT_CLASSIFICATIONS)[number];
export type AgentContractInvariantOwner = (typeof AGENT_CONTRACT_INVARIANT_OWNERS)[number];

export interface AgentContractInvariantDescriptor {
  readonly layer: AgentContractInvariantLayer;
  readonly code: string;
  readonly classifications: readonly AgentContractInvariantClassification[];
  readonly authoritativeOwner: AgentContractInvariantOwner;
  readonly deterministic: true;
}

export interface AgentPromptContractDescriptor {
  readonly layer: Exclude<AgentContractInvariantLayer, 'FACTORY_EXECUTION_PROFILE'>;
  readonly bundleVersion: string;
  readonly requiredRuleIds: readonly string[];
}

export interface FactoryProfileInvariantDescriptor {
  readonly ruleId: string;
  readonly reasonCode: string;
}

export interface AgentContractInvariantCatalog {
  readonly catalogVersion: '1.0.0';
  readonly invariants: readonly AgentContractInvariantDescriptor[];
  readonly promptContracts: readonly AgentPromptContractDescriptor[];
  readonly factoryProfile: {
    readonly profileId: string;
    readonly profileVersion: string;
    readonly rules: readonly FactoryProfileInvariantDescriptor[];
    readonly publicReasonCodes: readonly string[];
  };
}
