import { createHash } from 'node:crypto';

import type { JsonValue } from '@brq/shared/types/json-value';

import { canonicalizeJson } from './canonical-json';

export function calculatePromptHash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function calculateCanonicalJsonHash(value: JsonValue): string {
  return calculatePromptHash(canonicalizeJson(value));
}
