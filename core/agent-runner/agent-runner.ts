import { AIProviderError, AI_PROVIDER_ERROR_CODES, type AIGenerateOptions } from '@brq/ai-provider';
import { PromptBuilderError, type PromptBuildOptions } from '@brq/prompt-builder';
import { createLogger } from '@brq/shared/logger/logger';

import { toAIRequest } from './ai-request-mapper';
import type {
  AgentRunner,
  AgentRunContext,
  AgentRunOptions,
  AgentRunRequest,
  AgentRunResult,
  CreateAgentRunnerOptions,
  PromptMetadata,
  ProviderMetadata,
} from './contracts';
import {
  AGENT_RUN_ERROR_CODES,
  AgentRunError,
  type AgentRunErrorCode,
  type AgentRunStage,
} from './errors';
import { deepFreeze } from './immutability';
import {
  correlationLogContext,
  logRunError,
  metricsLogContext,
  promptLogContext,
  providerLogContext,
} from './logging';
import { aiRequestByteLength, elapsed, observedMetrics } from './metrics';
import { toPromptBuilderRequest } from './prompt-request-mapper';
import { createResponseEnvelope, responseEnvelopeOutput } from './response-envelope';
import {
  parseAgentRunOptions,
  parseAgentRunRequest,
  parseAgentRunResult,
  parsePromptResult,
  parseProviderResponse,
  parseSafeContext,
} from './validation';

function assertDependencies(options: CreateAgentRunnerOptions): void {
  if (
    typeof options.promptBuilder?.build !== 'function' ||
    typeof options.aiProvider?.generate !== 'function' ||
    typeof options.aiProvider.provider !== 'string' ||
    options.aiProvider.provider.trim().length === 0 ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new AgentRunError('Configuração do Agent Runner inválida.', {
      code: AGENT_RUN_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST_VALIDATION',
      elapsedMs: 0,
    });
  }
}

function errorCode(error: unknown, stage: AgentRunStage): AgentRunErrorCode {
  if (error instanceof AIProviderError) {
    if (error.code === AI_PROVIDER_ERROR_CODES.TIMEOUT) return AGENT_RUN_ERROR_CODES.TIMEOUT;
    if (error.code === AI_PROVIDER_ERROR_CODES.CANCELLED) return AGENT_RUN_ERROR_CODES.CANCELLED;
    return AGENT_RUN_ERROR_CODES.PROVIDER_FAILED;
  }

  if (error instanceof PromptBuilderError) {
    return AGENT_RUN_ERROR_CODES.PROMPT_BUILD_FAILED;
  }

  if (stage === 'REQUEST_VALIDATION') return AGENT_RUN_ERROR_CODES.INVALID_REQUEST;
  if (stage === 'PROMPT_VALIDATION') return AGENT_RUN_ERROR_CODES.INVALID_PROMPT_RESULT;
  if (stage === 'PROVIDER_RESPONSE_VALIDATION') {
    return AGENT_RUN_ERROR_CODES.INVALID_PROVIDER_RESPONSE;
  }
  return AGENT_RUN_ERROR_CODES.INTERNAL_ERROR;
}

function errorMessage(code: AgentRunErrorCode): string {
  switch (code) {
    case AGENT_RUN_ERROR_CODES.INVALID_REQUEST:
      return 'Solicitação do Agent Runner inválida.';
    case AGENT_RUN_ERROR_CODES.PROMPT_BUILD_FAILED:
      return 'Não foi possível construir o prompt.';
    case AGENT_RUN_ERROR_CODES.INVALID_PROMPT_RESULT:
      return 'O Prompt Builder retornou um resultado técnico inválido.';
    case AGENT_RUN_ERROR_CODES.PROVIDER_FAILED:
      return 'O AI Provider não concluiu a solicitação.';
    case AGENT_RUN_ERROR_CODES.INVALID_PROVIDER_RESPONSE:
      return 'O AI Provider retornou uma resposta técnica inválida.';
    case AGENT_RUN_ERROR_CODES.TIMEOUT:
      return 'O AI Provider excedeu o timeout configurado.';
    case AGENT_RUN_ERROR_CODES.CANCELLED:
      return 'A execução do agente foi cancelada.';
    default:
      return 'O Agent Runner não concluiu a execução.';
  }
}

