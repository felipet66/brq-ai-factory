import { Buffer } from 'node:buffer';

import type { AIRequest } from '@brq/ai-provider';
import { canonicalizeJson } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { RunnerObservedMetrics } from './contracts';

export function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

export function canonicalByteLength(value: JsonValue): number {
  return Buffer.byteLength(canonicalizeJson(value), 'utf8');
}

export function aiRequestByteLength(request: AIRequest): number {
  return canonicalByteLength(request as unknown as JsonValue);
}

export interface ObservedMetricsInput {
  readonly totalDurationMs: number;
  readonly promptBuilderDurationMs: number;
  readonly providerDurationMs: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
}

export function observedMetrics(input: ObservedMetricsInput): RunnerObservedMetrics {
  return {
    totalDurationMs: input.totalDurationMs,
    promptBuilderDurationMs: input.promptBuilderDurationMs,
    providerDurationMs: input.providerDurationMs,
    bytesSent: input.bytesSent,
    bytesReceived: input.bytesReceived,
  };
}
