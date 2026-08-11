import { CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES } from '@brq/code-generator-agent';
import { DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES } from '@brq/developer-agent';
import {
  NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
  type FactoryExecutionProfile,
} from '@brq/factory-execution-profile';
import { PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES } from '@brq/product-owner-agent';
import { QA_BUSINESS_VALIDATION_ISSUE_CODES } from '@brq/qa-agent';

import type {
  AgentContractInvariantCatalog,
  AgentContractInvariantClassification,
  AgentContractInvariantDescriptor,
  AgentContractInvariantLayer,
  AgentContractInvariantOwner,
  AgentPromptContractDescriptor,
  FactoryProfileInvariantDescriptor,
} from './contracts';

function deepFreeze<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function classificationsFor(code: string): readonly AgentContractInvariantClassification[] {
  if (/_(?:READINESS_MISMATCH|COVERAGE_SUMMARY_MISMATCH|INCOMPLETE_SPECIFICATION)$/u.test(code)) {
    return ['SYSTEM_DERIVED', 'REDUNDANT'];
  }
  if (/_(?:INVALID_OUTPUT_STRUCTURE|INVALID_SPECIFICATION_STRUCTURE)$/u.test(code)) {
    return ['STRUCTURAL'];
  }
  if (
    /_(?:REFERENCE|COVERAGE|DEPENDENCY|OWNERSHIP|DATA_MODEL_MISMATCH|INVALID_ORDER|CATEGORY_MISMATCH|PATH_MISMATCH|ENTRYPOINT|DUPLICATE_ID|DUPLICATE_PATH|FILE_DIRECTORY_CONFLICT)/u.test(
      code,
    )
  ) {
    return ['CROSS_REFERENCE'];
  }
  return ['STRUCTURAL'];
}

function ownerFor(
  classifications: readonly AgentContractInvariantClassification[],
): AgentContractInvariantOwner {
  if (classifications.includes('SYSTEM_DERIVED')) return 'BACKEND_DERIVATION';
  if (classifications.includes('CROSS_REFERENCE')) return 'BUSINESS_VALIDATION';
  return 'SCHEMA';
}

function businessInvariants(
  layer: Exclude<AgentContractInvariantLayer, 'FACTORY_EXECUTION_PROFILE'>,
  codes: Readonly<Record<string, string>>,
): readonly AgentContractInvariantDescriptor[] {
  return Object.values(codes).map((code) => {
    const classifications = classificationsFor(code);
    return {
      layer,
      code,
      classifications,
      authoritativeOwner: ownerFor(classifications),
      deterministic: true,
    };
  });
}

function profileRules(
  profile: FactoryExecutionProfile,
): readonly FactoryProfileInvariantDescriptor[] {
  return [
    profile.files.rule,
    profile.files.requiredFilesRule,
    profile.sourceDiscovery.rule,
    profile.testDiscovery.rule,
    profile.modulePolicy.formatRule,
    profile.modulePolicy.importRule,
    profile.packagePolicy.rule,
    profile.contentRules.html.elementsRule,
    profile.contentRules.html.inlineActiveRule,
    profile.contentRules.html.referencesRule,
    profile.contentRules.css.importRule,
    profile.contentRules.css.urlsRule,
    profile.contentRules.javaScript.capabilitiesRule,
    profile.contentRules.javaScript.referencesRule,
    profile.contentRules.json.rule,
  ].map(({ ruleId, reasonCode }) => ({ ruleId, reasonCode }));
}

const PROMPT_CONTRACTS = [
  {
    layer: 'PRODUCT_OWNER',
    bundleVersion: '1.0.1',
    requiredRuleIds: [
      'product-owner:traceable-ids',
      'product-owner:dependency-references',
      'product-owner:ready',
    ],
  },
  {
    layer: 'DEVELOPER',
    bundleVersion: '1.0.3',
    requiredRuleIds: [
      'developer:traceability',
      'developer:component-module-ownership',
      'developer:flow-step-ownership',
      'developer:data-model-evidence',
      'developer:deterministic-order',
    ],
  },
  {
    layer: 'QA',
    bundleVersion: '1.0.4',
    requiredRuleIds: [
      'qa:functional-coverage',
      'qa:coverage-summary',
      'qa:technical-coverage',
      'qa:pairwise-relational-audit',
      'qa:deterministic-readiness',
    ],
  },
  {
    layer: 'CODE_GENERATOR',
    bundleVersion: '1.0.4',
    requiredRuleIds: [
      'code-generator:module-path',
      'code-generator:root-shared-files',
      'code-generator:source-references',
      'code-generator:module-coverage',
      'code-generator:entrypoints',
      'code-generator:host-profile',
      'code-generator:business-validation-preflight',
    ],
  },
] as const satisfies readonly AgentPromptContractDescriptor[];

const PROFILE = NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE;
const PROFILE_RULES = profileRules(PROFILE);
const PROFILE_INVARIANTS: readonly AgentContractInvariantDescriptor[] = PROFILE_RULES.map(
  ({ ruleId }) => ({
    layer: 'FACTORY_EXECUTION_PROFILE',
    code: ruleId,
    classifications: ['PROFILE_CONSTRAINT'],
    authoritativeOwner: 'EXECUTION_PROFILE',
    deterministic: true,
  }),
);

export const AGENT_CONTRACT_INVARIANT_CATALOG: AgentContractInvariantCatalog = deepFreeze({
  catalogVersion: '1.0.0',
  invariants: [
    ...businessInvariants('PRODUCT_OWNER', PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES),
    ...businessInvariants('DEVELOPER', DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES),
    ...businessInvariants('QA', QA_BUSINESS_VALIDATION_ISSUE_CODES),
    ...businessInvariants('CODE_GENERATOR', CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES),
    ...PROFILE_INVARIANTS,
  ],
  promptContracts: PROMPT_CONTRACTS,
  factoryProfile: {
    profileId: PROFILE.identity.profileId,
    profileVersion: PROFILE.identity.version,
    rules: PROFILE_RULES,
    publicReasonCodes: Object.values(PROFILE.publicReasonCodes).flat(),
  },
});

export function listAgentContractInvariants(
  layer?: AgentContractInvariantLayer,
): readonly AgentContractInvariantDescriptor[] {
  return layer === undefined
    ? AGENT_CONTRACT_INVARIANT_CATALOG.invariants
    : AGENT_CONTRACT_INVARIANT_CATALOG.invariants.filter((invariant) => invariant.layer === layer);
}

export function findAgentContractInvariant(
  layer: AgentContractInvariantLayer,
  code: string,
): AgentContractInvariantDescriptor | undefined {
  return AGENT_CONTRACT_INVARIANT_CATALOG.invariants.find(
    (invariant) => invariant.layer === layer && invariant.code === code,
  );
}
