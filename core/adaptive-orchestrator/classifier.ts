import type { AdaptiveClassification, AdaptiveExecutionRequest } from './contracts';
import { deepFreeze } from './immutability';

export function classifyAdaptiveRequest(request: AdaptiveExecutionRequest): AdaptiveClassification {
  const { routingSignals } = request;
  const simpleGreenfield =
    routingSignals.deliveryIntent === 'GREENFIELD' &&
    routingSignals.affectedComponentCount === 1 &&
    !routingSignals.hasExternalIntegrations &&
    !routingSignals.requiresDataMigration &&
    !routingSignals.requiresArchitectureDecision &&
    !routingSignals.hasUnresolvedRequirements;

  if (simpleGreenfield) {
    return deepFreeze({ route: 'SIMPLE_GREENFIELD', reasons: ['GREENFIELD_SELF_CONTAINED'] });
  }

  const reasons: AdaptiveClassification['reasons'][number][] = [];
  if (routingSignals.deliveryIntent === 'CHANGE') reasons.push('CHANGE_REQUEST');
  if (routingSignals.affectedComponentCount > 1) reasons.push('MULTIPLE_COMPONENTS');
  if (routingSignals.hasExternalIntegrations) reasons.push('EXTERNAL_INTEGRATION');
  if (routingSignals.requiresDataMigration) reasons.push('DATA_MIGRATION');
  if (routingSignals.requiresArchitectureDecision) reasons.push('ARCHITECTURE_DECISION');
  if (routingSignals.hasUnresolvedRequirements) reasons.push('UNRESOLVED_REQUIREMENTS');

  return deepFreeze({ route: 'PLANNED', reasons });
}
