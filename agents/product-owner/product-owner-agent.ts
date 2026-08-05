import { AGENT_RUN_ERROR_CODES, AgentRunError } from '@brq/agent-runner';
import { createLogger } from '@brq/shared/logger/logger';

import {
  createProductOwnerBusinessStructureRejection,
  validateProductOwnerBusinessRules,
} from './business-validation';
import type {
  CreateProductOwnerAgentOptions,
  ProductOwnerAgent,
  ProductOwnerAgentRequest,
  ProductOwnerAgentResult,
  ProductOwnerAgentRunOptions,
  ProductOwnerBusinessValidationResult,
  ProductOwnerSpecification,
} from './contracts';
import {
  PRODUCT_OWNER_AGENT_ERROR_CODES,
  ProductOwnerAgentError,
  sanitizeProductOwnerSourceCode,
  type ProductOwnerAgentErrorCode,
  type ProductOwnerAgentStage,
} from './errors';
import { deepFreeze } from './immutability';
import { projectProductOwnerPromptContexts } from './knowledge-projection';
import {
  businessValidationLogContext,
  errorLogContext,
  generationLogContext,
  knowledgeLogContext,
  requestLogContext,
  responseValidationLogContext,
  runLogContext,
} from './logging';
import { ProductOwnerPromptAssetsError, validateProductOwnerPromptAssets } from './prompt-assets';
import { createProductOwnerAgentRunRequest } from './prompt-request';
import {
  createBusinessRejectedResult,
  createGeneratedResult,
  createResponseRejectedResult,
} from './result';
import {
  productOwnerAgentRequestSchema,
  productOwnerAgentContextSchema,
  productOwnerSpecificationStructureSchema,
} from './schemas';

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function safeSourceCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return sanitizeProductOwnerSourceCode(error.code);
}

function requestIdentity(rawRequest: unknown): Partial<ProductOwnerAgentRequest['context']> {
  if (typeof rawRequest !== 'object' || rawRequest === null || !('context' in rawRequest))
    return {};
  const context = productOwnerAgentContextSchema.safeParse(rawRequest.context);
  return context.success ? context.data : {};
}

