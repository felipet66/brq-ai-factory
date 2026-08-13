import type {
  AdaptiveExecutionRequest,
  BuilderPortResult,
  PlannerPortResult,
  VerifierPortResult,
} from '../contracts';

export function createAdaptiveRequestFixture(
  overrides: Partial<AdaptiveExecutionRequest['routingSignals']> = {},
): AdaptiveExecutionRequest {
  return {
    requestId: 'request-adaptive-1',
    demand: {
      text: 'Create an accessible local calculator.',
      additionalContext: 'Keep the implementation self-contained.',
    },
    profile: {
      profileId: 'NODE_WEB_PREVIEW_24_V1',
      version: '1.1.0',
      profileHash: 'a'.repeat(64),
      constraintsHash: 'b'.repeat(64),
      capabilityIds: ['STATIC_WEB', 'NODE_TEST'],
    },
    routingSignals: {
      deliveryIntent: 'GREENFIELD',
      affectedComponentCount: 1,
      hasExternalIntegrations: false,
      requiresDataMigration: false,
      requiresArchitectureDecision: false,
      hasUnresolvedRequirements: false,
      ...overrides,
    },
  };
}

export function createPlannerResultFixture(): PlannerPortResult {
  return {
    steps: [
      { stepId: 'step-1', objective: 'Implement the application.' },
      { stepId: 'step-2', objective: 'Add deterministic tests.' },
    ],
    usage: { inputTokens: 11, outputTokens: 7 },
  };
}

export function createBuilderResultFixture(seed = 'c'): BuilderPortResult {
  return {
    candidate: {
      bundleId: `bundle-${seed}`,
      bundleHash: seed.repeat(64),
      manifestHash: seed.repeat(64),
    },
    usage: { inputTokens: 23, outputTokens: 17 },
  };
}

export function successfulVerificationFixture(seed = 'f'): VerifierPortResult {
  return { status: 'SUCCESS', verificationHash: seed.repeat(64) };
}

export function codeFailureFixture(): Extract<VerifierPortResult, { status: 'CODE_FAILURE' }> {
  return {
    status: 'CODE_FAILURE',
    diagnostic: { kind: 'CODE_FAILURE', stage: 'TEST', reasonCode: 'TEST_FAILED' },
  };
}

export function infraFailureFixture(): Extract<VerifierPortResult, { status: 'INFRA_FAILURE' }> {
  return {
    status: 'INFRA_FAILURE',
    diagnostic: {
      kind: 'INFRA_FAILURE',
      stage: 'RUNTIME',
      reasonCode: 'RUNTIME_TIMEOUT',
    },
  };
}
