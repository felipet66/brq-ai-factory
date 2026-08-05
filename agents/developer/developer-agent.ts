import { AGENT_RUN_ERROR_CODES, AgentRunError } from '@brq/agent-runner';
import { createLogger } from '@brq/shared/logger/logger';

import {
  createDeveloperBusinessStructureRejection,
  validateDeveloperBusinessRules,
} from './business-validation';
import type {
  CreateDeveloperAgentOptions,
  DeveloperAgent,
  DeveloperAgentRequest,
  DeveloperAgentResult,
  DeveloperAgentRunOptions,
  DeveloperBusinessValidationResult,
  TechnicalSpecification,
} from './contracts';
import {
  DEVELOPER_AGENT_ERROR_CODES,
  DeveloperAgentError,
  sanitizeDeveloperSourceCode,
  type DeveloperAgentErrorCode,
  type DeveloperAgentStage,
} from './errors';
import { deepFreeze } from './immutability';
import { projectDeveloperPromptContexts } from './knowledge-projection';
import {
  businessValidationLogContext,
  errorLogContext,
  generationLogContext,
  knowledgeLogContext,
  requestLogContext,
  responseValidationLogContext,
  runLogContext,
} from './logging';
import { DeveloperPromptAssetsError, validateDeveloperPromptAssets } from './prompt-assets';
import { createDeveloperAgentRunRequest } from './prompt-request';
import {
  createBusinessRejectedResult,
  createGeneratedResult,
  createResponseRejectedResult,
} from './result';
import {
  developerAgentContextSchema,
  developerAgentRequestSchema,
  technicalSpecificationStructureSchema,
} from './schemas';

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function safeSourceCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return sanitizeDeveloperSourceCode(error.code);
}

function requestIdentity(rawRequest: unknown): Partial<DeveloperAgentRequest['context']> {
  if (typeof rawRequest !== 'object' || rawRequest === null || !('context' in rawRequest)) {
    return {};
  }
  const context = developerAgentContextSchema.safeParse(rawRequest.context);
  return context.success ? context.data : {};
}

