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
    expect(factoryResultHash).toBe(
      '46aee8db3e45446af65c394b131c79f0e76d1a55b77a1cfc7d4f40ec6478bdd3',
    );
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

  it('includes the safe TypeScript diagnostic summary in the v2 result identity', () => {
    const result = createFactoryExecutionResultFixture();
    const { factoryResultHash, ...hashes } = result.hashes;
    void factoryResultHash;
    const observed = structuredClone({ ...result, hashes }) as Mutable<
      Omit<typeof result, 'hashes'> & { hashes: typeof hashes }
    >;
    const stage = observed.stages.find((candidate) => candidate.stageId === 'SANDBOX_TYPECHECK')!;
    stage.status = 'FAILED';
    stage.diagnosticSummary = {
      diagnosticCount: 2,
      diagnosticCodes: [2307, 2322],
      truncated: false,
    };
    stage.failure = {
      code: 'FACTORY_PIPELINE_SANDBOX_FAILED',
      stage: 'SANDBOX_TYPECHECK',
      sourceCode: null,
      reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
      profileRuleId: null,
      diagnosticSummary: stage.diagnosticSummary,
      message: 'TypeScript diagnostics.',
    };

    expect(calculateFactoryPipelineResultHash(observed)).not.toBe(result.hashes.factoryResultHash);
    expect(calculateFactoryPipelineResultHash(observed)).toBe(
      calculateFactoryPipelineResultHash(structuredClone(observed)),
    );
  });

  it('preserves the v2 identity without cleanup evidence and binds new cleanup evidence in v3', () => {
    const result = createFactoryExecutionResultFixture();
    const { factoryResultHash, ...hashes } = result.hashes;
    const observed = structuredClone({ ...result, hashes }) as Mutable<
      Omit<typeof result, 'hashes'> & { hashes: typeof hashes }
    >;

    expect(calculateFactoryPipelineResultHash(observed)).toBe(factoryResultHash);
    observed.sandbox.cleanupFailure = {
      code: 'SANDBOX_CLEANUP_FAILED',
      stage: 'CLEANUP',
      sourceCode: 'REMOVAL_NOT_CONFIRMED',
      reasonCode: null,
      diagnosticSummary: null,
      message: 'Cleanup failure A.',
    };
    const first = calculateFactoryPipelineResultHash(observed);
    observed.sandbox.cleanupFailure.message = 'Cleanup failure B.';
    expect(calculateFactoryPipelineResultHash(observed)).toBe(first);
    observed.sandbox.cleanupFailure.sourceCode = 'OWNERSHIP_NOT_CONFIRMED';
    expect(calculateFactoryPipelineResultHash(observed)).not.toBe(first);
  });
});
