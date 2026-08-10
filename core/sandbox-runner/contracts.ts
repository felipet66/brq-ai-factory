import type { WorkspaceMaterializationResult } from '@brq/controlled-workspace';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type { SandboxLimitReductions } from './configuration';
import type { SandboxExecutionPolicy, SandboxPolicyRegistry } from './policies';
import type {
  sandboxContextSchema,
  sandboxFailureSchema,
  sandboxHashesSchema,
  sandboxLineageSchema,
  sandboxOutputSummarySchema,
  sandboxProvenanceSchema,
  sandboxResourceOutcomeSchema,
  sandboxRuntimeObservationSchema,
  sandboxRunRequestSchema,
  sandboxRunResultSchema,
  sandboxStatusSchema,
  sandboxStepResultSchema,
  sandboxStepStatusSchema,
  sandboxWorkspaceProjectionSchema,
} from './schemas';

export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type SandboxContext = DeepReadonly<z.infer<typeof sandboxContextSchema>>;
export type SandboxStatus = z.infer<typeof sandboxStatusSchema>;
export type SandboxStepStatus = z.infer<typeof sandboxStepStatusSchema>;
export type SandboxResourceOutcome = z.infer<typeof sandboxResourceOutcomeSchema>;
export type SandboxFailure = DeepReadonly<z.infer<typeof sandboxFailureSchema>>;
export type SandboxOutputSummary = DeepReadonly<z.infer<typeof sandboxOutputSummarySchema>>;
export type SandboxStepResult = DeepReadonly<z.infer<typeof sandboxStepResultSchema>>;
export type SandboxRuntimeObservation = DeepReadonly<
  z.infer<typeof sandboxRuntimeObservationSchema>
>;
export type SandboxWorkspaceProjection = DeepReadonly<
  z.infer<typeof sandboxWorkspaceProjectionSchema>
>;
export type SandboxHashes = DeepReadonly<z.infer<typeof sandboxHashesSchema>>;
export type SandboxLineage = DeepReadonly<z.infer<typeof sandboxLineageSchema>>;
export type SandboxProvenance = DeepReadonly<z.infer<typeof sandboxProvenanceSchema>>;
export type SandboxRunRequest = DeepReadonly<z.input<typeof sandboxRunRequestSchema>>;
export type SandboxRunResult = DeepReadonly<z.infer<typeof sandboxRunResultSchema>>;

export type { SandboxLimitReductions, SandboxExecutionPolicy, SandboxPolicyRegistry };
export type { WorkspaceMaterializationResult };

export interface SandboxRunOptions {
  readonly signal?: AbortSignal;
}

export interface SandboxRunner {
  run(request: SandboxRunRequest, options?: SandboxRunOptions): Promise<SandboxRunResult>;
}

export interface SandboxRunnerHostOptions {
  readonly policies: SandboxPolicyRegistry;
  readonly logger?: Logger;
  readonly now?: () => number;
}
