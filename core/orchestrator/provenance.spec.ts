import type { ProductOwnerAgentResult } from '@brq/product-owner-agent';
import { describe, expect, it } from 'vitest';

import { createStageProvenance } from './provenance';

describe('Workflow provenance', () => {
  it('projeta somente identidades e hashes públicos da execução', () => {
    const result = {
      outcome: 'GENERATED',
      readiness: 'READY',
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
    });
    expect(provenance).not.toHaveProperty('specification');
    expect(provenance).not.toHaveProperty('artifacts.0.draft.content');
  });
});
