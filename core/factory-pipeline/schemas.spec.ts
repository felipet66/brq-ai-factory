import { describe, expect, it } from 'vitest';

import {
  createFactoryExecutionResultFixture,
  createFactoryPipelineConfigurationFixture,
} from './testing/factory-pipeline-fixtures';
import {
  factoryExecutionResultSchema,
  factoryPipelineConfigurationSchema,
  factoryPipelineStageResultSchema,
} from './schemas';

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

describe('Factory Pipeline schemas', () => {
  it('accepts a canonical immutable metadata-only FactoryExecutionResult', () => {
    const result = createFactoryExecutionResultFixture();
    expect(factoryExecutionResultSchema.parse(result)).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.stages)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /"technicalSpecification"\s*:|"prompt"\s*:|"fileContent"\s*:|"summary"\s*:/iu,
    );
  });

  it('rejects hash tampering and noncanonical stage ordering', () => {
    const result = createFactoryExecutionResultFixture();
    const tampered = structuredClone(result) as Mutable<typeof result>;
    tampered.hashes.factoryResultHash = '0'.repeat(64);
    const reordered = structuredClone(result) as Mutable<typeof result>;
    reordered.stages.reverse();
    expect(factoryExecutionResultSchema.safeParse(tampered).success).toBe(false);
    expect(factoryExecutionResultSchema.safeParse(reordered).success).toBe(false);
  });

  it('keeps skipped stages free from invented observations', () => {
    expect(
      factoryPipelineStageResultSchema.parse({
        stageId: 'SANDBOX_TEST',
        status: 'SKIPPED',
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        outputHash: null,
        failure: null,
      }),
    ).toBeDefined();
    expect(
      factoryPipelineStageResultSchema.safeParse({
        stageId: 'SANDBOX_TEST',
        status: 'SKIPPED',
        startedAt: '2026-08-10T00:00:00.000Z',
        finishedAt: null,
        durationMs: null,
        outputHash: null,
        failure: null,
      }).success,
    ).toBe(false);
  });

  it('validates trusted host configuration without adding runtime defaults', () => {
    const configuration = createFactoryPipelineConfigurationFixture();
    expect(factoryPipelineConfigurationSchema.parse(configuration)).toEqual(configuration);
    expect(
      factoryPipelineConfigurationSchema.safeParse({
        ...configuration,
        sandbox: { policyId: 'ANOTHER_SANDBOX_PROFILE_V1' },
      }).success,
    ).toBe(false);
  });
});
