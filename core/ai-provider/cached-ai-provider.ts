import { isDeepStrictEqual } from 'node:util';

import type { Logger } from '@brq/shared/logger/logger';
import { createLogger } from '@brq/shared/logger/logger';

import type { AIProvider } from './ai-provider';
import type {
  AIResponseCache,
  AIResponseCacheClaimResult,
  AIResponseCacheEntry,
  AIResponseCacheKey,
  CompletedAIResponse,
} from './cache-contracts';
import type { AIGenerateOptions, AIRequest, AIResponse } from './contracts';
import { AIProviderError, AI_PROVIDER_ERROR_CODES, invalidAIRequest } from './errors';
import { calculateAIRequestHash, calculateAIResponseHash } from './hashing';
import { aiGenerateMetadataSchema, aiRequestSchema, aiResponseSchema } from './schemas';

export interface CreateCachedAIProviderOptions {
  readonly provider: AIProvider;
  readonly cache: AIResponseCache;
  readonly logger?: Logger;
}

function correlation(options: AIGenerateOptions): Record<string, string> {
  return {
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
  };
}

function validCachedEntry(
  entry: AIResponseCacheEntry,
  key: AIResponseCacheKey,
  expectedResponse?: CompletedAIResponse,
): AIResponseCacheEntry | null {
  const parsed = aiResponseSchema.safeParse(entry.response);
  const parsedResponseHash = parsed.success ? calculateAIResponseHash(parsed.data) : null;
  if (
    entry.executionId !== key.executionId ||
    entry.agent !== key.agent ||
    entry.provider !== key.provider ||
    entry.requestHash !== key.requestHash ||
    !parsed.success ||
    parsed.data.provider !== key.provider ||
    parsed.data.finishReason !== 'COMPLETED' ||
    entry.responseHash !== parsedResponseHash ||
    (expectedResponse !== undefined &&
      (entry.responseHash !== calculateAIResponseHash(expectedResponse) ||
        !isDeepStrictEqual(parsed.data, expectedResponse)))
  ) {
    return null;
  }

  return Object.freeze({
    ...key,
    responseHash: entry.responseHash,
    response: structuredClone(parsed.data) as CompletedAIResponse,
  });
}

type ValidClaimResult =
  | { readonly status: 'CLAIMED'; readonly claimToken: string }
  | { readonly status: 'IN_PROGRESS' }
  | { readonly status: 'COMPLETED'; readonly entry: AIResponseCacheEntry };

function matchesKey(value: AIResponseCacheKey, key: AIResponseCacheKey): boolean {
  return (
    value.executionId === key.executionId &&
    value.agent === key.agent &&
    value.provider === key.provider &&
    value.requestHash === key.requestHash
  );
}

function validClaimResult(
  value: AIResponseCacheClaimResult,
  key: AIResponseCacheKey,
  expectedResponse?: CompletedAIResponse,
): ValidClaimResult | null {
  if (value === null || typeof value !== 'object' || !('status' in value)) return null;
  if (value.status === 'CLAIMED') {
    return matchesKey(value, key) &&
      typeof value.claimToken === 'string' &&
      value.claimToken.trim() === value.claimToken &&
      value.claimToken.length > 0 &&
      value.claimToken.length <= 256
      ? { status: 'CLAIMED', claimToken: value.claimToken }
      : null;
  }
  if (value.status === 'IN_PROGRESS') {
    return matchesKey(value, key) ? { status: 'IN_PROGRESS' } : null;
  }
  if (value.status === 'COMPLETED') {
    const entry = validCachedEntry(value.entry, key, expectedResponse);
    return entry === null ? null : { status: 'COMPLETED', entry };
  }
  return null;
}

function cacheCoordinates(options: AIGenerateOptions): {
  readonly executionId: string;
  readonly sourceExecutionId: string;
  readonly agent: NonNullable<AIGenerateOptions['agent']>;
} {
  const validExecutionId = (value: unknown): value is string =>
    typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 128;
  if (!validExecutionId(options.executionId) || options.agent === undefined) {
    throw new TypeError('Coordenadas do checkpoint de IA inválidas.');
  }
  const sourceExecutionId = options.sourceExecutionId ?? options.executionId;
  if (!validExecutionId(sourceExecutionId)) {
    throw new TypeError('Execução de origem do checkpoint de IA inválida.');
  }
  if (
    (options.cacheMode === 'REQUIRE_HIT' && options.sourceExecutionId === undefined) ||
    (options.cacheMode !== 'REQUIRE_HIT' && options.sourceExecutionId !== undefined)
  ) {
    throw new TypeError('A origem do checkpoint é obrigatória somente em REQUIRE_HIT.');
  }
  return { executionId: options.executionId, sourceExecutionId, agent: options.agent };
}

