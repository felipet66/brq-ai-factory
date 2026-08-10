import type {
  ExecutionPreviewControl,
  PreviewSessionView,
  PreviewStartInput,
} from '@/api/preview-contracts';
import type { AuthenticatedPrincipal } from '@/server/auth/contracts';

export interface PreviewApplicationService {
  getExecutionControl(
    executionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ExecutionPreviewControl>;
  start(
    executionId: string,
    principal: AuthenticatedPrincipal,
    input: PreviewStartInput,
    context: { readonly requestId: string; readonly signal: AbortSignal },
  ): Promise<PreviewSessionView>;
  get(previewId: string, principal: AuthenticatedPrincipal): Promise<PreviewSessionView | null>;
  stop(
    previewId: string,
    principal: AuthenticatedPrincipal,
    context: { readonly requestId: string },
  ): Promise<PreviewSessionView | null>;
  createLaunch(
    previewId: string,
    principal: AuthenticatedPrincipal,
    context: { readonly requestId: string },
  ): Promise<PreviewLaunchGrant | null>;
}

export interface PreviewLaunchGrant {
  readonly previewId: string;
  readonly redeemUrl: string;
  readonly ticket: string;
  readonly expiresAt: string;
}

export type PreviewApplicationErrorCode =
  | 'PREVIEW_NOT_ALLOWED'
  | 'PREVIEW_FACTORY_NOT_SUCCESS'
  | 'PREVIEW_ARTIFACT_UNAVAILABLE'
  | 'PREVIEW_PROFILE_UNSUPPORTED'
  | 'PREVIEW_POLICY_MISMATCH'
  | 'PREVIEW_CONFIGURATION_INVALID'
  | 'PREVIEW_CAPACITY_EXCEEDED'
  | 'PREVIEW_RUNTIME_UNAVAILABLE'
  | 'PREVIEW_IMAGE_VERIFICATION_FAILED'
  | 'PREVIEW_START_FAILED'
  | 'PREVIEW_START_TIMEOUT'
  | 'PREVIEW_HEALTHCHECK_FAILED'
  | 'PREVIEW_RUNTIME_LOST'
  | 'PREVIEW_STOP_FAILED'
  | 'PREVIEW_CLEANUP_FAILED'
  | 'PREVIEW_CONFLICT';

export class PreviewApplicationError extends Error {
  readonly code: PreviewApplicationErrorCode;

  constructor(message: string, code: PreviewApplicationErrorCode, cause?: unknown) {
    super(message, { cause });
    this.name = 'PreviewApplicationError';
    this.code = code;
  }
}