function developerError(
  message: string,
  options: {
    readonly code: DeveloperAgentErrorCode;
    readonly stage: DeveloperAgentStage;
    readonly durationMs: number;
    readonly request?: DeveloperAgentRequest;
    readonly rawRequest?: unknown;
    readonly cause?: unknown;
    readonly sourceCode?: string;
  },
): DeveloperAgentError {
  const identity =
    options.request?.context ??
    (options.rawRequest === undefined ? {} : requestIdentity(options.rawRequest));

  return new DeveloperAgentError(message, {
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

function assertDependencies(options: CreateDeveloperAgentOptions): void {
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
    throw developerError('Configuração do Developer Agent inválida.', {
      code: DEVELOPER_AGENT_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST_VALIDATION',
      durationMs: 0,
    });
  }
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  stage: DeveloperAgentStage,
  request: DeveloperAgentRequest,
  durationMs: number,
): void {
  if (!signal?.aborted) return;

  throw developerError('A execução do Developer Agent foi cancelada.', {
    code: DEVELOPER_AGENT_ERROR_CODES.CANCELLED,
    stage,
    durationMs,
    request,
  });
}

function errorCodeForStage(stage: DeveloperAgentStage, error: unknown): DeveloperAgentErrorCode {
  if (error instanceof AgentRunError) {
    if (error.code === AGENT_RUN_ERROR_CODES.CANCELLED) {
      return DEVELOPER_AGENT_ERROR_CODES.CANCELLED;
    }
    if (error.code === AGENT_RUN_ERROR_CODES.TIMEOUT) {
      return DEVELOPER_AGENT_ERROR_CODES.TIMEOUT;
    }
  }

  if (stage === 'KNOWLEDGE_LOADING') return DEVELOPER_AGENT_ERROR_CODES.KNOWLEDGE_LOAD_FAILED;
  if (stage === 'CONTEXT_PROJECTION') {
    return DEVELOPER_AGENT_ERROR_CODES.CONTEXT_PROJECTION_FAILED;
  }
  if (stage === 'RUNNER_EXECUTION') return DEVELOPER_AGENT_ERROR_CODES.RUN_FAILED;
  if (stage === 'RESPONSE_VALIDATION' || stage === 'BUSINESS_VALIDATION') {
    return DEVELOPER_AGENT_ERROR_CODES.VALIDATION_FAILED;
  }
  if (stage === 'ARTIFACT_GENERATION') {
    return DEVELOPER_AGENT_ERROR_CODES.ARTIFACT_GENERATION_FAILED;
  }
  return DEVELOPER_AGENT_ERROR_CODES.INTERNAL_ERROR;
}

function translateError(
  error: unknown,
  stage: DeveloperAgentStage,
  durationMs: number,
  request?: DeveloperAgentRequest,
  rawRequest?: unknown,
): DeveloperAgentError {
  if (error instanceof DeveloperAgentError) {
    if (error.durationMs === durationMs) return error;
    return developerError(error.message, {
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

  return developerError('O Developer Agent não concluiu a execução.', {
    code: errorCodeForStage(stage, error),
    stage,
    durationMs,
    ...(request === undefined ? {} : { request }),
    ...(rawRequest === undefined ? {} : { rawRequest }),
    ...(sourceCode === undefined ? {} : { sourceCode }),
    cause: error,
  });
}

function readTechnicalSpecification(
  validation: { readonly validatedOutput: unknown },
  request: DeveloperAgentRequest,
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
    throw developerError('A saída validada é incompatível com o contrato do Developer Agent.', {
      code: DEVELOPER_AGENT_ERROR_CODES.VALIDATED_OUTPUT_INCOMPATIBLE,
      stage: 'BUSINESS_VALIDATION',
      durationMs,
      request,
    });
  }

  return technicalSpecificationStructureSchema.safeParse(validatedOutput.data);
}

function completeLogContext(
  request: DeveloperAgentRequest,
  assets: Parameters<typeof requestLogContext>[1],
  durationMs: number,
  result: DeveloperAgentResult,
) {
  return {
    ...requestLogContext(request, assets),
    outcome: result.outcome,
    readiness: result.readiness,
    durationMs,
  };
}

export function createDeveloperAgent(options: CreateDeveloperAgentOptions): DeveloperAgent {
  assertDependencies(options);
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());
  let assets: CreateDeveloperAgentOptions['promptAssets'];

  try {
    assets = validateDeveloperPromptAssets(options.promptAssets);
  } catch (error) {
    const sourceCode =
      error instanceof DeveloperPromptAssetsError ? error.code : safeSourceCode(error);
    throw developerError('Assets do Developer Agent inválidos.', {
      code: DEVELOPER_AGENT_ERROR_CODES.INVALID_PROMPT_ASSETS,
      stage: 'ASSET_VALIDATION',
      durationMs: 0,
      ...(sourceCode === undefined ? {} : { sourceCode }),
      cause: error,
    });
  }

  return Object.freeze({
    async execute(
      rawRequest: DeveloperAgentRequest,
      runOptions: DeveloperAgentRunOptions = {},
    ): Promise<DeveloperAgentResult> {
      const startedAt = now();
      let stage: DeveloperAgentStage = 'REQUEST_VALIDATION';
      let request: DeveloperAgentRequest | undefined;

      try {
        const requestResult = developerAgentRequestSchema.safeParse(rawRequest);
        if (!requestResult.success) {
          throw developerError('Solicitação do Developer Agent inválida.', {
            code: DEVELOPER_AGENT_ERROR_CODES.INVALID_REQUEST,
            stage,
            durationMs: elapsed(now, startedAt),
            rawRequest,
            cause: requestResult.error,
          });
        }

        request = deepFreeze(requestResult.data as DeveloperAgentRequest);
        logger.info('developer.agent.started', requestLogContext(request, assets));
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'KNOWLEDGE_LOADING';
        const knowledge = await options.knowledgeLoader.load({
          context: 'DEVELOPER',
          ...(request.limits?.knowledgeMaxDocuments === undefined
            ? {}
            : { maxDocuments: request.limits.knowledgeMaxDocuments }),
          ...(request.limits?.knowledgeMaxBytes === undefined
            ? {}
            : { maxBytes: request.limits.knowledgeMaxBytes }),
        });
        logger.info('developer.knowledge.loaded', {
          ...requestLogContext(request, assets),
          ...knowledgeLogContext(knowledge),
        });
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'CONTEXT_PROJECTION';
        const promptContexts = projectDeveloperPromptContexts(knowledge, request, assets.manifest);
        const runRequest = createDeveloperAgentRunRequest(request, promptContexts, assets);

        stage = 'RUNNER_EXECUTION';
        const run = await options.agentRunner.run(runRequest, {
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
        });
        logger.info('developer.run.completed', {
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
          logger.warn('developer.validation.rejected', {
            ...requestLogContext(request, assets),
            rejectedAt: 'RESPONSE_VALIDATION',
            ...responseValidationLogContext(responseValidation),
          });
          logger.info(
            'developer.agent.completed',
            completeLogContext(request, assets, elapsed(now, startedAt), result),
          );
          return result;
        }

        stage = 'BUSINESS_VALIDATION';
        const specificationResult = readTechnicalSpecification(
          responseValidation,
          request,
          elapsed(now, startedAt),
        );
        let businessValidation: DeveloperBusinessValidationResult;
        let technicalSpecification: TechnicalSpecification | undefined;

        if (!specificationResult.success) {
          businessValidation = createDeveloperBusinessStructureRejection(
            specificationResult.error.issues,
          );
        } else {
          technicalSpecification = deepFreeze(specificationResult.data) as TechnicalSpecification;
          businessValidation = validateDeveloperBusinessRules(
            technicalSpecification,
            request.productOwnerSpecification,
          );
        }

        if (!businessValidation.valid || technicalSpecification === undefined) {
          const result = createBusinessRejectedResult(resultContext, businessValidation);
          logger.warn('developer.validation.rejected', {
            ...requestLogContext(request, assets),
            rejectedAt: 'BUSINESS_VALIDATION',
            ...responseValidationLogContext(responseValidation),
            ...businessValidationLogContext(businessValidation),
          });
          logger.info(
            'developer.agent.completed',
            completeLogContext(request, assets, elapsed(now, startedAt), result),
          );
          return result;
        }

        logger.info('developer.validation.accepted', {
          ...requestLogContext(request, assets),
          ...responseValidationLogContext(responseValidation),
          ...businessValidationLogContext(businessValidation),
        });
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'ARTIFACT_GENERATION';
        const generation = options.artifactGenerator.generate({
          validation: responseValidation,
          specification: assets.artifactSpecification,
        });
        logger.info('developer.artifacts.generated', {
          ...requestLogContext(request, assets),
          ...generationLogContext(generation),
        });

        stage = 'FINALIZATION';
        const result = createGeneratedResult(
          resultContext,
          technicalSpecification,
          businessValidation,
          generation,
        );
        logger.info(
          'developer.agent.completed',
          completeLogContext(request, assets, elapsed(now, startedAt), result),
        );
        return result;
      } catch (error) {
        const developerAgentError = translateError(
          error,
          stage,
          elapsed(now, startedAt),
          request,
          rawRequest,
        );
        logger.error('developer.agent.failed', errorLogContext(developerAgentError));
        throw developerAgentError;
      }
    },
  });
}