function invalidResponse(provider: string, cause: unknown): AIProviderError {
  return new AIProviderError('Resposta técnica inválida do provider de IA.', {
    code: AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
    provider,
    cause,
  });
}

function requiredCacheMiss(provider: string, cause?: unknown): AIProviderError {
  return new AIProviderError('A resposta exata exigida não está disponível no cache de IA.', {
    code: AI_PROVIDER_ERROR_CODES.CACHE_MISS,
    provider,
    ...(cause === undefined ? {} : { cause }),
  });
}

async function failClaim(
  cache: AIResponseCache,
  key: AIResponseCacheKey,
  claimToken: string,
  provider: string,
): Promise<void> {
  try {
    await cache.fail({ ...key, claimToken });
  } catch (error) {
    throw requiredCacheMiss(provider, error);
  }
}

export function createCachedAIProvider(options: CreateCachedAIProviderOptions): AIProvider {
  if (
    typeof options.provider?.provider !== 'string' ||
    options.provider.provider.trim().length === 0 ||
    typeof options.provider.generate !== 'function' ||
    typeof options.cache?.get !== 'function' ||
    typeof options.cache.claim !== 'function' ||
    typeof options.cache.complete !== 'function' ||
    typeof options.cache.fail !== 'function'
  ) {
    throw new TypeError('Configuração do cache de respostas de IA inválida.');
  }

  const logger = options.logger ?? createLogger();
  const providerName = options.provider.provider;

  return Object.freeze({
    provider: providerName,
    capabilities: Object.freeze({ exactResponseCache: true as const }),
    async generate(
      request: AIRequest,
      generateOptions: AIGenerateOptions = {},
    ): Promise<AIResponse> {
      const requestResult = aiRequestSchema.safeParse(request);
      if (!requestResult.success) throw invalidAIRequest(providerName, requestResult.error);

      if (generateOptions.signal?.aborted === true) {
        throw new AIProviderError('Chamada ao provider de IA cancelada.', {
          code: AI_PROVIDER_ERROR_CODES.CANCELLED,
          provider: providerName,
        });
      }

      if (
        generateOptions.cacheMode !== undefined &&
        !['READ_WRITE', 'REQUIRE_HIT'].includes(generateOptions.cacheMode)
      ) {
        throw invalidAIRequest(providerName, new TypeError('cacheMode inválido.'));
      }

      const metadataResult = aiGenerateMetadataSchema.partial().safeParse({
        ...(generateOptions.timeoutMs === undefined
          ? {}
          : { timeoutMs: generateOptions.timeoutMs }),
        ...(generateOptions.requestId === undefined
          ? {}
          : { requestId: generateOptions.requestId }),
        ...(generateOptions.traceId === undefined ? {} : { traceId: generateOptions.traceId }),
      });
      if (!metadataResult.success) throw invalidAIRequest(providerName, metadataResult.error);

      const validRequest = requestResult.data;
      const requestHash = calculateAIRequestHash(validRequest);
      let coordinates;
      try {
        coordinates = cacheCoordinates(generateOptions);
      } catch (error) {
        throw invalidAIRequest(providerName, error);
      }
      const logContext = {
        executionId: coordinates.executionId,
        agent: coordinates.agent,
        provider: providerName,
        model: validRequest.model,
        requestHash,
        ...correlation(generateOptions),
      };

      if (generateOptions.cacheMode === 'REQUIRE_HIT') {
        const sourceKey: AIResponseCacheKey = {
          executionId: coordinates.sourceExecutionId,
          agent: coordinates.agent,
          provider: providerName,
          requestHash,
        };
        let source: AIResponseCacheEntry | null;
        try {
          source = await options.cache.get(sourceKey);
        } catch (error) {
          logger.warn('ai.cache.read_failed', logContext);
          throw requiredCacheMiss(providerName, error);
        }
        const validSource = source === null ? null : validCachedEntry(source, sourceKey);
        if (validSource === null) {
          logger.warn(source === null ? 'ai.cache.miss' : 'ai.cache.entry_invalid', logContext);
          throw requiredCacheMiss(providerName);
        }

        const childKey: AIResponseCacheKey = {
          executionId: coordinates.executionId,
          agent: coordinates.agent,
          provider: providerName,
          requestHash,
        };
        let rawClaim: AIResponseCacheClaimResult;
        try {
          rawClaim = await options.cache.claim(childKey);
        } catch (error) {
          logger.warn('ai.cache.claim_failed', logContext);
          throw requiredCacheMiss(providerName, error);
        }
        const claim = validClaimResult(rawClaim, childKey, validSource.response);
        if (claim === null || claim.status === 'IN_PROGRESS') {
          logger.warn(
            claim === null ? 'ai.cache.claim_invalid' : 'ai.cache.claim_in_progress',
            logContext,
          );
          throw requiredCacheMiss(providerName);
        }
        if (claim.status === 'COMPLETED') {
          logger.info('ai.cache.hit', { ...logContext, responseHash: claim.entry.responseHash });
          return structuredClone(claim.entry.response);
        }

        let copied: AIResponseCacheEntry;
        try {
          copied = await options.cache.complete({
            ...childKey,
            claimToken: claim.claimToken,
            response: validSource.response,
          });
        } catch (error) {
          logger.warn('ai.cache.replay_checkpoint_write_failed', logContext);
          throw requiredCacheMiss(providerName, error);
        }
        const validCopy = validCachedEntry(copied, childKey, validSource.response);
        if (validCopy === null) {
          logger.warn('ai.cache.replay_checkpoint_invalid', logContext);
          throw requiredCacheMiss(providerName);
        }
        logger.info('ai.cache.hit', { ...logContext, responseHash: validCopy.responseHash });
        return structuredClone(validCopy.response);
      }

      const key: AIResponseCacheKey = {
        executionId: coordinates.executionId,
        agent: coordinates.agent,
        provider: providerName,
        requestHash,
      };
      let rawClaim: AIResponseCacheClaimResult;
      try {
        rawClaim = await options.cache.claim(key);
      } catch (error) {
        logger.warn('ai.cache.claim_failed', logContext);
        throw requiredCacheMiss(providerName, error);
      }
      const claim = validClaimResult(rawClaim, key);
      if (claim === null || claim.status === 'IN_PROGRESS') {
        logger.warn(
          claim === null ? 'ai.cache.claim_invalid' : 'ai.cache.claim_in_progress',
          logContext,
        );
        throw requiredCacheMiss(providerName);
      }
      if (claim.status === 'COMPLETED') {
        logger.info('ai.cache.hit', { ...logContext, responseHash: claim.entry.responseHash });
        return structuredClone(claim.entry.response);
      }

      logger.info('ai.cache.miss', logContext);
      let rawResponse: AIResponse;
      try {
        rawResponse = await options.provider.generate(validRequest, generateOptions);
      } catch (error) {
        await failClaim(options.cache, key, claim.claimToken, providerName);
        throw error;
      }
      const responseResult = aiResponseSchema.safeParse(rawResponse);
      if (!responseResult.success || responseResult.data.provider !== providerName) {
        await failClaim(options.cache, key, claim.claimToken, providerName);
        throw invalidResponse(
          providerName,
          responseResult.success ? undefined : responseResult.error,
        );
      }
      const response = responseResult.data;

      if (response.finishReason !== 'COMPLETED') {
        await failClaim(options.cache, key, claim.claimToken, providerName);
        logger.info('ai.cache.skipped', {
          ...logContext,
          finishReason: response.finishReason,
        });
        return response;
      }

      const completedResponse = response as CompletedAIResponse;
      const responseHash = calculateAIResponseHash(completedResponse);
      let completed: AIResponseCacheEntry;
      try {
        completed = await options.cache.complete({
          ...key,
          claimToken: claim.claimToken,
          response: completedResponse,
        });
      } catch (error) {
        logger.warn('ai.cache.write_failed', { ...logContext, responseHash });
        throw requiredCacheMiss(providerName, error);
      }
      const validCompleted = validCachedEntry(completed, key, completedResponse);
      if (validCompleted === null) {
        logger.warn('ai.cache.completed_invalid', { ...logContext, responseHash });
        throw requiredCacheMiss(providerName);
      }
      logger.info('ai.cache.stored', { ...logContext, responseHash });
      return structuredClone(validCompleted.response);
    },
  });
}
