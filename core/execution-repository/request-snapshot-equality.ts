import { isDeepStrictEqual } from 'node:util';

import type { ExecutionRequestSnapshot } from './request-snapshot-contracts';

/**
 * `createdAt` records when the first immutable snapshot won the write race. Repeating the same
 * semantic write later is idempotent and must return that original record instead of conflicting.
 */
export function executionRequestSnapshotsHaveEqualImmutableContent(
  left: ExecutionRequestSnapshot,
  right: ExecutionRequestSnapshot,
): boolean {
  return isDeepStrictEqual({ ...left, createdAt: null }, { ...right, createdAt: null });
}