interface ErrorContext {
  readonly stage: AgentRunStage;
  readonly startedAt: number;
  readonly now: () => number;
  readonly context?: AgentRunContext;
  readonly provider: string;
  readonly signal?: AbortSignal;
}

function asAgentRunError(error: unknown, details: ErrorContext): AgentRunError {
  if (error instanceof AgentRunError) return error;

  const sourceCode =
    error instanceof AIProviderError || error instanceof PromptBuilderError
      ? error.code
      : undefined;
  let code = errorCode(error, details.stage);

  if (
    code !== AGENT_RUN_ERROR_CODES.TIMEOUT &&
    code !== AGENT_RUN_ERROR_CODES.CANCELLED &&
    details.signal?.aborted === true
  ) {
    code = AGENT_RUN_ERROR_CODES.CANCELLED;
  }

  return new AgentRunError(errorMessage(code), {
    code,
    stage: details.stage,
    elapsedMs: elapsed(details.now, details.startedAt),
    ...(details.context === undefined
      ? {}
      : {
          executionId: details.context.execution.executionId,
          agentExecutionId: details.context.execution.agentExecutionId,
        }),
    ...(details.stage === 'PROVIDER_CALL' || details.stage === 'PROVIDER_RESPONSE_VALIDATION'
      ? { provider: details.provider }
      : {}),
    ...(sourceCode === undefined ? {} : { sourceCode }),
    ...(error instanceof AIProviderError ? { providerRetryable: error.retryable } : {}),
    cause: error,
  });
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  context: AgentRunContext,
  stage: AgentRunStage,
  startedAt: number,
  now: () => number,
): void {
  if (signal?.aborted !== true) return;

  throw new AgentRunError('A execução do agente foi cancelada.', {
    code: AGENT_RUN_ERROR_CODES.CANCELLED,
    stage,
    elapsedMs: elapsed(now, startedAt),
    executionId: context.execution.executionId,
    agentExecutionId: context.execution.agentExecutionId,
  });
}

function failureEvent(error: AgentRunError) {
  if (error.code === AGENT_RUN_ERROR_CODES.CANCELLED) return 'agent.run.cancelled' as const;
  if (error.code === AGENT_RUN_ERROR_CODES.TIMEOUT) return 'agent.run.timed_out' as const;
  return 'agent.run.failed' as const;
}

