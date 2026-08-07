export const OBSERVABILITY_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'OBSERVABILITY_INVALID_CONFIGURATION',
  INVALID_SNAPSHOT: 'OBSERVABILITY_INVALID_SNAPSHOT',
});

export type ObservabilityErrorCode =
  (typeof OBSERVABILITY_ERROR_CODES)[keyof typeof OBSERVABILITY_ERROR_CODES];

export class ObservabilityError extends Error {
  readonly code: ObservabilityErrorCode;

  constructor(
    message: string,
    code: ObservabilityErrorCode,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ObservabilityError';
    this.code = code;
  }
}
