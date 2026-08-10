export const CONTROLLED_WORKSPACE_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'CONTROLLED_WORKSPACE_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'CONTROLLED_WORKSPACE_INVALID_REQUEST',
  UNSAFE_PATH: 'CONTROLLED_WORKSPACE_UNSAFE_PATH',
  PATH_COLLISION: 'CONTROLLED_WORKSPACE_PATH_COLLISION',
  UNSUPPORTED_CONTENT: 'CONTROLLED_WORKSPACE_UNSUPPORTED_CONTENT',
  LIMIT_EXCEEDED: 'CONTROLLED_WORKSPACE_LIMIT_EXCEEDED',
  INVALID_ROOT: 'CONTROLLED_WORKSPACE_INVALID_ROOT',
  SYMLINK_NOT_ALLOWED: 'CONTROLLED_WORKSPACE_SYMLINK_NOT_ALLOWED',
  WORKSPACE_ALREADY_EXISTS: 'CONTROLLED_WORKSPACE_ALREADY_EXISTS',
  WORKSPACE_NOT_OWNED: 'CONTROLLED_WORKSPACE_NOT_OWNED',
  MATERIALIZATION_FAILED: 'CONTROLLED_WORKSPACE_MATERIALIZATION_FAILED',
  VERIFICATION_FAILED: 'CONTROLLED_WORKSPACE_VERIFICATION_FAILED',
  CANCELLED: 'CONTROLLED_WORKSPACE_CANCELLED',
  CLEANUP_FAILED: 'CONTROLLED_WORKSPACE_CLEANUP_FAILED',
  CLEANUP_TIMEOUT: 'CONTROLLED_WORKSPACE_CLEANUP_TIMEOUT',
} as const);

export type ControlledWorkspaceErrorCode =
  (typeof CONTROLLED_WORKSPACE_ERROR_CODES)[keyof typeof CONTROLLED_WORKSPACE_ERROR_CODES];

export const CONTROLLED_WORKSPACE_ERROR_STAGES = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  REQUEST_VALIDATION: 'REQUEST_VALIDATION',
  PATH_VALIDATION: 'PATH_VALIDATION',
  PLAN_CREATION: 'PLAN_CREATION',
  ROOT_VALIDATION: 'ROOT_VALIDATION',
  STAGING: 'STAGING',
  MATERIALIZATION: 'MATERIALIZATION',
  VERIFICATION: 'VERIFICATION',
  COMMIT: 'COMMIT',
  CLEANUP: 'CLEANUP',
} as const);

export type ControlledWorkspaceErrorStage =
  (typeof CONTROLLED_WORKSPACE_ERROR_STAGES)[keyof typeof CONTROLLED_WORKSPACE_ERROR_STAGES];

export class ControlledWorkspaceError extends Error {
  readonly code: ControlledWorkspaceErrorCode;
  readonly stage: ControlledWorkspaceErrorStage;
  readonly workspaceId: string | undefined;
  readonly sourceCode: string | undefined;

  constructor(
    message: string,
    options: {
      readonly code: ControlledWorkspaceErrorCode;
      readonly stage: ControlledWorkspaceErrorStage;
      readonly workspaceId?: string;
      readonly sourceCode?: string;
    },
  ) {
    super(message);
    this.name = 'ControlledWorkspaceError';
    this.code = options.code;
    this.stage = options.stage;
    this.workspaceId = options.workspaceId;
    this.sourceCode = options.sourceCode;
  }
}
