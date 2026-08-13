import { describe, expect, it } from 'vitest';

import { createWorkflowRequestFixture } from './testing/orchestrator-fixtures';
import {
  workflowProvenanceSchema,
  workflowRequestSchema,
  workflowStageProvenanceSchema,
  workflowTimelineEventSchema,
} from './schemas';

describe('Orchestrator schemas', () => {
  it('aceita um WorkflowRequest estrito com três execuções distintas', () => {
    expect(workflowRequestSchema.safeParse(createWorkflowRequestFixture()).success).toBe(true);
  });

  it('rejeita propriedades desconhecidas e agentExecutionIds repetidos', () => {
    const request = createWorkflowRequestFixture();
    expect(workflowRequestSchema.safeParse({ ...request, retry: 3 }).success).toBe(false);
    expect(
      workflowRequestSchema.safeParse({
        ...request,
        agents: {
          ...request.agents,
          qa: {
            ...request.agents.qa,
            agentExecutionId: request.agents.productOwner.agentExecutionId,
          },
        },
      }).success,
    ).toBe(false);
  });

  it('mantém timestamps da timeline como observações explícitas', () => {
    expect(
      workflowTimelineEventSchema.safeParse({
        sequence: 1,
        event: 'WORKFLOW_STARTED',
        stage: 'INITIALIZATION',
        agent: null,
        timestampMs: 10,
        durationMs: null,
      }).success,
    ).toBe(true);
  });

  it('enforces canonical stage provenance and rejected outcome invariants', () => {
    const hash = 'a'.repeat(64);
    const productOwner = {
      stage: 'PRODUCT_OWNER' as const,
      agent: 'PRODUCT_OWNER' as const,
      executionId: 'execution-001',
      agentExecutionId: 'po-001',
      agentVersion: '1.0.0',
      outcome: 'GENERATED' as const,
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
      assetBundleHash: hash,
      knowledgeContextHash: `sha256:${hash}`,
      promptHash: hash,
      responseHash: hash,
      validationHash: hash,
      generationHash: hash,
      artifactHashes: [],
    };

    expect(workflowStageProvenanceSchema.safeParse(productOwner).success).toBe(true);
    expect(
      workflowStageProvenanceSchema.safeParse({
        ...productOwner,
        outcome: 'VALIDATION_REJECTED',
        readiness: 'READY',
        readinessDecision: null,
      }).success,
    ).toBe(false);
    expect(
      workflowProvenanceSchema.safeParse({ stages: [productOwner, productOwner] }).success,
    ).toBe(false);
  });
});
