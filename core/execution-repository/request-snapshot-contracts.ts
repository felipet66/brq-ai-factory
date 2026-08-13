import type { z } from 'zod';

import type {
  executionRequestSnapshotLookupSchema,
  executionRequestSnapshotSaveInputSchema,
  executionRequestSnapshotSchema,
} from './request-snapshot-schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ExecutionRequestSnapshot = DeepReadonly<z.infer<typeof executionRequestSnapshotSchema>>;
export type ExecutionRequestSnapshotSaveInput = DeepReadonly<
  z.infer<typeof executionRequestSnapshotSaveInputSchema>
>;
export type ExecutionRequestSnapshotLookup = DeepReadonly<
  z.infer<typeof executionRequestSnapshotLookupSchema>
>;

/**
 * Owner-scoped, immutable storage for the original validated ExecutionRequest.
 *
 * Callers must provide the authenticated owner on every lookup. Implementations must return
 * `null`, rather than revealing that another owner has a snapshot for the same execution id.
 */
export interface ExecutionRequestSnapshotRepository {
  save(input: ExecutionRequestSnapshotSaveInput): Promise<ExecutionRequestSnapshot>;
  findOwned(input: ExecutionRequestSnapshotLookup): Promise<ExecutionRequestSnapshot | null>;
}
