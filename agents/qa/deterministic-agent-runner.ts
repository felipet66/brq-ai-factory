import { Buffer } from 'node:buffer';

import {
  AGENT_RUN_ERROR_CODES,
  AgentRunError,
  agentRunRequestSchema,
  agentRunResultSchema,
  type AgentRunner,
  type AgentRunContext,
  type AgentRunOptions,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentRunStage,
} from '@brq/agent-runner';
import { technicalSpecificationSchema, type TechnicalSpecification } from '@brq/developer-agent';
import {
  productOwnerSpecificationSchema,
  type ProductOwnerSpecification,
} from '@brq/product-owner-agent';
import {
  PromptBuilderError,
  canonicalizeJson,
  calculateCanonicalJsonHash,
  calculatePromptHash,
  promptResultSchema,
  type PromptBuildOptions,
  type PromptContextInput,
} from '@brq/prompt-builder';
import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';

import { compileCanonicalQASpecification } from './canonical-qa-compiler';
import type { CreateDeterministicQAAgentRunnerOptions } from './contracts';
import { deepFreeze } from './immutability';

const PROVIDER = 'deterministic-qa-compiler';
const RESPONSE_MODEL = 'deterministic-qa-compiler-v1';

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function validLogger(logger: CreateDeterministicQAAgentRunnerOptions['logger']): boolean {
  return (
    logger === undefined ||
    (logger !== null &&
      typeof logger === 'object' &&
      typeof logger.debug === 'function' &&
      typeof logger.info === 'function' &&
      typeof logger.warn === 'function' &&
      typeof logger.error === 'function')
  );
}

function safeContext(rawRequest: unknown): AgentRunContext | undefined {
  if (typeof rawRequest !== 'object' || rawRequest === null || !('context' in rawRequest)) {
    return undefined;
  }
  const parsed = agentRunRequestSchema.shape.context.safeParse(rawRequest.context);
  return parsed.success ? parsed.data : undefined;
}

