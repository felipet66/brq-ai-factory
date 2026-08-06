import type { DeveloperAgentResult } from '@brq/developer-agent';
import type { ProductOwnerAgentResult } from '@brq/product-owner-agent';
import type { QAAgentResult } from '@brq/qa-agent';

import type { WorkflowProvenance } from './contracts';

type SupportedResult = ProductOwnerAgentResult | DeveloperAgentResult | QAAgentResult;
type AgentStage = 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';

const AGENT_BY_STAGE = {
  PRODUCT_OWNER: 'PRODUCT_OWNER',
  DEVELOPER: 'DEVELOPER',
  QA: 'QA',
} as const;

export function createStageProvenance(stage: AgentStage, result: SupportedResult) {
  return {
    stage,
    agent: AGENT_BY_STAGE[stage],
    executionId: result.context.executionId,
    agentExecutionId: result.context.agentExecutionId,
    agentVersion: result.context.agentVersion,
    outcome: result.outcome,
    readiness: result.readiness,
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
