import {
  developerAgentRequestSchema,
  type DeveloperAgentRequest,
  type TechnicalSpecification,
} from '@brq/developer-agent';
import {
  productOwnerAgentRequestSchema,
  type ProductOwnerAgentRequest,
  type ProductOwnerSpecification,
} from '@brq/product-owner-agent';
import { qaAgentRequestSchema, type QAAgentRequest } from '@brq/qa-agent';

import type { WorkflowRequest } from './contracts';

function context(
  request: WorkflowRequest,
  agent: WorkflowRequest['agents'][keyof WorkflowRequest['agents']],
) {
  return {
    executionId: request.executionId,
    agentExecutionId: agent.agentExecutionId,
    attempt: 1,
    agentVersion: agent.agentVersion,
    ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
    ...(request.traceId === undefined ? {} : { traceId: request.traceId }),
  };
}

export function createProductOwnerRequest(request: WorkflowRequest): ProductOwnerAgentRequest {
  const agent = request.agents.productOwner;
  return productOwnerAgentRequestSchema.parse({
    context: context(request, agent),
    demand: request.demand,
    ...(request.additionalContext === undefined
      ? {}
      : { additionalContext: request.additionalContext }),
    model: agent.model,
    ...(agent.limits === undefined ? {} : { limits: agent.limits }),
  });
}

export function createDeveloperRequest(
  request: WorkflowRequest,
  productOwnerSpecification: ProductOwnerSpecification,
): DeveloperAgentRequest {
  const agent = request.agents.developer;
  return developerAgentRequestSchema.parse({
    context: context(request, agent),
    productOwnerSpecification,
    model: agent.model,
    ...(agent.limits === undefined ? {} : { limits: agent.limits }),
  });
}

export function createQARequest(
  request: WorkflowRequest,
  productOwnerSpecification: ProductOwnerSpecification,
  technicalSpecification: TechnicalSpecification,
): QAAgentRequest {
  const agent = request.agents.qa;
  return qaAgentRequestSchema.parse({
    context: context(request, agent),
    productOwnerSpecification,
    technicalSpecification,
    model: agent.model,
    ...(agent.limits === undefined ? {} : { limits: agent.limits }),
  });
}
