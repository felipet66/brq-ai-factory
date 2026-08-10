import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type { PreviewLimitReductions, PreviewLimits } from './limits';
import type { PreviewPolicy, PreviewPolicyRegistry } from './policies';
import type {
  approvedPreviewStartRequestSchema,
  previewFailureSchema,
  previewHashesSchema,
  previewInspectRequestSchema,
  previewLineageSchema,
  previewProvenanceSchema,
  previewRuntimeInspectionSchema,
  previewRuntimeObservationSchema,
  previewRuntimeResultSchema,
  previewSessionEventSchema,
  previewSessionSchema,
  previewStartRequestSchema,
  previewStopRequestSchema,
  previewStopResultSchema,
} from './schemas';

export const PREVIEW_RUNTIME_GATEWAY_ACCESS_HEADER = 'x-brq-preview-runtime-token';

export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type PreviewStartRequest = DeepReadonly<z.input<typeof previewStartRequestSchema>>;
export type ApprovedPreviewStartRequest = DeepReadonly<
  z.infer<typeof approvedPreviewStartRequestSchema>
>;
export type PreviewRuntimeObservation = DeepReadonly<
  z.infer<typeof previewRuntimeObservationSchema>
>;
export type PreviewRuntimeResult = DeepReadonly<z.infer<typeof previewRuntimeResultSchema>>;
export type PreviewInspectRequest = DeepReadonly<z.infer<typeof previewInspectRequestSchema>>;
export type PreviewRuntimeInspection = DeepReadonly<z.infer<typeof previewRuntimeInspectionSchema>>;
export type PreviewStopRequest = DeepReadonly<z.infer<typeof previewStopRequestSchema>>;
export type PreviewStopResult = DeepReadonly<z.infer<typeof previewStopResultSchema>>;
export type PreviewFailure = DeepReadonly<z.infer<typeof previewFailureSchema>>;
export type PreviewLineage = DeepReadonly<z.infer<typeof previewLineageSchema>>;
export type PreviewProvenance = DeepReadonly<z.infer<typeof previewProvenanceSchema>>;
export type PreviewHashes = DeepReadonly<z.infer<typeof previewHashesSchema>>;
export type PreviewSession = DeepReadonly<z.infer<typeof previewSessionSchema>>;
export type PreviewSessionEvent = DeepReadonly<z.infer<typeof previewSessionEventSchema>>;

export interface PreviewRunnerOptions {
  readonly signal?: AbortSignal;
}

export interface PreviewRunner {
  start(
    request: ApprovedPreviewStartRequest,
    options?: PreviewRunnerOptions,
  ): Promise<PreviewRuntimeResult>;
  inspect(request: PreviewInspectRequest): Promise<PreviewRuntimeInspection>;
  stop(request: PreviewStopRequest, options?: PreviewRunnerOptions): Promise<PreviewStopResult>;
}

/** Host-only locator consumed by a trusted gateway. It is never persisted or projected to HTTP. */
export interface PreviewRuntimeGatewayTarget {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly expiresAt: string;
  readonly accessToken: string;
}

/** Optional adapter capability kept separate from the public PreviewRunner result. */
export interface PreviewRuntimeGatewayLocator {
  resolveGatewayTarget(request: PreviewInspectRequest): Promise<PreviewRuntimeGatewayTarget | null>;
}

export interface PreviewSessionStoreMutationResult {
  readonly created: boolean;
  readonly session: PreviewSession;
}

export interface PreviewSessionStore {
  createOrGet(
    session: PreviewSession,
    event: PreviewSessionEvent,
  ): Promise<PreviewSessionStoreMutationResult>;
  getByPreviewId(previewId: string): Promise<PreviewSession | null>;
  getByExecutionId(executionId: string): Promise<PreviewSession | null>;
  replace(
    expectedRevision: number,
    session: PreviewSession,
    event: PreviewSessionEvent,
  ): Promise<PreviewSession>;
  listEvents(previewId: string): Promise<readonly PreviewSessionEvent[]>;
}

export interface PreviewSessionCoordinatorStartOptions {
  readonly signal?: AbortSignal;
}

export interface PreviewSessionCoordinator {
  start(
    request: PreviewStartRequest,
    options?: PreviewSessionCoordinatorStartOptions,
  ): Promise<PreviewSession>;
  getByPreviewId(previewId: string): Promise<PreviewSession | null>;
  getByExecutionId(executionId: string): Promise<PreviewSession | null>;
  stop(previewId: string, options?: PreviewRunnerOptions): Promise<PreviewSession>;
  expire(previewId: string): Promise<PreviewSession>;
  reconcile(previewId: string): Promise<PreviewSession>;
}

export interface CreatePreviewSessionCoordinatorOptions {
  readonly runner: PreviewRunner;
  readonly store: PreviewSessionStore;
  readonly policies: PreviewPolicyRegistry;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export type { PreviewLimitReductions, PreviewLimits, PreviewPolicy, PreviewPolicyRegistry };