function runnerError(
  message: string,
  options: {
    readonly code: (typeof AGENT_RUN_ERROR_CODES)[keyof typeof AGENT_RUN_ERROR_CODES];
    readonly stage: AgentRunStage;
    readonly elapsedMs: number;
    readonly context?: AgentRunContext;
    readonly sourceCode?: string;
    readonly cause?: unknown;
  },
): AgentRunError {
  return new AgentRunError(message, {
    code: options.code,
    stage: options.stage,
    elapsedMs: options.elapsedMs,
    ...(options.context === undefined
      ? {}
      : {
          executionId: options.context.execution.executionId,
          agentExecutionId: options.context.execution.agentExecutionId,
        }),
    ...(options.sourceCode === undefined ? {} : { sourceCode: options.sourceCode }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  context: AgentRunContext,
  stage: AgentRunStage,
  elapsedMs: number,
): void {
  if (signal?.aborted !== true) return;
  throw runnerError('A execução determinística do QA foi cancelada.', {
    code: AGENT_RUN_ERROR_CODES.CANCELLED,
    stage,
    elapsedMs,
    context,
  });
}

function parseRunSignal(rawOptions: unknown): AbortSignal | undefined {
  if (typeof rawOptions !== 'object' || rawOptions === null || Array.isArray(rawOptions)) {
    throw new TypeError('Opções do runner determinístico do QA inválidas.');
  }
  const entries = Object.entries(rawOptions);
  if (
    entries.some(([key]) => key !== 'signal' && key !== 'cacheMode' && key !== 'sourceExecutionId')
  ) {
    throw new TypeError('Opções do runner determinístico do QA inválidas.');
  }
  if (
    'cacheMode' in rawOptions &&
    rawOptions.cacheMode !== undefined &&
    rawOptions.cacheMode !== 'READ_WRITE' &&
    rawOptions.cacheMode !== 'REQUIRE_HIT'
  ) {
    throw new TypeError('cacheMode do runner determinístico do QA inválido.');
  }
  if (
    'sourceExecutionId' in rawOptions &&
    rawOptions.sourceExecutionId !== undefined &&
    (typeof rawOptions.sourceExecutionId !== 'string' ||
      !/^execution-[a-f0-9]{32}$/.test(rawOptions.sourceExecutionId))
  ) {
    throw new TypeError('sourceExecutionId do runner determinístico do QA inválido.');
  }
  if (!('signal' in rawOptions) || rawOptions.signal === undefined) return undefined;
  const signal = rawOptions.signal;
  if (
    typeof signal !== 'object' ||
    signal === null ||
    !('aborted' in signal) ||
    typeof signal.aborted !== 'boolean' ||
    !('addEventListener' in signal) ||
    typeof signal.addEventListener !== 'function' ||
    !('removeEventListener' in signal) ||
    typeof signal.removeEventListener !== 'function'
  ) {
    throw new TypeError('AbortSignal inválido.');
  }
  return signal as AbortSignal;
}

function expectedContextHash(context: PromptContextInput): string {
  return `sha256:${calculateCanonicalJsonHash(context.content as unknown as JsonValue)}`;
}

function readSourceSpecifications(contexts: readonly PromptContextInput[]): {
  readonly productOwnerSpecification: ProductOwnerSpecification;
  readonly technicalSpecification: TechnicalSpecification;
} {
  const artifactContexts = contexts.filter(
    (context) => context.kind === 'ARTIFACT' && context.serialization === 'JSON',
  );
  const productOwnerCandidates = artifactContexts.flatMap((context) => {
    const parsed = productOwnerSpecificationSchema.safeParse(context.content);
    return parsed.success ? [{ context, specification: parsed.data }] : [];
  });
  const technicalCandidates = artifactContexts.flatMap((context) => {
    const parsed = technicalSpecificationSchema.safeParse(context.content);
    return parsed.success ? [{ context, specification: parsed.data }] : [];
  });

  if (productOwnerCandidates.length !== 1 || technicalCandidates.length !== 1) {
    throw new Error('Os contextos devem conter exatamente uma especificação PO e uma Developer.');
  }
  const productOwnerCandidate = productOwnerCandidates[0]!;
  const technicalCandidate = technicalCandidates[0]!;
  if (
    productOwnerCandidate.context.contentHash !==
      expectedContextHash(productOwnerCandidate.context) ||
    technicalCandidate.context.contentHash !== expectedContextHash(technicalCandidate.context)
  ) {
    throw new Error('O hash de uma especificação de origem é incompatível com o conteúdo.');
  }

  return {
    productOwnerSpecification: productOwnerCandidate.specification,
    technicalSpecification: technicalCandidate.specification,
  };
}

function promptBuildOptions(request: AgentRunRequest): PromptBuildOptions {
  return {
    ...(request.prompt.maxBytes === undefined ? {} : { maxBytes: request.prompt.maxBytes }),
    ...(request.context.requestId === undefined ? {} : { requestId: request.context.requestId }),
    ...(request.context.traceId === undefined ? {} : { traceId: request.context.traceId }),
  };
}

function errorCode(error: unknown, stage: AgentRunStage) {
  if (error instanceof PromptBuilderError) return AGENT_RUN_ERROR_CODES.PROMPT_BUILD_FAILED;
  if (stage === 'REQUEST_VALIDATION') return AGENT_RUN_ERROR_CODES.INVALID_REQUEST;
  if (stage === 'PROMPT_VALIDATION') return AGENT_RUN_ERROR_CODES.INVALID_PROMPT_RESULT;
  return AGENT_RUN_ERROR_CODES.INTERNAL_ERROR;
}

export function createDeterministicQAAgentRunner(
  options: CreateDeterministicQAAgentRunnerOptions,
): AgentRunner {
  if (
    typeof options?.promptBuilder?.build !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function') ||
    !validLogger(options.logger)
  ) {
    throw runnerError('Configuração do runner determinístico do QA inválida.', {
      code: AGENT_RUN_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST_VALIDATION',
      elapsedMs: 0,
    });
  }

  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());

  return Object.freeze({
    async run(
      rawRequest: AgentRunRequest,
      runOptions: AgentRunOptions = {},
    ): Promise<AgentRunResult> {
      const startedAt = now();
      let stage: AgentRunStage = 'REQUEST_VALIDATION';
      let context = safeContext(rawRequest);

      try {
        const signal = parseRunSignal(runOptions);
        const requestResult = agentRunRequestSchema.safeParse(rawRequest);
        if (!requestResult.success) {
          throw runnerError('Solicitação do runner determinístico do QA inválida.', {
            code: AGENT_RUN_ERROR_CODES.INVALID_REQUEST,
            stage,
            elapsedMs: elapsed(now, startedAt),
            ...(context === undefined ? {} : { context }),
            cause: requestResult.error,
          });
        }
        const request = requestResult.data as AgentRunRequest;
        context = request.context;
        if (context.execution.agent !== 'QA') {
          throw runnerError('O runner determinístico aceita somente execuções do QA.', {
            code: AGENT_RUN_ERROR_CODES.INVALID_REQUEST,
            stage,
            elapsedMs: elapsed(now, startedAt),
            context,
          });
        }
        assertNotAborted(signal, context, stage, elapsed(now, startedAt));
        const sources = readSourceSpecifications(request.prompt.contexts);

        logger.info('agent.run.started', {
          executionId: context.execution.executionId,
          agentExecutionId: context.execution.agentExecutionId,
          agent: context.execution.agent,
          requestedModel: request.model,
          promptId: request.prompt.template.id,
          executionMode: 'DETERMINISTIC',
        });

        stage = 'PROMPT_BUILD';
        const promptStartedAt = now();
        const rawPrompt = options.promptBuilder.build(
          {
            template: request.prompt.template,
            ruleSets: request.prompt.ruleSets,
            contexts: request.prompt.contexts,
            variables: request.prompt.variables,
            constraints: request.prompt.constraints,
            outputContract: request.prompt.outputContract,
          },
          promptBuildOptions(request),
        );
        const promptBuilderDurationMs = elapsed(now, promptStartedAt);

        stage = 'PROMPT_VALIDATION';
        const prompt = promptResultSchema.parse(rawPrompt);
        assertNotAborted(signal, context, stage, elapsed(now, startedAt));

        stage = 'FINALIZATION';
        const specification = compileCanonicalQASpecification(sources);
        const structuredData = specification as unknown as JsonValue;
        const content = canonicalizeJson(structuredData);
        const responseEnvelope = {
          provider: PROVIDER,
          model: RESPONSE_MODEL,
          content,
          structuredData,
          finishReason: 'COMPLETED',
          usage: { inputTokens: 0, outputTokens: 0 },
          metadata: { responseId: null, durationMs: 0, attempts: 1 },
        } as const;
        const canonicalResponse = canonicalizeJson(responseEnvelope as unknown as JsonValue);
        const result = agentRunResultSchema.parse({
          context: request.context,
          prompt: { metadata: prompt.metadata, budget: prompt.budget },
          outputContract: prompt.outputContract,
          output: {
            content,
            structuredData,
            finishReason: 'COMPLETED',
            responseHash: calculatePromptHash(canonicalResponse),
          },
          provider: {
            provider: PROVIDER,
            requestedModel: request.model,
            responseModel: RESPONSE_MODEL,
            responseId: null,
          },
          metrics: {
            observed: {
              totalDurationMs: elapsed(now, startedAt),
              promptBuilderDurationMs,
              providerDurationMs: 0,
              bytesSent: 0,
              bytesReceived: Buffer.byteLength(canonicalResponse, 'utf8'),
            },
            reported: {
              durationMs: 0,
              attempts: 1,
              usage: { inputTokens: 0, outputTokens: 0 },
            },
          },
        }) as AgentRunResult;

        logger.info('agent.run.completed', {
          executionId: context.execution.executionId,
          agentExecutionId: context.execution.agentExecutionId,
          agent: context.execution.agent,
          executionMode: 'DETERMINISTIC',
          promptHash: result.prompt.metadata.promptHash,
          responseHash: result.output.responseHash,
          usageInputCount: 0,
          usageOutputCount: 0,
        });
        return deepFreeze(result);
      } catch (error) {
        const runError =
          error instanceof AgentRunError
            ? error
            : runnerError(
                stage === 'PROMPT_BUILD'
                  ? 'Não foi possível construir o prompt do QA.'
                  : stage === 'REQUEST_VALIDATION'
                    ? 'Os contextos de origem do runner determinístico são inválidos.'
                    : 'O runner determinístico do QA não concluiu a execução.',
                {
                  code: errorCode(error, stage),
                  stage,
                  elapsedMs: elapsed(now, startedAt),
                  ...(context === undefined ? {} : { context }),
                  ...(error instanceof PromptBuilderError ? { sourceCode: error.code } : {}),
                  cause: error,
                },
              );
        logger.error(
          runError.code === AGENT_RUN_ERROR_CODES.CANCELLED
            ? 'agent.run.cancelled'
            : 'agent.run.failed',
          {
            errorCode: runError.code,
            stage: runError.stage,
            elapsedMs: runError.elapsedMs,
            executionId: runError.executionId,
            agentExecutionId: runError.agentExecutionId,
            sourceCode: runError.sourceCode,
            executionMode: 'DETERMINISTIC',
          },
        );
        throw runError;
      }
    },
  });
}
