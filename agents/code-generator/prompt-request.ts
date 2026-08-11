import { agentRunRequestSchema, type AgentRunRequest } from '@brq/agent-runner';
import type { PromptContextInput } from '@brq/prompt-builder';

import type { CodeGenerationRequest } from './contracts';
import { deepFreeze } from './immutability';
import { CODE_GENERATOR_CONTRACT_LIMITS } from './limits';
import type { CodeGeneratorPromptAssets } from './prompt-assets';

const GENERIC_GENERATION_CONSTRAINT = Object.freeze({
  id: 'constraint:generic-code-generation',
  serialization: 'TEXT' as const,
  value:
    'Nenhum profile específico do host foi fornecido; preserve as capacidades textuais genéricas e siga somente os contratos públicos do Code Generator.',
});

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
      constraints: request.generationConstraints ?? [GENERIC_GENERATION_CONSTRAINT],
      outputContract: assets.outputContract,
      maxBytes: request.limits?.promptMaxBytes ?? limits.promptBytes,
    },
    model: request.model,
    maxOutputTokens: request.limits?.maxOutputTokens ?? limits.maxOutputTokens,
    timeoutMs: request.limits?.timeoutMs ?? limits.timeoutMs,
  });
  return deepFreeze(result as AgentRunRequest);
}
