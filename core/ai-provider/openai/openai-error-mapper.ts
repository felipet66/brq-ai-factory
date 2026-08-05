import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';

import { AIProviderError, AI_PROVIDER_ERROR_CODES } from '../errors';

export interface OpenAIErrorContext {
  callerAborted: boolean;
  timedOut: boolean;
}

function optionalRequestId(error: APIError): string | undefined {
  return error.requestID ?? undefined;
}

function isQuotaError(error: APIError): boolean {
  const code = error.code?.toLowerCase() ?? '';
  return code.includes('quota') || code.includes('billing');
}

function fromHTTPError(error: APIError): AIProviderError {
  const common = {
    provider: 'openai',
    statusCode: error.status,
    providerRequestId: optionalRequestId(error),
    cause: error,
  };

  if (
    error.status === 400 ||
    error.status === 404 ||
    error.status === 409 ||
    error.status === 422
  ) {
    return new AIProviderError('Solicitação rejeitada pelo provider de IA.', {
      ...common,
      code: AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
    });
  }

  if (error.status === 401) {
    return new AIProviderError('Falha de autenticação no provider de IA.', {
      ...common,
      code: AI_PROVIDER_ERROR_CODES.AUTHENTICATION_FAILED,
    });
  }

  if (error.status === 403) {
    return new AIProviderError('Acesso negado pelo provider de IA.', {
      ...common,
      code: AI_PROVIDER_ERROR_CODES.PERMISSION_DENIED,
    });
  }

  if (error.status === 429) {
    return new AIProviderError('Limite do provider de IA atingido.', {
      ...common,
      code: isQuotaError(error)
        ? AI_PROVIDER_ERROR_CODES.QUOTA_EXCEEDED
        : AI_PROVIDER_ERROR_CODES.RATE_LIMITED,
    });
  }

  if (error.status !== undefined && error.status >= 500) {
    return new AIProviderError('Provider de IA temporariamente indisponível.', {
      ...common,
      code: AI_PROVIDER_ERROR_CODES.UNAVAILABLE,
    });
  }

  return new AIProviderError('Falha no provider de IA.', {
    ...common,
    code: AI_PROVIDER_ERROR_CODES.FAILURE,
  });
}

export function mapOpenAIError(error: unknown, context: OpenAIErrorContext): AIProviderError {
  if (error instanceof AIProviderError) {
    return error;
  }

  if (context.callerAborted) {
    return new AIProviderError('Chamada ao provider de IA cancelada.', {
      code: AI_PROVIDER_ERROR_CODES.CANCELLED,
      provider: 'openai',
      cause: error,
    });
  }

  if (context.timedOut || error instanceof APIConnectionTimeoutError) {
    return new AIProviderError('Tempo limite do provider de IA excedido.', {
      code: AI_PROVIDER_ERROR_CODES.TIMEOUT,
      provider: 'openai',
      cause: error,
    });
  }

  if (error instanceof APIUserAbortError) {
    return new AIProviderError('Chamada ao provider de IA cancelada.', {
      code: AI_PROVIDER_ERROR_CODES.CANCELLED,
      provider: 'openai',
      cause: error,
    });
  }

  if (error instanceof APIConnectionError) {
    return new AIProviderError('Falha de conexão com o provider de IA.', {
      code: AI_PROVIDER_ERROR_CODES.CONNECTION_FAILED,
      provider: 'openai',
      retryable: true,
      cause: error,
    });
  }

  if (error instanceof APIError) {
    return fromHTTPError(error);
  }

  return new AIProviderError('Falha inesperada no provider de IA.', {
    code: AI_PROVIDER_ERROR_CODES.FAILURE,
    provider: 'openai',
    cause: error,
  });
}
