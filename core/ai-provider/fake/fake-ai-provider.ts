import type { AIProvider } from '../ai-provider';
import type { AIGenerateOptions, AIRequest, AIResponse } from '../contracts';
import { AIProviderError, AI_PROVIDER_ERROR_CODES, invalidAIRequest } from '../errors';
import { aiRequestSchema, aiResponseSchema } from '../schemas';

export type FakeAIProviderOutcome =
  | { type: 'success'; response?: AIResponse }
  | { type: 'timeout' }
  | { type: 'cancelled' }
  | { type: 'rate_limit' }
  | { type: 'invalid_response' }
  | { type: 'transient_failure' }
  | { type: 'permanent_failure' }
  | { type: 'malformed_json' }
  | { type: 'incompatible_structured_output' };

export interface FakeAIProviderCall {
  request: AIRequest;
  options: AIGenerateOptions;
}

function error(
  code: (typeof AI_PROVIDER_ERROR_CODES)[keyof typeof AI_PROVIDER_ERROR_CODES],
  retryable = false,
): AIProviderError {
  return new AIProviderError('Falha simulada do provider de IA.', {
    code,
    provider: 'fake',
    retryable,
  });
}

function fakeResponse(request: AIRequest, overrides: Partial<AIResponse> = {}): AIResponse {
  return aiResponseSchema.parse({
    provider: 'fake',
    model: request.model,
    content: 'Resposta determinística do FakeAIProvider.',
    structuredData: null,
    finishReason: 'COMPLETED',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
    },
    metadata: {
      responseId: 'fake_response_1',
      durationMs: 0,
      attempts: 1,
    },
    ...overrides,
  });
}

export class FakeAIProvider implements AIProvider {
  readonly provider = 'fake';
  readonly calls: FakeAIProviderCall[] = [];
  private readonly outcomes: FakeAIProviderOutcome[];

  constructor(outcomes: FakeAIProviderOutcome[] = [{ type: 'success' }]) {
    this.outcomes = [...outcomes];
  }

  async generate(request: AIRequest, options: AIGenerateOptions = {}): Promise<AIResponse> {
    const result = aiRequestSchema.safeParse(request);
    if (!result.success) {
      throw invalidAIRequest(this.provider, result.error);
    }

    const validRequest = result.data;
    this.calls.push({ request: validRequest, options });

    if (options.signal?.aborted) {
      throw error(AI_PROVIDER_ERROR_CODES.CANCELLED);
    }

    const outcome = this.outcomes.shift() ?? { type: 'success' };

    switch (outcome.type) {
      case 'success':
        return outcome.response === undefined
          ? fakeResponse(validRequest)
          : aiResponseSchema.parse(outcome.response);
      case 'timeout':
        throw error(AI_PROVIDER_ERROR_CODES.TIMEOUT);
      case 'cancelled':
        throw error(AI_PROVIDER_ERROR_CODES.CANCELLED);
      case 'rate_limit':
        throw error(AI_PROVIDER_ERROR_CODES.RATE_LIMITED);
      case 'invalid_response':
        throw error(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
      case 'transient_failure':
        throw error(AI_PROVIDER_ERROR_CODES.CONNECTION_FAILED, true);
      case 'permanent_failure':
        throw error(AI_PROVIDER_ERROR_CODES.FAILURE);
      case 'malformed_json':
        return fakeResponse(validRequest, {
          content: '{"incomplete":',
          structuredData: null,
        });
      case 'incompatible_structured_output':
        return fakeResponse(validRequest, {
          content: '{"unexpected":true}',
          structuredData: { unexpected: true },
        });
    }
  }
}
