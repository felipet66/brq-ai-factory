import { FACTORY_EXECUTION_PROFILE_RULE_IDS } from '@brq/factory-execution-profile';

const SAFE_TECHNICAL_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
type FactoryProfileRuleId =
  (typeof FACTORY_EXECUTION_PROFILE_RULE_IDS)[keyof typeof FACTORY_EXECUTION_PROFILE_RULE_IDS];
const SAFE_FACTORY_PROFILE_RULE_IDS = new Set<FactoryProfileRuleId>(
  Object.values(FACTORY_EXECUTION_PROFILE_RULE_IDS),
);

export function sanitizeTechnicalCode(value: unknown): string | null {
  return typeof value === 'string' && SAFE_TECHNICAL_CODE.test(value) ? value : null;
}

export function sanitizeFactoryProfileRuleId(value: unknown): FactoryProfileRuleId | null {
  return typeof value === 'string' &&
    SAFE_FACTORY_PROFILE_RULE_IDS.has(value as FactoryProfileRuleId)
    ? (value as FactoryProfileRuleId)
    : null;
}
