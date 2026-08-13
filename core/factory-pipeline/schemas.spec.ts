import { describe, expect, it } from 'vitest';
import { FACTORY_EXECUTION_PROFILE_RULE_IDS } from '@brq/factory-execution-profile';

import {
  createFactoryExecutionResultFixture,
  createFactoryPipelineConfigurationFixture,
} from './testing/factory-pipeline-fixtures';
import {
  factoryExecutionResultSchema,
  factoryPipelineConfigurationSchema,
  factoryPipelineStageResultSchema,
  factorySourceExecutionSummarySchema,
  factoryTypeScriptDiagnosticSummarySchema,
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
        profileRuleId: null,
        diagnosticSummary: null,
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
        profileRuleId: null,
        diagnosticSummary: null,
        failure: null,
      }).success,
    ).toBe(false);
  });

  it('accepts only allowlisted profile rule diagnostics at CODE_PROFILE_VALIDATION', () => {
    const failure = {
      code: 'FACTORY_PIPELINE_CODE_PROFILE_VALIDATION_FAILED',
      stage: 'CODE_PROFILE_VALIDATION' as const,
      sourceCode: null,
      reasonCode: 'EXTERNAL_OR_UNSAFE_REFERENCE',
      profileRuleId: FACTORY_EXECUTION_PROFILE_RULE_IDS.JAVASCRIPT_REFERENCES,
      diagnosticSummary: null,
      message: 'O profile rejeitou o bundle.',
    };
    const stage = {
      stageId: 'CODE_PROFILE_VALIDATION' as const,
      status: 'FAILED' as const,
      startedAt: '2026-08-12T00:00:00.000Z',
      finishedAt: '2026-08-12T00:00:00.001Z',
      durationMs: 1,
      outputHash: 'a'.repeat(64),
      profileRuleId: FACTORY_EXECUTION_PROFILE_RULE_IDS.JAVASCRIPT_REFERENCES,
      diagnosticSummary: null,
      failure,
    };

    expect(factoryPipelineStageResultSchema.parse(stage).profileRuleId).toBe(
      FACTORY_EXECUTION_PROFILE_RULE_IDS.JAVASCRIPT_REFERENCES,
    );
    expect(
      factoryPipelineStageResultSchema.safeParse({
        ...stage,
        profileRuleId: 'customer.private.literal',
        failure: { ...failure, profileRuleId: 'customer.private.literal' },
      }).success,
    ).toBe(false);
    expect(
      factoryPipelineStageResultSchema.safeParse({
        ...stage,
        stageId: 'CODE_GENERATOR',
        failure: { ...failure, stage: 'CODE_GENERATOR' },
      }).success,
    ).toBe(false);
  });

  it('reuses the bounded Sandbox TypeScript diagnostic contract only for failed typecheck', () => {
    const diagnosticSummary = {
      diagnosticCount: 3,
      diagnosticCodes: [2307, 2322],
      truncated: false,
    } as const;
    const failure = {
      code: 'SANDBOX_STEP_FAILED',
      stage: 'SANDBOX_TYPECHECK' as const,
      sourceCode: null,
      reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
      profileRuleId: null,
      diagnosticSummary,
      message: 'O typecheck falhou.',
    };
    const stage = {
      stageId: 'SANDBOX_TYPECHECK' as const,
      status: 'FAILED' as const,
      startedAt: '2026-08-12T00:00:00.000Z',
      finishedAt: '2026-08-12T00:00:00.001Z',
      durationMs: 1,
      outputHash: 'a'.repeat(64),
      profileRuleId: null,
      diagnosticSummary,
      failure,
    };

    expect(factoryPipelineStageResultSchema.parse(stage).diagnosticSummary).toEqual(
      diagnosticSummary,
    );
    expect(
      factoryTypeScriptDiagnosticSummarySchema.safeParse({
        ...diagnosticSummary,
        diagnosticCodes: [],
      }).success,
    ).toBe(false);
    expect(
      factoryTypeScriptDiagnosticSummarySchema.safeParse({
        diagnosticCount: 1,
        diagnosticCodes: [2307, 2322],
        truncated: false,
      }).success,
    ).toBe(false);
    expect(
      factoryPipelineStageResultSchema.safeParse({
        ...stage,
        stageId: 'SANDBOX_BUILD',
        failure: { ...failure, stage: 'SANDBOX_BUILD' },
      }).success,
    ).toBe(false);
    expect(
      factoryPipelineStageResultSchema.safeParse({
        ...stage,
        diagnosticSummary: { ...diagnosticSummary, diagnosticCodes: [2322] },
      }).success,
    ).toBe(false);
  });

  it('rejects Factory source evidence that contradicts the recorded upstream readiness', () => {
    const source = createFactoryExecutionResultFixture().execution;
    const provenance = source.provenance!;
    const stages = provenance.stages.map((stage) =>
      stage.stage === 'DEVELOPER'
        ? {
            ...stage,
            readiness: 'PARTIALLY_READY',
            readinessDecision: {
              version: '1.0.0' as const,
              readiness: 'PARTIALLY_READY' as const,
              decisiveFactors: [
                {
                  sourceStage: 'PRODUCT_OWNER' as const,
                  code: 'SOURCE_PARTIALLY_READY' as const,
                },
              ],
            },
          }
        : stage,
    );

    expect(
      factorySourceExecutionSummarySchema.safeParse({
        ...source,
        provenance: { stages },
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
