import { createHash } from 'node:crypto';

import type { JsonValue } from '@brq/shared/types/json-value';

import { canonicalizeJson, normalizeJson } from './canonical-json';

export function calculateHash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function calculateCanonicalJsonHash(value: unknown): string {
  return calculateHash(canonicalizeJson(normalizeJson(value) as JsonValue));
}

export function calculateKnowledgeHash(value: unknown): string {
  return `sha256:${calculateCanonicalJsonHash(value)}`;
}
