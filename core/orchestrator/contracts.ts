import type { DeveloperAgent, DeveloperAgentResult } from '@brq/developer-agent';
import type { ProductOwnerAgent, ProductOwnerAgentResult } from '@brq/product-owner-agent';
import type { QAAgent, QAAgentResult } from '@brq/qa-agent';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  workflowFailureSchema,
  workflowHashesSchema,
  workflowLineageSchema,
  workflowMetricsSchema,
  workflowProvenanceSchema,
  workflowRequestSchema,
  workflowResultSchema,
  workflowStageSchema,
  workflowStatusSchema,
  workflowTimelineEventSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type WorkflowStage = DeepReadonly<z.infer<typeof workflowStageSchema>>;
export type WorkflowStatus = DeepReadonly<z.infer<typeof workflowStatusSchema>>;
export type WorkflowRequest = DeepReadonly<z.infer<typeof workflowRequestSchema>>;
export type WorkflowTimelineEvent = DeepReadonly<z.infer<typeof workflowTimelineEventSchema>>;
export type WorkflowLineage = DeepReadonly<z.infer<typeof workflowLineageSchema>>;
export type WorkflowProvenance = DeepReadonly<z.infer<typeof workflowProvenanceSchema>>;
export type WorkflowMetrics = DeepReadonly<z.infer<typeof workflowMetricsSchema>>;
export type WorkflowHashes = DeepReadonly<z.infer<typeof workflowHashesSchema>>;
export type WorkflowFailure = DeepReadonly<z.infer<typeof workflowFailureSchema>>;
export type WorkflowResult = DeepReadonly<z.infer<typeof workflowResultSchema>>;

export interface OrchestratorExecutionOptions {
  readonly signal?: AbortSignal;
}

export interface CreateOrchestratorOptions {
  readonly productOwnerAgent: ProductOwnerAgent;
  readonly developerAgent: DeveloperAgent;
  readonly qaAgent: QAAgent;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface Orchestrator {
  execute(
    request: WorkflowRequest,
    options?: OrchestratorExecutionOptions,
  ): Promise<WorkflowResult>;
}

export interface WorkflowAgentResults {
  readonly productOwner: ProductOwnerAgentResult | null;
  readonly developer: DeveloperAgentResult | null;
  readonly qa: QAAgentResult | null;
}
