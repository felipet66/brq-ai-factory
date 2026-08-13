import { createAgentRunner } from '@brq/agent-runner';
import { createArtifactGenerator } from '@brq/artifact-generator';
import {
  createDeveloperAgent,
  loadDeveloperPromptAssets,
  type DeveloperAgentResult,
} from '@brq/developer-agent';
import { createKnowledgeLoader } from '@brq/knowledge-loader';
import {
  createProductOwnerAgent,
  loadProductOwnerPromptAssets,
  type ProductOwnerAgentResult,
} from '@brq/product-owner-agent';
import { createPromptBuilder } from '@brq/prompt-builder';
import { createQAAgent, loadQAPromptAssets, type QAAgentResult } from '@brq/qa-agent';
import { createResponseValidator } from '@brq/response-validator';
import { createLogger } from '@brq/shared/logger/logger';

import {
  createDeveloperAIResponse,
  createTechnicalSpecification,
} from '../../../agents/developer/testing/developer-fixtures';
import {
  createProductOwnerAIResponse,
  createProductOwnerRequest as createAgentProductOwnerRequest,
  createProductOwnerSpecification,
} from '../../../agents/product-owner/testing/product-owner-fixtures';
import { createQAAIResponse, createQASpecification } from '../../../agents/qa/testing/qa-fixtures';
import { FakeAIProvider } from '../../ai-provider/fake/fake-ai-provider';
import { FakeKnowledgeSource } from '../../knowledge-loader/testing/fake-knowledge-source';
import {
  createDeveloperRequest,
  createProductOwnerRequest,
  createQARequest,
} from '../agent-request-factory';
import type { WorkflowRequest } from '../contracts';
import { workflowRequestSchema } from '../schemas';
import { GREENFIELD_DELIVERY_INTENT } from '@brq/shared/constants/delivery-intent';

type GeneratedProductOwnerResult = Extract<ProductOwnerAgentResult, { outcome: 'GENERATED' }>;
type RejectedProductOwnerResult = Extract<
  ProductOwnerAgentResult,
  { outcome: 'VALIDATION_REJECTED' }
>;
type GeneratedDeveloperResult = Extract<DeveloperAgentResult, { outcome: 'GENERATED' }>;
type RejectedDeveloperResult = Extract<DeveloperAgentResult, { outcome: 'VALIDATION_REJECTED' }>;
type GeneratedQAResult = Extract<QAAgentResult, { outcome: 'GENERATED' }>;
type RejectedQAResult = Extract<QAAgentResult, { outcome: 'VALIDATION_REJECTED' }>;

const EMPTY_SELECTION = { required: [], optional: [] } as const;
const MANIFEST = {
  version: '1.0.0',
  documents: [
    { id: 'knowledge:orchestrator-po', locator: 'po.md', category: 'AGENT', order: 1 },
    { id: 'knowledge:orchestrator-dev', locator: 'dev.md', category: 'AGENT', order: 2 },
    { id: 'knowledge:orchestrator-qa', locator: 'qa.md', category: 'AGENT', order: 3 },
  ],
} as const;
const POLICY = {
  version: '1.0.0',
  contexts: {
    GLOBAL: EMPTY_SELECTION,
    PRODUCT_OWNER: { required: ['knowledge:orchestrator-po'], optional: [] },
    DEVELOPER: { required: ['knowledge:orchestrator-dev'], optional: [] },
    QA: { required: ['knowledge:orchestrator-qa'], optional: [] },
    CODE_GENERATOR: EMPTY_SELECTION,
    SECURITY: EMPTY_SELECTION,
    ARCHITECTURE: EMPTY_SELECTION,
  },
} as const;

export function createWorkflowRequestFixture(
  overrides: Partial<WorkflowRequest> = {},
): WorkflowRequest {
  const productOwnerRequest = createAgentProductOwnerRequest();
  return workflowRequestSchema.parse({
    workflowId: 'workflow-001',
    executionId: 'execution-001',
    requestId: 'request-001',
    traceId: 'trace-001',
    deliveryIntent: GREENFIELD_DELIVERY_INTENT,
    demand: productOwnerRequest.demand,
    additionalContext: productOwnerRequest.additionalContext,
    agents: {
      productOwner: {
        agentExecutionId: 'product-owner-execution-001',
        agentVersion: '1.0.0',
        model: productOwnerRequest.model,
        limits: productOwnerRequest.limits,
      },
      developer: {
        agentExecutionId: 'developer-execution-001',
        agentVersion: '1.0.0',
        model: 'gpt-5-mini',
      },
      qa: {
        agentExecutionId: 'qa-execution-001',
        agentVersion: '1.0.0',
        model: 'gpt-5-mini',
      },
    },
    ...overrides,
  });
}

