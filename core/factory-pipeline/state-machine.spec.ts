import { describe, expect, it } from 'vitest';

import { FactoryPipelineError } from './errors';
import {
  FACTORY_PIPELINE_STAGE_IDS,
  subsequentFactoryPipelineStages,
  transitionFactoryPipelineStage,
} from './state-machine';

describe('Factory Pipeline state machine', () => {
  it('uses one canonical fail-fast order with eleven functional stages', () => {
    expect(FACTORY_PIPELINE_STAGE_IDS).toEqual([
      'PRODUCT_OWNER',
      'DEVELOPER',
      'QA',
      'CODE_GENERATOR',
      'WORKSPACE_PLAN',
      'WORKSPACE_MATERIALIZATION',
      'SANDBOX_PREPARE',
      'SANDBOX_TYPECHECK',
      'SANDBOX_BUILD',
      'SANDBOX_TEST',
      'WORKSPACE_RELEASE',
    ]);
    expect(subsequentFactoryPipelineStages('QA')).toEqual([
      'CODE_GENERATOR',
      'WORKSPACE_PLAN',
      'WORKSPACE_MATERIALIZATION',
      'SANDBOX_PREPARE',
      'SANDBOX_TYPECHECK',
      'SANDBOX_BUILD',
      'SANDBOX_TEST',
      'WORKSPACE_RELEASE',
    ]);
  });

  it('allows only PENDING to RUNNING/SKIPPED and RUNNING to a terminal state', () => {
    expect(transitionFactoryPipelineStage('PENDING', 'RUNNING', 'CODE_GENERATOR')).toBe('RUNNING');
    expect(transitionFactoryPipelineStage('RUNNING', 'SUCCESS', 'CODE_GENERATOR')).toBe('SUCCESS');
    expect(transitionFactoryPipelineStage('PENDING', 'SKIPPED', 'SANDBOX_TEST')).toBe('SKIPPED');
    expect(() => transitionFactoryPipelineStage('SUCCESS', 'RUNNING', 'CODE_GENERATOR')).toThrow(
      FactoryPipelineError,
    );
  });
});
