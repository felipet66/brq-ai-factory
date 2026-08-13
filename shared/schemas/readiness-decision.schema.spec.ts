import { describe, expect, it } from 'vitest';

import {
  readinessDecisionFactorMatchesStage,
  readinessDecisionMatchesStageState,
  readinessDecisionSchema,
  readinessDecisionSourceMatchesStages,
  readinessEvidenceStagesAreCanonical,
} from './readiness-decision.schema';

describe('readinessDecisionSchema', () => {
  it('accepts only allowlisted, unique factors from the decisive tier', () => {
    expect(
      readinessDecisionSchema.parse({
        version: '1.0.0',
        readiness: 'PARTIALLY_READY',
        decisiveFactors: [
          { sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_PARTIALLY_READY' },
          { sourceStage: 'QA', code: 'NON_BLOCKING_QUESTION_PRESENT' },
        ],
      }),
    ).toEqual({
      version: '1.0.0',
      readiness: 'PARTIALLY_READY',
      decisiveFactors: [
        { sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_PARTIALLY_READY' },
        { sourceStage: 'QA', code: 'NON_BLOCKING_QUESTION_PRESENT' },
      ],
    });

    expect(
      readinessDecisionSchema.safeParse({
        version: '1.0.0',
        readiness: 'READY',
        decisiveFactors: [{ sourceStage: 'QA', code: 'BLOCKING_ITEM_PRESENT' }],
      }).success,
    ).toBe(false);
    expect(
      readinessDecisionSchema.safeParse({
        version: '1.0.0',
        readiness: 'READY',
        decisiveFactors: [
          { sourceStage: 'QA', code: 'NO_LOCAL_READINESS_CONCERNS' },
          { sourceStage: 'QA', code: 'NO_LOCAL_READINESS_CONCERNS' },
        ],
      }).success,
    ).toBe(false);
    expect(
      readinessDecisionFactorMatchesStage('PRODUCT_OWNER', {
        sourceStage: 'PRODUCT_OWNER',
        code: 'SOURCE_READY',
      }),
    ).toBe(false);
    expect(
      readinessDecisionFactorMatchesStage('DEVELOPER', {
        sourceStage: 'PRODUCT_OWNER',
        code: 'SOURCE_READY',
      }),
    ).toBe(true);
  });

  it('rejects free-form evidence fields', () => {
    expect(
      readinessDecisionSchema.safeParse({
        version: '1.0.0',
        readiness: 'READY',
        decisiveFactors: [
          {
            sourceStage: 'PRODUCT_OWNER',
            code: 'NO_LOCAL_READINESS_CONCERNS',
            text: 'sensitive content',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects non-canonical factor order and exposes stage-origin validation', () => {
    expect(
      readinessDecisionSchema.safeParse({
        version: '1.0.0',
        readiness: 'READY',
        decisiveFactors: [
          { sourceStage: 'QA', code: 'NO_LOCAL_READINESS_CONCERNS' },
          { sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_READY' },
        ],
      }).success,
    ).toBe(false);
  });

  it('correlates stage state while preserving generated legacy evidence as null', () => {
    expect(
      readinessDecisionMatchesStageState({
        stage: 'PRODUCT_OWNER',
        outcome: 'GENERATED',
        readiness: 'READY',
        readinessDecision: null,
      }),
    ).toBe(true);
    expect(
      readinessDecisionMatchesStageState({
        stage: 'PRODUCT_OWNER',
        outcome: 'GENERATED',
        readiness: 'READY',
        readinessDecision: {
          version: '1.0.0',
          readiness: 'PARTIALLY_READY',
          decisiveFactors: [
            { sourceStage: 'PRODUCT_OWNER', code: 'NON_BLOCKING_QUESTION_PRESENT' },
          ],
        },
      }),
    ).toBe(false);
    expect(
      readinessDecisionMatchesStageState({
        stage: 'PRODUCT_OWNER',
        outcome: 'VALIDATION_REJECTED',
        readiness: 'READY',
        readinessDecision: null,
      }),
    ).toBe(false);
    expect(
      readinessDecisionMatchesStageState({
        stage: 'PRODUCT_OWNER',
        outcome: 'GENERATED',
        readiness: null,
        readinessDecision: null,
      }),
    ).toBe(false);
    expect(
      readinessDecisionMatchesStageState({
        stage: 'PRODUCT_OWNER',
        outcome: 'GENERATED',
        readiness: 'MODEL_INVENTED_VALUE',
        readinessDecision: null,
      }),
    ).toBe(false);
  });

  it('requires provenance stages to be a unique canonical workflow prefix', () => {
    expect(readinessEvidenceStagesAreCanonical([])).toBe(true);
    expect(
      readinessEvidenceStagesAreCanonical([
        { stage: 'PRODUCT_OWNER' },
        { stage: 'DEVELOPER' },
        { stage: 'QA' },
      ]),
    ).toBe(true);
    expect(
      readinessEvidenceStagesAreCanonical([{ stage: 'PRODUCT_OWNER' }, { stage: 'PRODUCT_OWNER' }]),
    ).toBe(false);
    expect(
      readinessEvidenceStagesAreCanonical([{ stage: 'DEVELOPER' }, { stage: 'PRODUCT_OWNER' }]),
    ).toBe(false);
    expect(readinessEvidenceStagesAreCanonical([{ stage: 'QA' }])).toBe(false);
  });

  it('requires SOURCE factors to match the readiness recorded by the real upstream stage', () => {
    const sourceFactor = {
      sourceStage: 'PRODUCT_OWNER' as const,
      code: 'SOURCE_PARTIALLY_READY' as const,
    };

    expect(
      readinessDecisionSourceMatchesStages(sourceFactor, [
        { stage: 'PRODUCT_OWNER', readiness: 'PARTIALLY_READY' },
        { stage: 'DEVELOPER', readiness: 'PARTIALLY_READY' },
      ]),
    ).toBe(true);
    expect(
      readinessDecisionSourceMatchesStages(sourceFactor, [
        { stage: 'PRODUCT_OWNER', readiness: 'READY' },
        { stage: 'DEVELOPER', readiness: 'PARTIALLY_READY' },
      ]),
    ).toBe(false);
    expect(
      readinessDecisionSourceMatchesStages(sourceFactor, [
        { stage: 'DEVELOPER', readiness: 'PARTIALLY_READY' },
      ]),
    ).toBe(false);
  });
});
