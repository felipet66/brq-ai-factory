import { AGENT_RUN_ERROR_CODES, AgentRunError } from '@brq/agent-runner';
import { createLogger } from '@brq/shared/logger/logger';

import { assembleGeneratedCodeBundle } from './bundle-assembler';
import {
  createCodeGeneratorBusinessStructureRejection,
  inspectCodeGeneratorPath,
  validateCodeGenerationBusinessRules,
} from './business-validation';
import type {
  CodeGenerationRequest,
  CodeGeneratorAgent,
  CodeGeneratorAgentResult,
  CodeGeneratorAgentRunOptions,
  CodeGeneratorBusinessValidationResult,
  CreateCodeGeneratorAgentOptions,
  GeneratedCodeProposal,
} from './contracts';
import {
  CODE_GENERATOR_AGENT_ERROR_CODES,
  CODE_GENERATOR_SOURCE_REASON_CODES,
  CodeGeneratorAgentError,
  sanitizeCodeGeneratorSourceCode,
  type CodeGeneratorAgentErrorCode,
  type CodeGeneratorAgentStage,
  type CodeGeneratorSourceReasonCode,
} from './errors';
import { calculateTechnicalSpecificationHash } from './hashing';
import { deepFreeze } from './immutability';
import { projectCodeGeneratorPromptContexts } from './knowledge-projection';
import { CODE_GENERATOR_CONTRACT_LIMITS } from './limits';
import {
  businessValidationLogContext,
  bundleLogContext,
  errorLogContext,
  knowledgeLogContext,
  requestLogContext,
  responseValidationLogContext,
  runLogContext,
} from './logging';
import { CodeGeneratorPromptAssetsError, validateCodeGeneratorPromptAssets } from './prompt-assets';
import { createCodeGeneratorAgentRunRequest } from './prompt-request';
import {
  createBusinessRejectedResult,
  createGeneratedResult,
  createResponseRejectedResult,
} from './result';
import {
  codeGenerationRequestSchema,
  codeGeneratorAgentContextSchema,
  generatedCodeProposalSchema,
} from './schemas';

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function safeSourceCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  if (error instanceof AgentRunError && error.sourceCode === 'AI_PROVIDER_CACHE_MISS') {
    return sanitizeCodeGeneratorSourceCode(error.sourceCode);
  }
  return sanitizeCodeGeneratorSourceCode(error.code);
}

function requestIdentity(rawRequest: unknown): Partial<CodeGenerationRequest['context']> {
  if (typeof rawRequest !== 'object' || rawRequest === null || !('context' in rawRequest)) {
    return {};
  }
  const context = codeGeneratorAgentContextSchema.safeParse(rawRequest.context);
  return context.success ? context.data : {};
}

