import { agentRunRequestSchema, type AgentRunRequest } from '@brq/agent-runner';
import type { PromptContextInput } from '@brq/prompt-builder';

import type { CodeGenerationRequest } from './contracts';
import { deepFreeze } from './immutability';
import { CODE_GENERATOR_CONTRACT_LIMITS } from './limits';
import type { CodeGeneratorPromptAssets } from './prompt-assets';

export function createCodeGeneratorAgentRunRequest(
  request: CodeGenerationRequest,
  contexts: readonly PromptContextInput[],
  assets: CodeGeneratorPromptAssets,
): AgentRunRequest {
  const limits = CODE_GENERATOR_CONTRACT_LIMITS.request;
  const result = agentRunRequestSchema.parse({
    context: {
      execution: {
        executionId: request.context.executionId,
        agentExecutionId: request.context.agentExecutionId,
        agent: 'CODE_GENERATOR',
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
      maxBytes: request.limits?.promptMaxBytes ?? limits.promptBytes,
    },
    model: request.model,
    maxOutputTokens: request.limits?.maxOutputTokens ?? limits.maxOutputTokens,
    timeoutMs: request.limits?.timeoutMs ?? limits.timeoutMs,
  });
  return deepFreeze(result as AgentRunRequest);
}
