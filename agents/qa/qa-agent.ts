import { AGENT_RUN_ERROR_CODES, AgentRunError } from '@brq/agent-runner';
import { validateDeveloperBusinessRules } from '@brq/developer-agent';
import { createLogger } from '@brq/shared/logger/logger';

import { createQABusinessStructureRejection, validateQABusinessRules } from './business-validation';
import type {
  CreateQAAgentOptions,
  QAAgent,
  QAAgentRequest,
  QAAgentResult,
  QAAgentRunOptions,
  QABusinessValidationResult,
  QASpecification,
} from './contracts';
import {
  QA_AGENT_ERROR_CODES,
  QAAgentError,
  sanitizeQASourceCode,
  type QAAgentErrorCode,
  type QAAgentStage,
} from './errors';
import { deepFreeze } from './immutability';
import { projectQAPromptContexts } from './knowledge-projection';
import {
  businessValidationLogContext,
  errorLogContext,
  generationLogContext,
  knowledgeLogContext,
  requestLogContext,
  responseValidationLogContext,
  runLogContext,
  specificationLogContext,
} from './logging';
import { QAPromptAssetsError, validateQAPromptAssets } from './prompt-assets';
import { createQAAgentRunRequest } from './prompt-request';
import {
  createBusinessRejectedResult,
  createGeneratedResult,
  createResponseRejectedResult,
} from './result';
import {
  qaAgentContextSchema,
  qaAgentRequestSchema,
  qaSpecificationStructureSchema,
} from './schemas';

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function safeSourceCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  if (error instanceof AgentRunError && error.sourceCode === 'AI_PROVIDER_CACHE_MISS') {
    return sanitizeQASourceCode(error.sourceCode);
  }
  return sanitizeQASourceCode(error.code);
}

function requestIdentity(rawRequest: unknown): Partial<QAAgentRequest['context']> {
  if (typeof rawRequest !== 'object' || rawRequest === null || !('context' in rawRequest)) {
    return {};
  }
  const context = qaAgentContextSchema.safeParse(rawRequest.context);
  return context.success ? context.data : {};
}

