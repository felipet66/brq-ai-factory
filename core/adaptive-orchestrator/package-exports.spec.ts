import { describe, expect, it } from 'vitest';

import {
  ADAPTIVE_ORCHESTRATOR_CONTRACT_VERSION,
  ADAPTIVE_ORCHESTRATOR_ERROR_CODES,
  ADAPTIVE_ORCHESTRATOR_VERSION,
  adaptiveExecutionRequestSchema,
  classifyAdaptiveRequest,
  createAdaptiveOrchestrator,
  type AdaptiveExecutionRequest,
} from './index';
import { createAdaptiveRequestFixture } from './testing/fixtures';

describe('@brq/adaptive-orchestrator public API', () => {
  it('exports the engine, classifier, strict contracts, versions, and errors', () => {
    const request: AdaptiveExecutionRequest = createAdaptiveRequestFixture();
    expect(createAdaptiveOrchestrator).toBeTypeOf('function');
    expect(classifyAdaptiveRequest(request).route).toBe('SIMPLE_GREENFIELD');
    expect(adaptiveExecutionRequestSchema.safeParse(request).success).toBe(true);
    expect(ADAPTIVE_ORCHESTRATOR_VERSION).toBe('0.1.0');
    expect(ADAPTIVE_ORCHESTRATOR_CONTRACT_VERSION).toBe('1.0.0');
    expect(ADAPTIVE_ORCHESTRATOR_ERROR_CODES.CHECKPOINT_INVALID).toBe(
      'ADAPTIVE_ORCHESTRATOR_CHECKPOINT_INVALID',
    );
  });
});
