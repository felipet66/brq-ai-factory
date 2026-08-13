import { explainDeveloperReadiness, type DeveloperAgentResult } from '@brq/developer-agent';
import {
  explainProductOwnerReadiness,
  type ProductOwnerAgentResult,
} from '@brq/product-owner-agent';
import { explainQAReadiness, type QAAgentResult } from '@brq/qa-agent';
import { readinessDecisionSchema } from '@brq/shared/schemas/readiness-decision.schema';
import type { ReadinessDecision } from '@brq/shared/types/readiness-decision';

import type { WorkflowProvenance } from './contracts';

type SupportedResult = ProductOwnerAgentResult | DeveloperAgentResult | QAAgentResult;
type AgentStage = 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';

const AGENT_BY_STAGE = {
  PRODUCT_OWNER: 'PRODUCT_OWNER',
  DEVELOPER: 'DEVELOPER',
  QA: 'QA',
} as const;

function createReadinessDecision(
  stage: AgentStage,
  result: SupportedResult,
): ReadinessDecision | null {
  if (result.outcome !== 'GENERATED') return null;

  if (stage === 'PRODUCT_OWNER') {
    const generated = result as Extract<ProductOwnerAgentResult, { outcome: 'GENERATED' }>;
    return readinessDecisionSchema.parse(
      explainProductOwnerReadiness(
        generated.specification.openQuestions,
        generated.specification.assumptions,
      ),
    );
  }
  if (stage === 'DEVELOPER') {
    const generated = result as Extract<DeveloperAgentResult, { outcome: 'GENERATED' }>;
    return readinessDecisionSchema.parse(
      explainDeveloperReadiness(
        generated.metadata.sourceReadiness,
        generated.specification.openQuestions,
        generated.specification.assumptions,
      ),
    );
  }

  const generated = result as Extract<QAAgentResult, { outcome: 'GENERATED' }>;
  return readinessDecisionSchema.parse(
    explainQAReadiness(
      generated.metadata.productOwnerReadiness,
      generated.metadata.technicalReadiness,
      generated.specification.openQuestions,
      generated.specification.assumptions,
      generated.specification.blockingItems,
    ),
  );
}

export function createStageProvenance(stage: AgentStage, result: SupportedResult) {
  return {
    stage,
    agent: AGENT_BY_STAGE[stage],
    executionId: result.context.executionId,
    agentExecutionId: result.context.agentExecutionId,
    agentVersion: result.context.agentVersion,
    outcome: result.outcome,
    readiness: result.readiness,
    readinessDecision: createReadinessDecision(stage, result),
    assetBundleHash: result.metadata.assets.bundleHash,
    knowledgeContextHash: result.metadata.knowledge.contextHash,
    promptHash: result.metadata.run.prompt.metadata.promptHash,
    responseHash: result.metadata.run.responseHash,
    validationHash: result.validation.response.metadata.validationHash,
    generationHash: result.metadata.generation?.generationHash ?? null,
    artifactHashes: result.artifacts.map((artifact) => artifact.metadata.draftHash),
  } as const;
}

export function createWorkflowProvenance(stages: WorkflowProvenance['stages']): WorkflowProvenance {
  return { stages };
}