function qaError(
  message: string,
  options: {
    readonly code: QAAgentErrorCode;
    readonly stage: QAAgentStage;
    readonly durationMs: number;
    readonly request?: QAAgentRequest;
    readonly rawRequest?: unknown;
    readonly cause?: unknown;
    readonly sourceCode?: string;
  },
): QAAgentError {
  const identity =
    options.request?.context ??
    (options.rawRequest === undefined ? {} : requestIdentity(options.rawRequest));

  return new QAAgentError(message, {
    code: options.code,
    stage: options.stage,
    durationMs: options.durationMs,
    ...('executionId' in identity && identity.executionId !== undefined
      ? { executionId: identity.executionId }
      : {}),
    ...('agentExecutionId' in identity && identity.agentExecutionId !== undefined
      ? { agentExecutionId: identity.agentExecutionId }
      : {}),
    ...('requestId' in identity && identity.requestId !== undefined
      ? { requestId: identity.requestId }
      : {}),
    ...('traceId' in identity && identity.traceId !== undefined
      ? { traceId: identity.traceId }
      : {}),
    ...(options.sourceCode === undefined ? {} : { sourceCode: options.sourceCode }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
}

function assertDependencies(options: CreateQAAgentOptions): void {
  const logger = options.logger;
  const validLogger =
    logger === undefined ||
    (logger !== null &&
      typeof logger === 'object' &&
      typeof logger.debug === 'function' &&
      typeof logger.info === 'function' &&
      typeof logger.warn === 'function' &&
      typeof logger.error === 'function');

  if (
    typeof options.knowledgeLoader?.load !== 'function' ||
    typeof options.agentRunner?.run !== 'function' ||
    typeof options.responseValidator?.validate !== 'function' ||
    typeof options.artifactGenerator?.generate !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function') ||
    !validLogger
  ) {
    throw qaError('Configuração do QA Agent inválida.', {
      code: QA_AGENT_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST_VALIDATION',
      durationMs: 0,
    });
  }
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  stage: QAAgentStage,
  request: QAAgentRequest,
  durationMs: number,
): void {
  if (!signal?.aborted) return;

  throw qaError('A execução do QA Agent foi cancelada.', {
    code: QA_AGENT_ERROR_CODES.CANCELLED,
    stage,
    durationMs,
    request,
  });
}

function errorCodeForStage(stage: QAAgentStage, error: unknown): QAAgentErrorCode {
  if (error instanceof AgentRunError) {
    if (error.code === AGENT_RUN_ERROR_CODES.CANCELLED) {
      return QA_AGENT_ERROR_CODES.CANCELLED;
    }
    if (error.code === AGENT_RUN_ERROR_CODES.TIMEOUT) {
      return QA_AGENT_ERROR_CODES.TIMEOUT;
    }
  }

  if (stage === 'KNOWLEDGE_LOADING') return QA_AGENT_ERROR_CODES.KNOWLEDGE_LOAD_FAILED;
  if (stage === 'CONTEXT_PROJECTION') {
    return QA_AGENT_ERROR_CODES.CONTEXT_PROJECTION_FAILED;
  }
  if (stage === 'RUNNER_EXECUTION') return QA_AGENT_ERROR_CODES.RUN_FAILED;
  if (stage === 'RESPONSE_VALIDATION' || stage === 'BUSINESS_VALIDATION') {
    return QA_AGENT_ERROR_CODES.VALIDATION_FAILED;
  }
  if (stage === 'ARTIFACT_GENERATION') {
    return QA_AGENT_ERROR_CODES.ARTIFACT_GENERATION_FAILED;
  }
  return QA_AGENT_ERROR_CODES.INTERNAL_ERROR;
}

function translateError(
  error: unknown,
  stage: QAAgentStage,
  durationMs: number,
  request?: QAAgentRequest,
  rawRequest?: unknown,
): QAAgentError {
  if (error instanceof QAAgentError) {
    if (error.durationMs === durationMs) return error;
    return qaError(error.message, {
      code: error.code,
      stage: error.stage,
      durationMs,
      ...(request === undefined ? {} : { request }),
      ...(rawRequest === undefined ? {} : { rawRequest }),
      ...(error.sourceCode === undefined ? {} : { sourceCode: error.sourceCode }),
      cause: error.cause ?? error,
    });
  }

  const sourceCode = safeSourceCode(error);

  return qaError('O QA Agent não concluiu a execução.', {
    code: errorCodeForStage(stage, error),
    stage,
    durationMs,
    ...(request === undefined ? {} : { request }),
    ...(rawRequest === undefined ? {} : { rawRequest }),
    ...(sourceCode === undefined ? {} : { sourceCode }),
    cause: error,
  });
}

function readQASpecification(
  validation: { readonly validatedOutput: unknown },
  request: QAAgentRequest,
  durationMs: number,
) {
  const validatedOutput = validation.validatedOutput;
  if (
    typeof validatedOutput !== 'object' ||
    validatedOutput === null ||
    !('format' in validatedOutput) ||
    validatedOutput.format !== 'JSON_SCHEMA' ||
    !('data' in validatedOutput)
  ) {
    throw qaError('A saída validada é incompatível com o contrato do QA Agent.', {
      code: QA_AGENT_ERROR_CODES.VALIDATED_OUTPUT_INCOMPATIBLE,
      stage: 'BUSINESS_VALIDATION',
      durationMs,
      request,
    });
  }

  return qaSpecificationStructureSchema.safeParse(validatedOutput.data);
}

function completeLogContext(
  request: QAAgentRequest,
  assets: Parameters<typeof requestLogContext>[1],
  durationMs: number,
  result: QAAgentResult,
) {
  return {
    ...requestLogContext(request, assets),
    outcome: result.outcome,
    readiness: result.readiness,
    durationMs,
  };
}

export function createQAAgent(options: CreateQAAgentOptions): QAAgent {
  assertDependencies(options);
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());
  let assets: CreateQAAgentOptions['promptAssets'];

  try {
    assets = validateQAPromptAssets(options.promptAssets);
  } catch (error) {
    const sourceCode = error instanceof QAPromptAssetsError ? error.code : safeSourceCode(error);
    throw qaError('Assets do QA Agent inválidos.', {
      code: QA_AGENT_ERROR_CODES.INVALID_PROMPT_ASSETS,
      stage: 'ASSET_VALIDATION',
      durationMs: 0,
      ...(sourceCode === undefined ? {} : { sourceCode }),
      cause: error,
    });
  }

  return Object.freeze({
    async execute(
      rawRequest: QAAgentRequest,
      runOptions: QAAgentRunOptions = {},
    ): Promise<QAAgentResult> {
      const startedAt = now();
      let stage: QAAgentStage = 'REQUEST_VALIDATION';
      let request: QAAgentRequest | undefined;

      try {
        const requestResult = qaAgentRequestSchema.safeParse(rawRequest);
        if (!requestResult.success) {
          throw qaError('Solicitação do QA Agent inválida.', {
            code: QA_AGENT_ERROR_CODES.INVALID_REQUEST,
            stage,
            durationMs: elapsed(now, startedAt),
            rawRequest,
            cause: requestResult.error,
          });
        }

        request = deepFreeze(requestResult.data as QAAgentRequest);
        logger.info('qa.agent.started', requestLogContext(request, assets));
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'SOURCE_VALIDATION';
        const sourceValidation = validateDeveloperBusinessRules(
          request.technicalSpecification,
          request.productOwnerSpecification,
          request.deliveryIntent,
        );
        if (!sourceValidation.valid) {
          throw qaError('As especificações de origem são incompatíveis.', {
            code: QA_AGENT_ERROR_CODES.INCOMPATIBLE_SOURCE_SPECIFICATIONS,
            stage,
            durationMs: elapsed(now, startedAt),
            request,
          });
        }
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'KNOWLEDGE_LOADING';
        const knowledge = await options.knowledgeLoader.load({
          context: 'QA',
          ...(request.limits?.knowledgeMaxDocuments === undefined
            ? {}
            : { maxDocuments: request.limits.knowledgeMaxDocuments }),
          ...(request.limits?.knowledgeMaxBytes === undefined
            ? {}
            : { maxBytes: request.limits.knowledgeMaxBytes }),
        });
        logger.info('qa.knowledge.loaded', {
          ...requestLogContext(request, assets),
          ...knowledgeLogContext(knowledge),
        });
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'CONTEXT_PROJECTION';
        const promptContexts = projectQAPromptContexts(knowledge, request, assets.manifest);
        const runRequest = createQAAgentRunRequest(request, promptContexts, assets);

        stage = 'RUNNER_EXECUTION';
        const run = await options.agentRunner.run(runRequest, {
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
          ...(runOptions.cacheMode === undefined ? {} : { cacheMode: runOptions.cacheMode }),
          ...(runOptions.sourceExecutionId === undefined
            ? {}
            : { sourceExecutionId: runOptions.sourceExecutionId }),
        });
        logger.info('qa.run.completed', {
          ...requestLogContext(request, assets),
          ...runLogContext(run),
        });
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'RESPONSE_VALIDATION';
        const responseValidation = options.responseValidator.validate({
          runResult: run,
          contract: assets.validationContract,
        });
        const resultContext = { request, assets, knowledge, run, responseValidation };

        if (!responseValidation.valid) {
          const result = createResponseRejectedResult(resultContext);
          logger.warn('qa.validation.rejected', {
            ...requestLogContext(request, assets),
            rejectedAt: 'RESPONSE_VALIDATION',
            ...responseValidationLogContext(responseValidation),
          });
          logger.info(
            'qa.agent.completed',
            completeLogContext(request, assets, elapsed(now, startedAt), result),
          );
          return result;
        }

        stage = 'BUSINESS_VALIDATION';
        const specificationResult = readQASpecification(
          responseValidation,
          request,
          elapsed(now, startedAt),
        );
        let businessValidation: QABusinessValidationResult;
        let qaSpecification: QASpecification | undefined;

        if (!specificationResult.success) {
          businessValidation = createQABusinessStructureRejection(specificationResult.error.issues);
        } else {
          qaSpecification = deepFreeze(specificationResult.data) as QASpecification;
          businessValidation = validateQABusinessRules(
            qaSpecification,
            request.productOwnerSpecification,
            request.technicalSpecification,
          );
        }

        if (!businessValidation.valid || qaSpecification === undefined) {
          const result = createBusinessRejectedResult(resultContext, businessValidation);
          logger.warn('qa.validation.rejected', {
            ...requestLogContext(request, assets),
            rejectedAt: 'BUSINESS_VALIDATION',
            ...responseValidationLogContext(responseValidation),
            ...businessValidationLogContext(businessValidation),
          });
          logger.info(
            'qa.agent.completed',
            completeLogContext(request, assets, elapsed(now, startedAt), result),
          );
          return result;
        }

        logger.info('qa.validation.accepted', {
          ...requestLogContext(request, assets),
          ...responseValidationLogContext(responseValidation),
          ...businessValidationLogContext(businessValidation),
          ...specificationLogContext(qaSpecification),
        });
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'ARTIFACT_GENERATION';
        const generation = options.artifactGenerator.generate({
          validation: responseValidation,
          specification: assets.artifactSpecification,
        });
        logger.info('qa.artifacts.generated', {
          ...requestLogContext(request, assets),
          ...generationLogContext(generation),
        });

        stage = 'FINALIZATION';
        const result = createGeneratedResult(
          resultContext,
          qaSpecification,
          businessValidation,
          generation,
        );
        logger.info(
          'qa.agent.completed',
          completeLogContext(request, assets, elapsed(now, startedAt), result),
        );
        return result;
      } catch (error) {
        const qaAgentError = translateError(
          error,
          stage,
          elapsed(now, startedAt),
          request,
          rawRequest,
        );
        logger.error('qa.agent.failed', errorLogContext(qaAgentError));
        throw qaAgentError;
      }
    },
  });
}