export function createAgentRunner(options: CreateAgentRunnerOptions): AgentRunner {
  assertDependencies(options);

  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());

  return Object.freeze({
    async run(
      rawRequest: AgentRunRequest,
      runOptions: AgentRunOptions = {},
    ): Promise<AgentRunResult> {
      const startedAt = now();
      let stage: AgentRunStage = 'REQUEST_VALIDATION';
      let context = parseSafeContext(rawRequest);
      let signal: AbortSignal | undefined;

      try {
        const validRunOptions = parseAgentRunOptions(runOptions);
        signal = validRunOptions.signal;
        const request = parseAgentRunRequest(rawRequest);
        context = request.context;
        throwIfAborted(signal, request.context, stage, startedAt, now);

        logger.info('agent.run.started', {
          ...correlationLogContext(request.context),
          requestedModel: request.model,
          timeoutMs: request.timeoutMs,
          maxOutputUnits: request.maxOutputTokens,
          promptId: request.prompt.template.id,
        });

        stage = 'PROMPT_BUILD';
        const promptStartedAt = now();
        const promptOptions: PromptBuildOptions = {
          ...(request.prompt.maxBytes === undefined ? {} : { maxBytes: request.prompt.maxBytes }),
          ...(request.context.requestId === undefined
            ? {}
            : { requestId: request.context.requestId }),
          ...(request.context.traceId === undefined ? {} : { traceId: request.context.traceId }),
        };
        const rawPrompt = options.promptBuilder.build(
          toPromptBuilderRequest(request.prompt),
          promptOptions,
        );
        const promptBuilderDurationMs = elapsed(now, promptStartedAt);

        stage = 'PROMPT_VALIDATION';
        const prompt = parsePromptResult(rawPrompt);
        const promptMetadata: PromptMetadata = {
          metadata: prompt.metadata,
          budget: prompt.budget,
        };

        logger.info('agent.run.prompt.completed', {
          ...correlationLogContext(request.context),
          ...promptLogContext(promptMetadata),
          promptBuilderDurationMs,
        });

        stage = 'PROVIDER_REQUEST_MAPPING';
        const aiRequest = toAIRequest(prompt, request.model, request.maxOutputTokens);
        const bytesSent = aiRequestByteLength(aiRequest);
        throwIfAborted(signal, request.context, stage, startedAt, now);

        stage = 'PROVIDER_CALL';
        const providerStartedAt = now();
        const generateOptions: AIGenerateOptions = {
          ...(signal === undefined ? {} : { signal }),
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
          ...(request.context.requestId === undefined
            ? {}
            : { requestId: request.context.requestId }),
          ...(request.context.traceId === undefined ? {} : { traceId: request.context.traceId }),
        };
        const rawResponse = await options.aiProvider.generate(aiRequest, generateOptions);
        const providerDurationMs = elapsed(now, providerStartedAt);

        stage = 'PROVIDER_RESPONSE_VALIDATION';
        const response = parseProviderResponse(rawResponse, options.aiProvider.provider);
        const envelope = createResponseEnvelope(response);
        const providerMetadata: ProviderMetadata = {
          provider: response.provider,
          requestedModel: request.model,
          responseModel: response.model,
          responseId: response.metadata.responseId,
        };

        logger.info('agent.run.provider.completed', {
          ...correlationLogContext(request.context),
          ...providerLogContext(providerMetadata),
          responseHash: envelope.responseHash,
          finishReason: response.finishReason,
          providerDurationMs,
          providerReportedDurationMs: response.metadata.durationMs,
          providerAttempts: response.metadata.attempts,
          usageInputCount: response.usage.inputTokens,
          usageOutputCount: response.usage.outputTokens,
        });

        stage = 'FINALIZATION';
        const metrics = {
          observed: observedMetrics({
            totalDurationMs: elapsed(now, startedAt),
            promptBuilderDurationMs,
            providerDurationMs,
            bytesSent,
            bytesReceived: envelope.sizeBytes,
          }),
          reported: {
            durationMs: response.metadata.durationMs,
            attempts: response.metadata.attempts,
            usage: response.usage,
          },
        };
        const result = deepFreeze(
          parseAgentRunResult({
            context: request.context,
            prompt: promptMetadata,
            outputContract: prompt.outputContract,
            output: responseEnvelopeOutput(envelope),
            provider: providerMetadata,
            metrics,
          }),
        );

        logger.info('agent.run.completed', {
          ...correlationLogContext(request.context),
          ...promptLogContext(result.prompt),
          ...providerLogContext(result.provider),
          ...metricsLogContext(result.metrics),
          responseHash: result.output.responseHash,
          finishReason: result.output.finishReason,
        });

        return result;
      } catch (error) {
        const runError = asAgentRunError(error, {
          stage,
          startedAt,
          now,
          provider: options.aiProvider.provider,
          ...(context === undefined ? {} : { context }),
          ...(signal === undefined ? {} : { signal }),
        });
        logRunError(logger, failureEvent(runError), runError, context);
        throw runError;
      }
    },
  });
}
