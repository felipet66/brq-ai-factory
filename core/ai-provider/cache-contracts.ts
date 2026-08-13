import type { AIResponse } from './contracts';

export type CompletedAIResponse = AIResponse & { readonly finishReason: 'COMPLETED' };
export type AIResponseCacheAgent = 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA' | 'CODE_GENERATOR';

export interface AIResponseCacheKey {
  /** Immutable execution whose stage consumed this exact response. */
  readonly executionId: string;
  readonly agent: AIResponseCacheAgent;
  readonly provider: string;
  readonly requestHash: string;
}

export interface AIResponseCacheEntry extends AIResponseCacheKey {
  readonly responseHash: string;
  readonly response: CompletedAIResponse;
}

export interface AIResponseCacheClaimed extends AIResponseCacheKey {
  readonly status: 'CLAIMED';
  /** Opaque ownership proof. It must never be logged or disclosed outside the cache adapter. */
  readonly claimToken: string;
}

export interface AIResponseCacheInProgress extends AIResponseCacheKey {
  readonly status: 'IN_PROGRESS';
}

export interface AIResponseCacheCompleted {
  readonly status: 'COMPLETED';
  readonly entry: AIResponseCacheEntry;
}

export type AIResponseCacheClaimResult =
  AIResponseCacheClaimed | AIResponseCacheInProgress | AIResponseCacheCompleted;

export interface AIResponseCacheCompleteInput extends AIResponseCacheKey {
  readonly claimToken: string;
  readonly response: CompletedAIResponse;
}

export interface AIResponseCacheFailInput extends AIResponseCacheKey {
  readonly claimToken: string;
}

/**
 * Persistence port for exact, validated AI responses.
 *
 * Implementations must persist only the request hash, never the AIRequest itself.
 */
export interface AIResponseCache {
  /** Reads a completed checkpoint. Strict replay must use this without claiming the source. */
  get(key: AIResponseCacheKey): Promise<AIResponseCacheEntry | null>;
  /** Atomically owns generation for one `(executionId, agent)` or observes its current state. */
  claim(key: AIResponseCacheKey): Promise<AIResponseCacheClaimResult>;
  /** Atomically completes a claim owned by `claimToken`. */
  complete(input: AIResponseCacheCompleteInput): Promise<AIResponseCacheEntry>;
  /** Releases only the incomplete claim owned by `claimToken`. */
  fail(input: AIResponseCacheFailInput): Promise<void>;
}

export interface AIResponseCheckpointInspectionInput {
  readonly executionId: string;
  readonly requiredAgents: readonly AIResponseCacheAgent[];
}

export interface AIResponseCheckpointSummary {
  readonly agent: AIResponseCacheAgent;
  readonly provider: string;
  readonly requestHash: string;
  readonly responseHash: string;
}

export interface AIResponseCheckpointInspection {
  readonly executionId: string;
  readonly complete: boolean;
  readonly missingAgents: readonly AIResponseCacheAgent[];
  readonly checkpoints: readonly AIResponseCheckpointSummary[];
}

/** Read-only preflight port used before a cache-only job is accepted. */
export interface AIResponseCheckpointReader {
  inspectExecution(
    input: AIResponseCheckpointInspectionInput,
  ): Promise<AIResponseCheckpointInspection>;
}
