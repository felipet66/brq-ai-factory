import type { AIProvider } from '@brq/ai-provider';
import type { PromptBuilder } from '@brq/prompt-builder';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  agentRunContextSchema,
  agentRunMetricsSchema,
  agentRunOutputSchema,
  agentRunRequestSchema,
  agentRunResultSchema,
  executionMetadataSchema,
  promptMetadataSchema,
  promptRequestSchema,
  providerMetadataSchema,
  providerReportedMetricsSchema,
  runnerObservedMetricsSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ExecutionMetadata = DeepReadonly<z.infer<typeof executionMetadataSchema>>;
export type AgentRunContext = DeepReadonly<z.infer<typeof agentRunContextSchema>>;
export type PromptRequest = DeepReadonly<z.infer<typeof promptRequestSchema>>;
export type AgentRunRequest = DeepReadonly<z.infer<typeof agentRunRequestSchema>>;
export type PromptMetadata = DeepReadonly<z.infer<typeof promptMetadataSchema>>;
export type RunnerObservedMetrics = DeepReadonly<z.infer<typeof runnerObservedMetricsSchema>>;
export type ProviderReportedMetrics = DeepReadonly<z.infer<typeof providerReportedMetricsSchema>>;
export type AgentRunMetrics = DeepReadonly<z.infer<typeof agentRunMetricsSchema>>;
export type ProviderMetadata = DeepReadonly<z.infer<typeof providerMetadataSchema>>;
export type AgentRunOutput = DeepReadonly<z.infer<typeof agentRunOutputSchema>>;
export type AgentRunResult = DeepReadonly<z.infer<typeof agentRunResultSchema>>;

export interface AgentRunOptions {
  readonly signal?: AbortSignal;
}

export interface CreateAgentRunnerOptions {
  readonly promptBuilder: PromptBuilder;
  readonly aiProvider: AIProvider;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface AgentRunner {
  run(request: AgentRunRequest, options?: AgentRunOptions): Promise<AgentRunResult>;
}
