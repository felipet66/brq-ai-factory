import {
  FACTORY_PIPELINE_STAGE_IDS,
  createFactoryPipelineCoordinator,
  factoryExecutionResultSchema,
  type FactoryExecutionResult,
  type FactoryPipelineCoordinator,
} from '@brq/factory-pipeline';
import {
  createFactoryExecutionResultFixture,
  createFactoryPipelineConfigurationFixture,
} from '@brq/factory-pipeline/testing';
import { describe, expect, it } from 'vitest';

describe('@brq/factory-pipeline package exports', () => {
  it('exposes the coordinator port, canonical contracts and testing fixtures', () => {
    const coordinator: FactoryPipelineCoordinator | undefined = undefined;
    const result: FactoryExecutionResult = createFactoryExecutionResultFixture();
    expect(coordinator).toBeUndefined();
    expect(createFactoryPipelineCoordinator).toBeTypeOf('function');
    expect(factoryExecutionResultSchema.parse(result)).toEqual(result);
    expect(createFactoryPipelineConfigurationFixture()).toBeDefined();
    expect(FACTORY_PIPELINE_STAGE_IDS).toHaveLength(12);
  });
});
