import { createHash } from 'node:crypto';

import type { AIRequest, AIResponse } from './contracts';
import { aiRequestSchema, aiResponseSchema } from './schemas';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function domainHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`${domain}\u0000${JSON.stringify(canonicalize(value))}`, 'utf8')
    .digest('hex');
}

export function calculateAIRequestHash(request: AIRequest): string {
  return domainHash('brq-ai-provider:request:v1', aiRequestSchema.parse(request));
}

export function calculateAIResponseHash(response: AIResponse): string {
  return domainHash('brq-ai-provider:response:v1', aiResponseSchema.parse(response));
}
