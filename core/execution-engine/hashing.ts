import { createHash } from 'node:crypto';

import { canonicalizeJson, normalizeJson } from './canonical-json';

export function calculateHash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function calculateCanonicalJsonHash(value: unknown): string {
  return calculateHash(canonicalizeJson(normalizeJson(value)));
}

export function createDeterministicExecutionId(
  requestHash: string,
  contractVersion: string,
): string {
  const digest = calculateCanonicalJsonHash({ contractVersion, requestHash });
  return `execution-${digest.slice(0, 32)}`;
}