export interface OrchestratorAgentResultFixtures {
  readonly generated: {
    readonly productOwner: GeneratedProductOwnerResult;
    readonly developer: GeneratedDeveloperResult;
    readonly qa: GeneratedQAResult;
  };
  readonly rejected: {
    readonly productOwner: RejectedProductOwnerResult;
    readonly developer: RejectedDeveloperResult;
    readonly qa: RejectedQAResult;
  };
  readonly mismatchedDeveloper: GeneratedDeveloperResult;
}

export async function createOrchestratorAgentResultFixtures(
  request: WorkflowRequest = createWorkflowRequestFixture(),
): Promise<OrchestratorAgentResultFixtures> {
  const logger = createLogger({ sink: () => undefined });
  const source = new FakeKnowledgeSource({
    documents: {
      'po.md': '# PO\n\nConhecimento funcional.',
      'dev.md': '# Developer\n\nConhecimento técnico.',
      'qa.md': '# QA\n\nConhecimento de qualidade.',
    },
  });
  const knowledgeLoader = await createKnowledgeLoader({
    source,
    manifest: MANIFEST,
    policy: POLICY,
    logger,
  });
  const responseValidator = createResponseValidator({ logger });
  const artifactGenerator = createArtifactGenerator({ logger });
  const productOwnerSpecification = createProductOwnerSpecification();
  const technicalSpecification = createTechnicalSpecification();
  const qaSpecification = createQASpecification();

  const productOwnerProvider = new FakeAIProvider([
    { type: 'success', response: createProductOwnerAIResponse(productOwnerSpecification) },
    { type: 'malformed_json' },
  ]);
  const productOwnerAgent = createProductOwnerAgent({
    knowledgeLoader,
    agentRunner: createAgentRunner({
      promptBuilder: createPromptBuilder({ logger }),
      aiProvider: productOwnerProvider,
      logger,
    }),
    responseValidator,
    artifactGenerator,
    promptAssets: loadProductOwnerPromptAssets(),
    logger,
  });
  const productOwnerRequest = createProductOwnerRequest(request);
  const productOwnerGenerated = await productOwnerAgent.execute(productOwnerRequest);
  const productOwnerRejected = await productOwnerAgent.execute(productOwnerRequest);
  if (productOwnerGenerated.outcome !== 'GENERATED') throw new Error('Invalid PO fixture.');

  const developerProvider = new FakeAIProvider([
    { type: 'success', response: createDeveloperAIResponse(technicalSpecification) },
    { type: 'malformed_json' },
    { type: 'success', response: createDeveloperAIResponse(technicalSpecification) },
  ]);
  const developerAgent = createDeveloperAgent({
    knowledgeLoader,
    agentRunner: createAgentRunner({
      promptBuilder: createPromptBuilder({ logger }),
      aiProvider: developerProvider,
      logger,
    }),
    responseValidator,
    artifactGenerator,
    promptAssets: loadDeveloperPromptAssets(),
    logger,
  });
  const developerRequest = createDeveloperRequest(request, productOwnerGenerated.specification);
  const developerGenerated = await developerAgent.execute(developerRequest);
  const developerRejected = await developerAgent.execute(developerRequest);
  const differentProductOwnerSpecification = {
    ...productOwnerGenerated.specification,
    summary: `${productOwnerGenerated.specification.summary} Contexto alternativo.`,
  };
  const mismatchedDeveloper = await developerAgent.execute(
    createDeveloperRequest(request, differentProductOwnerSpecification),
  );
  if (developerGenerated.outcome !== 'GENERATED') throw new Error('Invalid Developer fixture.');

  const qaProvider = new FakeAIProvider([
    { type: 'success', response: createQAAIResponse(qaSpecification) },
    { type: 'malformed_json' },
  ]);
  const qaAgent = createQAAgent({
    knowledgeLoader,
    agentRunner: createAgentRunner({
      promptBuilder: createPromptBuilder({ logger }),
      aiProvider: qaProvider,
      logger,
    }),
    responseValidator,
    artifactGenerator,
    promptAssets: loadQAPromptAssets(),
    logger,
  });
  const qaRequest = createQARequest(
    request,
    productOwnerGenerated.specification,
    developerGenerated.specification,
  );
  const qaGenerated = await qaAgent.execute(qaRequest);
  const qaRejected = await qaAgent.execute(qaRequest);
  if (
    productOwnerRejected.outcome !== 'VALIDATION_REJECTED' ||
    developerRejected.outcome !== 'VALIDATION_REJECTED' ||
    mismatchedDeveloper.outcome !== 'GENERATED' ||
    qaGenerated.outcome !== 'GENERATED' ||
    qaRejected.outcome !== 'VALIDATION_REJECTED'
  ) {
    throw new Error('Invalid Orchestrator result fixtures.');
  }

  return {
    generated: {
      productOwner: productOwnerGenerated,
      developer: developerGenerated,
      qa: qaGenerated,
    },
    rejected: {
      productOwner: productOwnerRejected,
      developer: developerRejected,
      qa: qaRejected,
    },
    mismatchedDeveloper,
  };
}
