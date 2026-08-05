import type { Logger } from '@brq/shared/logger/logger';
import { createLogger } from '@brq/shared/logger/logger';
import { jsonValueSchema } from '@brq/shared/schemas/json-value.schema';
import OpenAI from 'openai';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';

import type { AIProvider } from '../ai-provider';
import type { AIGenerateOptions, AIRequest, AIResponse } from '../contracts';
import type { OpenAIConfig } from '../config';
import { parseOpenAIConfig } from '../config';
import { AIProviderError, AI_PROVIDER_ERROR_CODES, invalidAIRequest } from '../errors';
import { executeWithRetry } from '../retry-policy';
import { aiGenerateMetadataSchema, aiRequestSchema, aiResponseSchema } from '../schemas';
import { mapOpenAIError } from './openai-error-mapper';

type OpenAIClient = Pick<OpenAI, 'responses'>;

export interface OpenAIProviderDependencies {
  client?: OpenAIClient;
  logger?: Logger;
  now?: () => number;
  random?: () => number;
  sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
}

interface CallDeadline {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
}

function createCallDeadline(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): CallDeadline {
  const timeoutController = new AbortController();
  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    timeoutController.abort(new DOMException('AI provider timeout.', 'TimeoutError'));
  }, timeoutMs);

  return {
    signal: callerSignal
      ? AbortSignal.any([callerSignal, timeoutController.signal])
      : timeoutController.signal,
    timedOut: () => didTimeOut,
    dispose: () => clearTimeout(timer),
  };
}

function buildOpenAIRequest(request: AIRequest): ResponseCreateParamsNonStreaming {
  return {
    model: request.model,
    instructions: request.instructions,
    input: request.input,
    background: false,
    store: false,
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: request.maxOutputTokens }),
    ...(request.responseFormat.type === 'text'
      ? {}
      : {
          text: {
            format: {
              type: 'json_schema' as const,
              name: request.responseFormat.name,
              ...(request.responseFormat.description === undefined
                ? {}
                : { description: request.responseFormat.description }),
              schema: request.responseFormat.schema,
              strict: true,
            },
          },
        }),
  };
}

function invalidResponse(cause?: unknown): AIProviderError {
  return new AIProviderError('Resposta técnica inválida do provider de IA.', {
    code: AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
    provider: 'openai',
    cause,
  });
}

function collectResponseContent(response: Response): {
  text: string;
  refusal: string | null;
} {
  const textParts: string[] = [];
  let refusal: string | null = null;

  for (const output of response.output) {
    if (output.type !== 'message') {
      continue;
    }

    for (const content of output.content) {
      if (content.type === 'refusal') {
        refusal ??= content.refusal;
      } else if (content.type === 'output_text') {
        textParts.push(content.text);
      }
    }
  }

  return {
    text: textParts.join(''),
    refusal,
  };
}

