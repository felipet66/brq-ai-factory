import { describe, expect, it } from 'vitest';

import { calculateFactoryPipelineResultHash, deriveCodeGeneratorExecutionId } from './hashing';
import { createFactoryExecutionResultFixture } from './testing/factory-pipeline-fixtures';

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

describe('Factory Pipeline hashing', () => {
  it('is deterministic and domain-separates the Code Generator execution identity', () => {
    const result = createFactoryExecutionResultFixture();
    const { factoryResultHash, ...hashes } = result.hashes;
    expect(calculateFactoryPipelineResultHash({ ...result, hashes })).toBe(factoryResultHash);
    expect(deriveCodeGeneratorExecutionId(result.hashes.executionHash)).toBe(
      deriveCodeGeneratorExecutionId(result.hashes.executionHash),
    );
    expect(deriveCodeGeneratorExecutionId(result.hashes.executionHash)).toMatch(
      /^agent-execution-code-generator-[a-f0-9]{32}$/u,
    );
  });

  it('keeps observational timestamps and durations outside the functional result hash', () => {
    const result = createFactoryExecutionResultFixture();
    const { factoryResultHash, ...hashes } = result.hashes;
    expect(factoryResultHash).toBe(result.hashes.factoryResultHash);
    const observed = structuredClone({ ...result, hashes }) as Mutable<
      Omit<typeof result, 'hashes'> & { hashes: typeof hashes }
    >;
    observed.startedAt = '2026-08-11T00:00:00.000Z';
    observed.finishedAt = '2026-08-11T00:01:00.000Z';
    observed.durationMs = 60_000;
    observed.stages[0]!.durationMs = 999;
    observed.sandbox.steps[0]!.durationMs = 888;
    expect(calculateFactoryPipelineResultHash(observed)).toBe(result.hashes.factoryResultHash);
  });
});
