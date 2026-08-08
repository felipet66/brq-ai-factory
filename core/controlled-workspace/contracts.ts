import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type { ControlledWorkspaceLimitsInput } from './configuration';
import type {
  materializedWorkspaceFileSchema,
  workspaceFileEncodingSchema,
  workspaceFileMediaTypeSchema,
  workspaceFilePurposeSchema,
  workspaceFileRequestSchema,
  workspaceMaterializationResultSchema,
  workspacePlanFileSchema,
  workspacePlanRequestSchema,
  workspacePlanSchema,
  workspaceSourceHashesSchema,
} from './schemas';

export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type WorkspaceSourceHashes = DeepReadonly<z.infer<typeof workspaceSourceHashesSchema>>;
export type WorkspaceFileEncoding = z.infer<typeof workspaceFileEncodingSchema>;
export type WorkspaceFileMediaType = z.infer<typeof workspaceFileMediaTypeSchema>;
export type WorkspaceFilePurpose = z.infer<typeof workspaceFilePurposeSchema>;
export type WorkspaceFileRequest = DeepReadonly<z.infer<typeof workspaceFileRequestSchema>>;
export type WorkspacePlanRequest = DeepReadonly<z.infer<typeof workspacePlanRequestSchema>>;
export type WorkspacePlanFile = DeepReadonly<z.infer<typeof workspacePlanFileSchema>>;
export type WorkspacePlan = DeepReadonly<z.infer<typeof workspacePlanSchema>>;
export type MaterializedWorkspaceFile = DeepReadonly<
  z.infer<typeof materializedWorkspaceFileSchema>
>;
export type WorkspaceMaterializationResult = DeepReadonly<
  z.infer<typeof workspaceMaterializationResultSchema>
>;

export interface ControlledWorkspacePlanner {
  plan(request: WorkspacePlanRequest): WorkspacePlan;
}

export interface ControlledWorkspace extends ControlledWorkspacePlanner {
  materialize(plan: WorkspacePlan): Promise<WorkspaceMaterializationResult>;
}

export interface CreateControlledWorkspacePlannerOptions {
  readonly limits?: ControlledWorkspaceLimitsInput;
}

export interface CreateFilesystemControlledWorkspaceOptions extends CreateControlledWorkspacePlannerOptions {
  readonly rootPath: string;
  readonly logger?: Logger;
  readonly now?: () => number;
}