function productOwnerError(
  message: string,
  options: {
    readonly code: ProductOwnerAgentErrorCode;
    readonly stage: ProductOwnerAgentStage;
    readonly durationMs: number;
    readonly request?: ProductOwnerAgentRequest;
    readonly rawRequest?: unknown;
    readonly cause?: unknown;
    readonly sourceCode?: string;
  },
): ProductOwnerAgentError {
  const identity =
    options.request?.context ??
    (options.rawRequest === undefined ? {} : requestIdentity(options.rawRequest));

  return new ProductOwnerAgentError(message, {
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

function assertDependencies(options: CreateProductOwnerAgentOptions): void {
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
    throw productOwnerError('Configuração do Product Owner Agent inválida.', {
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST_VALIDATION',
      durationMs: 0,
    });
  }
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  stage: ProductOwnerAgentStage,
  request: ProductOwnerAgentRequest,
  durationMs: number,
): void {
  if (!signal?.aborted) return;

  throw productOwnerError('A execução do Product Owner Agent foi cancelada.', {
    code: PRODUCT_OWNER_AGENT_ERROR_CODES.CANCELLED,
    stage,
    durationMs,
    request,
  });
}

function errorCodeForStage(
  stage: ProductOwnerAgentStage,
  error: unknown,
): ProductOwnerAgentErrorCode {
  if (error instanceof AgentRunError) {
    if (error.code === AGENT_RUN_ERROR_CODES.CANCELLED) {
      return PRODUCT_OWNER_AGENT_ERROR_CODES.CANCELLED;
    }
    if (error.code === AGENT_RUN_ERROR_CODES.TIMEOUT) {
      return PRODUCT_OWNER_AGENT_ERROR_CODES.TIMEOUT;
    }
  }

  if (stage === 'KNOWLEDGE_LOADING') return PRODUCT_OWNER_AGENT_ERROR_CODES.KNOWLEDGE_LOAD_FAILED;
  if (stage === 'CONTEXT_PROJECTION') {
    return PRODUCT_OWNER_AGENT_ERROR_CODES.CONTEXT_PROJECTION_FAILED;
  }
  if (stage === 'RUNNER_EXECUTION') return PRODUCT_OWNER_AGENT_ERROR_CODES.RUN_FAILED;
  if (stage === 'RESPONSE_VALIDATION' || stage === 'BUSINESS_VALIDATION') {
    return PRODUCT_OWNER_AGENT_ERROR_CODES.VALIDATION_FAILED;
  }
  if (stage === 'ARTIFACT_GENERATION') {
    return PRODUCT_OWNER_AGENT_ERROR_CODES.ARTIFACT_GENERATION_FAILED;
  }
  return PRODUCT_OWNER_AGENT_ERROR_CODES.INTERNAL_ERROR;
}

function translateError(
  error: unknown,
  stage: ProductOwnerAgentStage,
  durationMs: number,
  request?: ProductOwnerAgentRequest,
  rawRequest?: unknown,
): ProductOwnerAgentError {
  if (error instanceof ProductOwnerAgentError) {
    if (error.durationMs === durationMs) return error;
    return productOwnerError(error.message, {
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

  return productOwnerError('O Product Owner Agent não concluiu a execução.', {
    code: errorCodeForStage(stage, error),
    stage,
    durationMs,
    ...(request === undefined ? {} : { request }),
    ...(rawRequest === undefined ? {} : { rawRequest }),
    ...(sourceCode === undefined ? {} : { sourceCode }),
    cause: error,
  });
}

function readSpecification(
  validation: { readonly validatedOutput: unknown },
  request: ProductOwnerAgentRequest,
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
    throw productOwnerError('A saída validada é incompatível com o contrato do Product Owner.', {
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.VALIDATED_OUTPUT_INCOMPATIBLE,
      stage: 'BUSINESS_VALIDATION',
      durationMs,
      request,
    });
  }

  return productOwnerSpecificationStructureSchema.safeParse(validatedOutput.data);
}

function completeLogContext(
  request: ProductOwnerAgentRequest,
  assets: Parameters<typeof requestLogContext>[1],
  durationMs: number,
  result: ProductOwnerAgentResult,
) {
  return {
    ...requestLogContext(request, assets),
    outcome: result.outcome,
    readiness: result.readiness,
    durationMs,
  };
}

export function createProductOwnerAgent(
  options: CreateProductOwnerAgentOptions,
): ProductOwnerAgent {
  assertDependencies(options);
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());
  let assets: CreateProductOwnerAgentOptions['promptAssets'];

  try {
    assets = validateProductOwnerPromptAssets(options.promptAssets);
  } catch (error) {
    const sourceCode =
      error instanceof ProductOwnerPromptAssetsError ? error.code : safeSourceCode(error);
    throw productOwnerError('Assets do Product Owner Agent inválidos.', {
      code: PRODUCT_OWNER_AGENT_ERROR_CODES.INVALID_PROMPT_ASSETS,
      stage: 'ASSET_VALIDATION',
      durationMs: 0,
      ...(sourceCode === undefined ? {} : { sourceCode }),
      cause: error,
    });
  }

  return Object.freeze({
    async execute(
      rawRequest: ProductOwnerAgentRequest,
      runOptions: ProductOwnerAgentRunOptions = {},
    ): Promise<ProductOwnerAgentResult> {
      const startedAt = now();
      let stage: ProductOwnerAgentStage = 'REQUEST_VALIDATION';
      let request: ProductOwnerAgentRequest | undefined;

      try {
        const requestResult = productOwnerAgentRequestSchema.safeParse(rawRequest);
        if (!requestResult.success) {
          throw productOwnerError('Solicitação do Product Owner Agent inválida.', {
            code: PRODUCT_OWNER_AGENT_ERROR_CODES.INVALID_REQUEST,
            stage,
            durationMs: elapsed(now, startedAt),
            rawRequest,
            cause: requestResult.error,
          });
        }

        request = deepFreeze(requestResult.data as ProductOwnerAgentRequest);
        logger.info('product_owner.agent.started', requestLogContext(request, assets));
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'KNOWLEDGE_LOADING';
        const knowledge = await options.knowledgeLoader.load({
          context: 'PRODUCT_OWNER',
          ...(request.limits?.knowledgeMaxDocuments === undefined
            ? {}
            : { maxDocuments: request.limits.knowledgeMaxDocuments }),
          ...(request.limits?.knowledgeMaxBytes === undefined
            ? {}
            : { maxBytes: request.limits.knowledgeMaxBytes }),
        });
        logger.info('product_owner.knowledge.loaded', {
          ...requestLogContext(request, assets),
          ...knowledgeLogContext(knowledge),
        });
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'CONTEXT_PROJECTION';
        const promptContexts = projectProductOwnerPromptContexts(
          knowledge,
          request,
          assets.manifest,
        );
        const runRequest = createProductOwnerAgentRunRequest(request, promptContexts, assets);

        stage = 'RUNNER_EXECUTION';
        const run = await options.agentRunner.run(runRequest, {
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
        });
        logger.info('product_owner.run.completed', {
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
          logger.warn('product_owner.validation.rejected', {
            ...requestLogContext(request, assets),
            rejectedAt: 'RESPONSE_VALIDATION',
            ...responseValidationLogContext(responseValidation),
          });
          logger.info(
            'product_owner.agent.completed',
            completeLogContext(request, assets, elapsed(now, startedAt), result),
          );
          return result;
        }

        stage = 'BUSINESS_VALIDATION';
        const specificationResult = readSpecification(
          responseValidation,
          request,
          elapsed(now, startedAt),
        );
        let businessValidation: ProductOwnerBusinessValidationResult;
        let specification: ProductOwnerSpecification | undefined;

        if (!specificationResult.success) {
          businessValidation = createProductOwnerBusinessStructureRejection(
            specificationResult.error.issues,
          );
        } else {
          specification = deepFreeze(specificationResult.data) as ProductOwnerSpecification;
          businessValidation = validateProductOwnerBusinessRules(specification);
        }

        if (!businessValidation.valid || specification === undefined) {
          const result = createBusinessRejectedResult(resultContext, businessValidation);
          logger.warn('product_owner.validation.rejected', {
            ...requestLogContext(request, assets),
            rejectedAt: 'BUSINESS_VALIDATION',
            ...responseValidationLogContext(responseValidation),
            ...businessValidationLogContext(businessValidation),
          });
          logger.info(
            'product_owner.agent.completed',
            completeLogContext(request, assets, elapsed(now, startedAt), result),
          );
          return result;
        }

        logger.info('product_owner.validation.accepted', {
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
        logger.info('product_owner.artifacts.generated', {
          ...requestLogContext(request, assets),
          ...generationLogContext(generation),
        });

        stage = 'FINALIZATION';
        const result = createGeneratedResult(
          resultContext,
          specification,
          businessValidation,
          generation,
        );
        logger.info(
          'product_owner.agent.completed',
          completeLogContext(request, assets, elapsed(now, startedAt), result),
        );
        return result;
      } catch (error) {
        const productOwnerAgentError = translateError(
          error,
          stage,
          elapsed(now, startedAt),
          request,
          rawRequest,
        );
        logger.error('product_owner.agent.failed', errorLogContext(productOwnerAgentError));
        throw productOwnerAgentError;
      }
    },
  });
}
