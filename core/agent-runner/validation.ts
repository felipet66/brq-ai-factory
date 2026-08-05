import { aiResponseSchema, type AIResponse } from '@brq/ai-provider';
import { promptResultSchema, type PromptResult } from '@brq/prompt-builder';

import type { AgentRunOptions, AgentRunRequest, AgentRunResult } from './contracts';
import { agentRunRequestSchema, agentRunResultSchema, agentRunContextSchema } from './schemas';

export function parseAgentRunRequest(input: unknown): AgentRunRequest {
  return agentRunRequestSchema.parse(input) as AgentRunRequest;
}

export function parseAgentRunOptions(input: unknown): AgentRunOptions {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('Opções do Agent Runner inválidas.');
  }

  const entries = Object.entries(input);
  if (entries.some(([key]) => key !== 'signal')) {
    throw new TypeError('Opções do Agent Runner inválidas.');
  }

  if (!('signal' in input) || input.signal === undefined) {
    return Object.freeze({});
  }

  const signal = input.signal;
  if (
    typeof signal !== 'object' ||
    signal === null ||
    !('aborted' in signal) ||
    typeof signal.aborted !== 'boolean' ||
    !('addEventListener' in signal) ||
    typeof signal.addEventListener !== 'function' ||
    !('removeEventListener' in signal) ||
    typeof signal.removeEventListener !== 'function'
  ) {
    throw new TypeError('AbortSignal inválido.');
  }

  return Object.freeze({ signal: signal as AbortSignal });
}

export function parseSafeContext(input: unknown): AgentRunRequest['context'] | undefined {
  if (typeof input !== 'object' || input === null || !('context' in input)) {
    return undefined;
  }

  const result = agentRunContextSchema.safeParse(input.context);
  return result.success ? (result.data as AgentRunRequest['context']) : undefined;
}

export function parsePromptResult(input: unknown): PromptResult {
  return promptResultSchema.parse(input) as PromptResult;
}

export function parseProviderResponse(input: unknown, expectedProvider: string): AIResponse {
  const response = aiResponseSchema.parse(input);

  if (response.provider !== expectedProvider) {
    throw new TypeError('O provider da resposta não corresponde ao provider injetado.');
  }

  return response;
}

export function parseAgentRunResult(input: unknown): AgentRunResult {
  return agentRunResultSchema.parse(input) as AgentRunResult;
}