function codeGeneratorError(
  message: string,
  options: {
    readonly code: CodeGeneratorAgentErrorCode;
    readonly stage: CodeGeneratorAgentStage;
    readonly durationMs: number;
    readonly request?: CodeGenerationRequest;
    readonly rawRequest?: unknown;
    readonly sourceCode?: string;
    readonly reasonCode?: CodeGeneratorSourceReasonCode;
    readonly cause?: unknown;
  },
): CodeGeneratorAgentError {
  const identity =
    options.request?.context ??
    (options.rawRequest === undefined ? {} : requestIdentity(options.rawRequest));
  return new CodeGeneratorAgentError(message, {
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
    ...(options.reasonCode === undefined ? {} : { reasonCode: options.reasonCode }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
}

function assertDependencies(options: CreateCodeGeneratorAgentOptions): void {
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
    (options.now !== undefined && typeof options.now !== 'function') ||
    !validLogger
  ) {
    throw codeGeneratorError('Configuração do Code Generator inválida.', {
      code: CODE_GENERATOR_AGENT_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST_VALIDATION',
      durationMs: 0,
    });
  }
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  stage: CodeGeneratorAgentStage,
  request: CodeGenerationRequest,
  durationMs: number,
): void {
  if (!signal?.aborted) return;
  throw codeGeneratorError('A execução do Code Generator foi cancelada.', {
    code: CODE_GENERATOR_AGENT_ERROR_CODES.CANCELLED,
    stage,
    durationMs,
    request,
  });
}

function assertEligibleSource(request: CodeGenerationRequest, durationMs: number): void {
  const calculatedHash = calculateTechnicalSpecificationHash(request.technicalSpecification);
  const portableModulePaths = new Set<string>();
  let unsupportedModulePath = false;
  let collidingModulePath = false;
  request.technicalSpecification.modules.forEach((module) => {
    const inspection = inspectCodeGeneratorPath(module.path);
    const collides = portableModulePaths.has(inspection.portableKey);
    portableModulePaths.add(inspection.portableKey);
    unsupportedModulePath ||= inspection.reason !== null || inspection.limitExceeded;
    collidingModulePath ||= collides;
  });

  const reject = (reasonCode: CodeGeneratorSourceReasonCode): never => {
    throw codeGeneratorError('A TechnicalSpecification não está elegível para geração.', {
      code: CODE_GENERATOR_AGENT_ERROR_CODES.SOURCE_NOT_APPROVED,
      stage: 'SOURCE_VALIDATION',
      durationMs,
      request,
      reasonCode,
    });
  };

  if (request.context.executionId !== request.approval.executionId) {
    reject(CODE_GENERATOR_SOURCE_REASON_CODES.EXECUTION_MISMATCH);
  }
  if (request.technicalSpecification.readiness !== 'READY') {
    reject(CODE_GENERATOR_SOURCE_REASON_CODES.READINESS_NOT_READY);
  }
  if (calculatedHash !== request.declaredTechnicalSpecificationHash) {
    reject(CODE_GENERATOR_SOURCE_REASON_CODES.HASH_MISMATCH);
  }
  if (
    request.technicalSpecification.components.some((item) => item.changeType !== 'CREATE') ||
    request.technicalSpecification.modules.some((item) => item.changeType !== 'CREATE')
  ) {
    reject(CODE_GENERATOR_SOURCE_REASON_CODES.CHANGE_TYPE_NOT_CREATE);
  }
  if (unsupportedModulePath) {
    reject(CODE_GENERATOR_SOURCE_REASON_CODES.MODULE_PATH_UNSUPPORTED);
  }
  if (collidingModulePath) {
    reject(CODE_GENERATOR_SOURCE_REASON_CODES.MODULE_PATH_COLLISION);
  }
}

function errorCodeForStage(
  stage: CodeGeneratorAgentStage,
  error: unknown,
): CodeGeneratorAgentErrorCode {
  if (error instanceof AgentRunError) {
    if (error.code === AGENT_RUN_ERROR_CODES.CANCELLED) {
      return CODE_GENERATOR_AGENT_ERROR_CODES.CANCELLED;
    }
    if (error.code === AGENT_RUN_ERROR_CODES.TIMEOUT) {
      return CODE_GENERATOR_AGENT_ERROR_CODES.TIMEOUT;
    }
  }
  if (stage === 'SOURCE_VALIDATION') return CODE_GENERATOR_AGENT_ERROR_CODES.SOURCE_NOT_APPROVED;
  if (stage === 'KNOWLEDGE_LOADING') {
    return CODE_GENERATOR_AGENT_ERROR_CODES.KNOWLEDGE_LOAD_FAILED;
  }
  if (stage === 'CONTEXT_PROJECTION') {
    return CODE_GENERATOR_AGENT_ERROR_CODES.CONTEXT_PROJECTION_FAILED;
  }
  if (stage === 'RUNNER_EXECUTION') return CODE_GENERATOR_AGENT_ERROR_CODES.RUN_FAILED;
  if (stage === 'RESPONSE_VALIDATION' || stage === 'BUSINESS_VALIDATION') {
    return CODE_GENERATOR_AGENT_ERROR_CODES.VALIDATION_FAILED;
  }
  if (stage === 'BUNDLE_ASSEMBLY') {
    return CODE_GENERATOR_AGENT_ERROR_CODES.BUNDLE_ASSEMBLY_FAILED;
  }
  return CODE_GENERATOR_AGENT_ERROR_CODES.INTERNAL_ERROR;
}

function translateError(
  error: unknown,
  stage: CodeGeneratorAgentStage,
  durationMs: number,
  request?: CodeGenerationRequest,
  rawRequest?: unknown,
): CodeGeneratorAgentError {
  if (error instanceof CodeGeneratorAgentError) {
    if (error.durationMs === durationMs) return error;
    return codeGeneratorError(error.message, {
      code: error.code,
      stage: error.stage,
      durationMs,
      ...(request === undefined ? {} : { request }),
      ...(rawRequest === undefined ? {} : { rawRequest }),
      ...(error.sourceCode === undefined ? {} : { sourceCode: error.sourceCode }),
      ...(error.reasonCode === undefined ? {} : { reasonCode: error.reasonCode }),
      cause: error.cause ?? error,
    });
  }
  const sourceCode = safeSourceCode(error);
  return codeGeneratorError('O Code Generator não concluiu a execução.', {
    code: errorCodeForStage(stage, error),
    stage,
    durationMs,
    ...(request === undefined ? {} : { request }),
    ...(rawRequest === undefined ? {} : { rawRequest }),
    ...(sourceCode === undefined ? {} : { sourceCode }),
    cause: error,
  });
}

function readProposal(
  validation: { readonly validatedOutput: unknown },
  request: CodeGenerationRequest,
  durationMs: number,
) {
  const output = validation.validatedOutput;
  if (
    typeof output !== 'object' ||
    output === null ||
    !('format' in output) ||
    output.format !== 'JSON_SCHEMA' ||
    !('data' in output)
  ) {
    throw codeGeneratorError('A saída validada é incompatível com o Code Generator.', {
      code: CODE_GENERATOR_AGENT_ERROR_CODES.VALIDATED_OUTPUT_INCOMPATIBLE,
      stage: 'BUSINESS_VALIDATION',
      durationMs,
      request,
    });
  }
  return generatedCodeProposalSchema.safeParse(output.data);
}

function completeLogContext(
  request: CodeGenerationRequest,
  assets: Parameters<typeof requestLogContext>[1],
  durationMs: number,
  result: CodeGeneratorAgentResult,
) {
  return {
    ...requestLogContext(request, assets),
    outcome: result.outcome,
    durationMs,
  };
}

export function createCodeGeneratorAgent(
  options: CreateCodeGeneratorAgentOptions,
): CodeGeneratorAgent {
  assertDependencies(options);
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());
  let assets: CreateCodeGeneratorAgentOptions['promptAssets'];

  try {
    assets = validateCodeGeneratorPromptAssets(options.promptAssets);
  } catch (error) {
    const sourceCode =
      error instanceof CodeGeneratorPromptAssetsError ? error.code : safeSourceCode(error);
    throw codeGeneratorError('Assets do Code Generator inválidos.', {
      code: CODE_GENERATOR_AGENT_ERROR_CODES.INVALID_PROMPT_ASSETS,
      stage: 'ASSET_VALIDATION',
      durationMs: 0,
      ...(sourceCode === undefined ? {} : { sourceCode }),
      cause: error,
    });
  }

  return Object.freeze({
    async execute(
      rawRequest: CodeGenerationRequest,
      runOptions: CodeGeneratorAgentRunOptions = {},
    ): Promise<CodeGeneratorAgentResult> {
      const startedAt = now();
      let stage: CodeGeneratorAgentStage = 'REQUEST_VALIDATION';
      let request: CodeGenerationRequest | undefined;

      try {
        const requestResult = codeGenerationRequestSchema.safeParse(rawRequest);
        if (!requestResult.success) {
          throw codeGeneratorError('Solicitação do Code Generator inválida.', {
            code: CODE_GENERATOR_AGENT_ERROR_CODES.INVALID_REQUEST,
            stage,
            durationMs: elapsed(now, startedAt),
            rawRequest,
            cause: requestResult.error,
          });
        }
        request = deepFreeze(requestResult.data as CodeGenerationRequest);
        logger.info('code-generator.agent.started', requestLogContext(request, assets));
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'SOURCE_VALIDATION';
        assertEligibleSource(request, elapsed(now, startedAt));
        logger.info('code-generator.source.validated', requestLogContext(request, assets));
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'KNOWLEDGE_LOADING';
        const limits = CODE_GENERATOR_CONTRACT_LIMITS.request;
        const knowledge = await options.knowledgeLoader.load({
          context: 'CODE_GENERATOR',
          maxDocuments: request.limits?.knowledgeMaxDocuments ?? limits.knowledgeDocuments,
          maxBytes: request.limits?.knowledgeMaxBytes ?? limits.knowledgeBytes,
        });
        logger.info('code-generator.knowledge.loaded', {
          ...requestLogContext(request, assets),
          ...knowledgeLogContext(knowledge),
        });
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'CONTEXT_PROJECTION';
        const contexts = projectCodeGeneratorPromptContexts(knowledge, request, assets.manifest);
        const runRequest = createCodeGeneratorAgentRunRequest(request, contexts, assets);

        stage = 'RUNNER_EXECUTION';
        const run = await options.agentRunner.run(runRequest, {
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
          ...(runOptions.cacheMode === undefined ? {} : { cacheMode: runOptions.cacheMode }),
          ...(runOptions.sourceExecutionId === undefined
            ? {}
            : { sourceExecutionId: runOptions.sourceExecutionId }),
        });
        logger.info('code-generator.run.completed', {
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
          logger.warn('code-generator.validation.rejected', {
            ...requestLogContext(request, assets),
            rejectedAt: 'RESPONSE_VALIDATION',
            ...responseValidationLogContext(responseValidation),
          });
          logger.info(
            'code-generator.agent.completed',
            completeLogContext(request, assets, elapsed(now, startedAt), result),
          );
          return result;
        }

        stage = 'BUSINESS_VALIDATION';
        const proposalResult = readProposal(responseValidation, request, elapsed(now, startedAt));
        let businessValidation: CodeGeneratorBusinessValidationResult;
        let proposal: GeneratedCodeProposal | undefined;
        if (!proposalResult.success) {
          businessValidation = createCodeGeneratorBusinessStructureRejection(
            proposalResult.error.issues,
          );
        } else {
          proposal = deepFreeze(proposalResult.data) as GeneratedCodeProposal;
          businessValidation = validateCodeGenerationBusinessRules(
            proposal,
            request.technicalSpecification,
          );
        }
        if (!businessValidation.valid || proposal === undefined) {
          const result = createBusinessRejectedResult(resultContext, businessValidation);
          logger.warn('code-generator.validation.rejected', {
            ...requestLogContext(request, assets),
            rejectedAt: 'BUSINESS_VALIDATION',
            ...responseValidationLogContext(responseValidation),
            ...businessValidationLogContext(businessValidation),
          });
          logger.info(
            'code-generator.agent.completed',
            completeLogContext(request, assets, elapsed(now, startedAt), result),
          );
          return result;
        }
        logger.info('code-generator.validation.accepted', {
          ...requestLogContext(request, assets),
          ...responseValidationLogContext(responseValidation),
          ...businessValidationLogContext(businessValidation),
        });
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'BUNDLE_ASSEMBLY';
        const bundle = assembleGeneratedCodeBundle({
          request,
          proposal,
          assets,
          knowledge,
          run,
          responseValidation,
        });
        logger.info('code-generator.bundle.generated', {
          ...requestLogContext(request, assets),
          ...bundleLogContext(bundle),
        });
        assertNotAborted(runOptions.signal, stage, request, elapsed(now, startedAt));

        stage = 'FINALIZATION';
        const result = createGeneratedResult(resultContext, businessValidation, bundle);
        logger.info(
          'code-generator.agent.completed',
          completeLogContext(request, assets, elapsed(now, startedAt), result),
        );
        return result;
      } catch (error) {
        const agentError = translateError(
          error,
          stage,
          elapsed(now, startedAt),
          request,
          rawRequest,
        );
        logger.error('code-generator.agent.failed', errorLogContext(agentError));
        throw agentError;
      }
    },
  });
}
