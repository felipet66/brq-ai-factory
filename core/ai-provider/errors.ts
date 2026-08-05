export const AI_PROVIDER_ERROR_CODES = {
  INVALID_CONFIGURATION: 'AI_PROVIDER_INVALID_CONFIGURATION',
  INVALID_REQUEST: 'AI_PROVIDER_INVALID_REQUEST',
  AUTHENTICATION_FAILED: 'AI_PROVIDER_AUTHENTICATION_FAILED',
  PERMISSION_DENIED: 'AI_PROVIDER_PERMISSION_DENIED',
  QUOTA_EXCEEDED: 'AI_PROVIDER_QUOTA_EXCEEDED',
  RATE_LIMITED: 'AI_PROVIDER_RATE_LIMITED',
  CONNECTION_FAILED: 'AI_PROVIDER_CONNECTION_FAILED',
  UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  TIMEOUT: 'AI_PROVIDER_TIMEOUT',
  CANCELLED: 'AI_PROVIDER_CANCELLED',
  INVALID_RESPONSE: 'AI_PROVIDER_INVALID_RESPONSE',
  FAILURE: 'AI_PROVIDER_FAILURE',
} as const;

export type AIProviderErrorCode =
  (typeof AI_PROVIDER_ERROR_CODES)[keyof typeof AI_PROVIDER_ERROR_CODES];

export interface AIProviderErrorOptions {
  code: AIProviderErrorCode;
  provider: string;
  retryable?: boolean;
  statusCode?: number | undefined;
  providerRequestId?: string | undefined;
  cause?: unknown;
}

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;
  readonly providerRequestId: string | undefined;

  constructor(message: string, options: AIProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'AIProviderError';
    this.code = options.code;
    this.provider = options.provider;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
    this.providerRequestId = options.providerRequestId;
  }
}

export function invalidAIRequest(provider: string, cause: unknown): AIProviderError {
  return new AIProviderError('Solicitação de IA inválida.', {
    code: AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
    provider,
    cause,
  });
}
