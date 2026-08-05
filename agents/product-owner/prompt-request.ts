import { agentRunRequestSchema, type AgentRunRequest } from '@brq/agent-runner';
import type { PromptContextInput } from '@brq/prompt-builder';

import type { ProductOwnerAgentRequest } from './contracts';
import { deepFreeze } from './immutability';
import type { ProductOwnerPromptAssets } from './prompt-assets';

export function createProductOwnerAgentRunRequest(
  request: ProductOwnerAgentRequest,
  contexts: readonly PromptContextInput[],
  assets: ProductOwnerPromptAssets,
): AgentRunRequest {
  const result = agentRunRequestSchema.parse({
    context: {
      execution: {
        executionId: request.context.executionId,
        agentExecutionId: request.context.agentExecutionId,
        agent: 'PRODUCT_OWNER',
        attempt: request.context.attempt,
        agentVersion: request.context.agentVersion,
      },
      ...(request.context.requestId === undefined ? {} : { requestId: request.context.requestId }),
      ...(request.context.traceId === undefined ? {} : { traceId: request.context.traceId }),
    },
    prompt: {
      template: assets.template,
      ruleSets: assets.ruleSets,
      contexts,
      variables: [],
      constraints: [],
      outputContract: assets.outputContract,
      ...(request.limits?.promptMaxBytes === undefined
        ? {}
        : { maxBytes: request.limits.promptMaxBytes }),
    },
    model: request.model,
    ...(request.limits?.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: request.limits.maxOutputTokens }),
    ...(request.limits?.timeoutMs === undefined ? {} : { timeoutMs: request.limits.timeoutMs }),
  });

  return deepFreeze(result as AgentRunRequest);
}
