import type { ProductOwnerAgentResult } from '@brq/product-owner-agent';
import { describe, expect, it } from 'vitest';

import { createStageProvenance } from './provenance';
import { workflowProvenanceSchema } from './schemas';

describe('Workflow provenance', () => {
  it('projeta somente identidades e hashes públicos da execução', () => {
    const result = {
      outcome: 'GENERATED',
      readiness: 'READY',
      specification: { openQuestions: [], assumptions: [] },
      context: {
        executionId: 'execution-001',
        agentExecutionId: 'po-001',
        agentVersion: '1.0.0',
      },
      artifacts: [{ metadata: { draftHash: 'a'.repeat(64) } }],
      validation: { response: { metadata: { validationHash: 'b'.repeat(64) } } },
      metadata: {
        assets: { bundleHash: 'c'.repeat(64) },
        knowledge: { contextHash: `sha256:${'d'.repeat(64)}` },
        run: {
          prompt: { metadata: { promptHash: 'e'.repeat(64) } },
          responseHash: 'f'.repeat(64),
        },
        generation: { generationHash: '1'.repeat(64) },
      },
    } as unknown as ProductOwnerAgentResult;
    const provenance = createStageProvenance('PRODUCT_OWNER', result);
    expect(provenance).toMatchObject({
      stage: 'PRODUCT_OWNER',
      executionId: 'execution-001',
      outcome: 'GENERATED',
      artifactHashes: ['a'.repeat(64)],
      readinessDecision: {
        version: '1.0.0',
        readiness: 'READY',
        decisiveFactors: [{ sourceStage: 'PRODUCT_OWNER', code: 'NO_LOCAL_READINESS_CONCERNS' }],
      },
    });
    expect(provenance).not.toHaveProperty('specification');
    expect(provenance).not.toHaveProperty('artifacts.0.draft.content');
  });

  it('records null evidence for rejected responses without inspecting rejected content', () => {
    const result = {
      outcome: 'VALIDATION_REJECTED',
      readiness: null,
      context: {
        executionId: 'execution-001',
        agentExecutionId: 'po-001',
        agentVersion: '1.0.0',
      },
      artifacts: [],
      validation: { response: { metadata: { validationHash: 'b'.repeat(64) } } },
      metadata: {
        assets: { bundleHash: 'c'.repeat(64) },
        knowledge: { contextHash: `sha256:${'d'.repeat(64)}` },
        run: {
          prompt: { metadata: { promptHash: 'e'.repeat(64) } },
          responseHash: 'f'.repeat(64),
        },
        generation: null,
      },
    } as unknown as ProductOwnerAgentResult;

    expect(createStageProvenance('PRODUCT_OWNER', result).readinessDecision).toBeNull();
  });

  it('rejects SOURCE evidence that contradicts the recorded upstream readiness', () => {
    const hash = 'a'.repeat(64);
    const stageBase = {
      executionId: 'execution-001',
      agentVersion: '1.0.0',
      outcome: 'GENERATED' as const,
      assetBundleHash: hash,
      knowledgeContextHash: `sha256:${hash}`,
      promptHash: hash,
      responseHash: hash,
      validationHash: hash,
      generationHash: hash,
      artifactHashes: [],
    };
    const provenance = {
      stages: [
        {
          ...stageBase,
          stage: 'PRODUCT_OWNER' as const,
          agent: 'PRODUCT_OWNER' as const,
          agentExecutionId: 'po-001',
          readiness: 'READY',
          readinessDecision: {
            version: '1.0.0' as const,
            readiness: 'READY' as const,
            decisiveFactors: [
              {
                sourceStage: 'PRODUCT_OWNER' as const,
                code: 'NO_LOCAL_READINESS_CONCERNS' as const,
              },
            ],
          },
        },
        {
          ...stageBase,
          stage: 'DEVELOPER' as const,
          agent: 'DEVELOPER' as const,
          agentExecutionId: 'developer-001',
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
        },
      ],
    };

    expect(workflowProvenanceSchema.safeParse(provenance).success).toBe(false);
  });
});