function parseStructuredData(request: AIRequest, content: string): AIResponse['structuredData'] {
  if (request.responseFormat.type !== 'json_schema' || content.length === 0) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(content);
    const result = jsonValueSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function normalizeOpenAIResponse(
  request: AIRequest,
  response: Response,
  durationMs: number,
  attempts: number,
): AIResponse {
  if (response.error !== null) {
    throw new AIProviderError('O provider de IA não conseguiu gerar uma resposta.', {
      code: AI_PROVIDER_ERROR_CODES.FAILURE,
      provider: 'openai',
    });
  }

  if (response.usage === undefined || response.status === undefined) {
    throw invalidResponse();
  }

  if (!['completed', 'incomplete'].includes(response.status)) {
    throw invalidResponse();
  }

  const content = collectResponseContent(response);
  const finishReason =
    content.refusal !== null
      ? 'REFUSAL'
      : response.status === 'completed'
        ? 'COMPLETED'
        : response.incomplete_details?.reason === 'max_output_tokens'
          ? 'MAX_OUTPUT_TOKENS'
          : response.incomplete_details?.reason === 'content_filter'
            ? 'CONTENT_FILTER'
            : null;

  if (finishReason === null) {
    throw invalidResponse();
  }

  const normalizedContent = content.refusal ?? content.text;
  if (finishReason === 'COMPLETED' && normalizedContent.length === 0) {
    throw invalidResponse();
  }

  const result = aiResponseSchema.safeParse({
    provider: 'openai',
    model: response.model,
    content: normalizedContent,
    structuredData:
      finishReason === 'COMPLETED' ? parseStructuredData(request, normalizedContent) : null,
    finishReason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    metadata: {
      responseId: response.id,
      durationMs,
      attempts,
    },
  });

  if (!result.success) {
    throw invalidResponse(result.error);
  }

  return result.data;
}

function optionalCorrelation(options: {
  requestId?: string | undefined;
  traceId?: string | undefined;
}): Record<string, string> {
  return {
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
  };
}

export class OpenAIProvider implements AIProvider {
  readonly provider = 'openai';
  private readonly client: OpenAIClient;
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor(
    private readonly config: OpenAIConfig,
    private readonly dependencies: OpenAIProviderDependencies = {},
  ) {
    this.client =
      dependencies.client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: 'https://api.openai.com/v1',
        logLevel: 'off',
        timeout: config.timeoutMs,
        maxRetries: 0,
      });
    this.logger = dependencies.logger ?? createLogger();
    this.now = dependencies.now ?? Date.now;
  }

  static fromEnvironment(
    source: NodeJS.ProcessEnv = process.env,
    dependencies: OpenAIProviderDependencies = {},
  ): OpenAIProvider {
    return new OpenAIProvider(parseOpenAIConfig(source), dependencies);
  }

  async generate(request: AIRequest, options: AIGenerateOptions = {}): Promise<AIResponse> {
    const requestResult = aiRequestSchema.safeParse(request);
    if (!requestResult.success) {
      throw invalidAIRequest(this.provider, requestResult.error);
    }

    const optionResult = aiGenerateMetadataSchema.safeParse({
      timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
    });
    if (!optionResult.success) {
      throw invalidAIRequest(this.provider, optionResult.error);
    }

    const validRequest = requestResult.data;
    const validOptions = optionResult.data;
    const correlation = optionalCorrelation(validOptions);
    const deadline = createCallDeadline(options.signal, validOptions.timeoutMs);
    const startedAt = this.now();
    let attempts = 0;

    this.logger.info('ai.request.started', {
      provider: this.provider,
      model: validRequest.model,
      ...correlation,
    });

    try {
      const rawResponse = await executeWithRetry<Response>({
        maxRetries: this.config.maxRetries,
        signal: deadline.signal,
        ...(this.dependencies.random === undefined ? {} : { random: this.dependencies.random }),
        ...(this.dependencies.sleep === undefined ? {} : { sleep: this.dependencies.sleep }),
        shouldRetry: (error) => error instanceof AIProviderError && error.retryable,
        operation: async (attempt) => {
          attempts = attempt;
          try {
            return await this.client.responses.create(buildOpenAIRequest(validRequest), {
              signal: deadline.signal,
              timeout: validOptions.timeoutMs,
              maxRetries: 0,
            });
          } catch (error) {
            throw mapOpenAIError(error, {
              callerAborted: options.signal?.aborted ?? false,
              timedOut: deadline.timedOut(),
            });
          }
        },
        onRetry: ({ failedAttempt, nextAttempt, delayMs }) => {
          this.logger.warn('ai.request.retrying', {
            provider: this.provider,
            model: validRequest.model,
            failedAttempt,
            nextAttempt,
            delayMs,
            ...correlation,
          });
        },
      });

      const response = normalizeOpenAIResponse(
        validRequest,
        rawResponse.value,
        Math.max(0, Math.round(this.now() - startedAt)),
        rawResponse.attempts,
      );

      this.logger.info('ai.request.completed', {
        provider: this.provider,
        model: response.model,
        responseId: response.metadata.responseId,
        finishReason: response.finishReason,
        durationMs: response.metadata.durationMs,
        attempts: response.metadata.attempts,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        ...correlation,
      });

      return response;
    } catch (error) {
      const providerError = mapOpenAIError(error, {
        callerAborted: options.signal?.aborted ?? false,
        timedOut: deadline.timedOut(),
      });

      this.logger.error('ai.request.failed', {
        provider: this.provider,
        model: validRequest.model,
        errorCode: providerError.code,
        statusCode: providerError.statusCode,
        providerRequestId: providerError.providerRequestId,
        retryable: providerError.retryable,
        attempts,
        durationMs: Math.max(0, Math.round(this.now() - startedAt)),
        ...correlation,
      });

      throw providerError;
    } finally {
      deadline.dispose();
    }
  }
}
