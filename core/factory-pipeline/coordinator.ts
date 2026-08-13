import {
  CodeGeneratorAgentError,
  sanitizeCodeGeneratorSourceReasonCode,
  type CodeGeneratorAgentResult,
} from '@brq/code-generator-agent';
import {
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
  type WorkspaceMaterializationResult,
  type WorkspacePlan,
} from '@brq/controlled-workspace';
import {
  assertFactoryExecutionProfilePreflight,
  createFactoryExecutionProfileValidator,
  type FactoryExecutionProfileValidation,
} from '@brq/factory-execution-profile';
import {
  deriveExecutionIdentity,
  executionRequestSchema,
  executionResultSchema,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';
import type { SandboxRunResult } from '@brq/sandbox-runner';
import { createLogger } from '@brq/shared/logger/logger';

import type {
  CreateFactoryPipelineCoordinatorOptions,
  FactoryExecutionResult,
  FactoryPipelineCoordinator,
  FactoryPipelineFailure,
  FactoryPipelinePreflightOptions,
  FactoryPipelineRunOptions,
  FactoryPipelineStatus,
  FactoryPipelineStageResult,
} from './contracts';
import { FACTORY_PIPELINE_ERROR_CODES, FactoryPipelineError } from './errors';
import { immutableClone } from './immutability';
import { factoryPipelineLogContext, logFactoryPipelineEvent } from './logging';
import {
  parseCodeGeneratorBoundary,
  parseSandboxBoundary,
  parseWorkspaceMaterializationBoundary,
  parseWorkspacePlanBoundary,
  parseWorkspaceReleaseBoundary,
  projectAgentStages,
  projectExecutionToCodeGenerationRequest,
  projectFactoryAgentsSummary,
  projectFactoryGenerationSummary,
  projectFactoryPipelineProvenance,
  projectFactorySandboxSummary,
  projectFactorySandboxSummaryWithUnconfirmedTermination,
  projectFactorySourceExecutionSummary,
  projectFactoryWorkspaceSummary,
  projectGeneratedBundleToWorkspacePlanRequest,
  projectWorkspaceToSandboxRunRequest,
} from './projections';
import { createFactoryExecutionResult } from './result';
import { sanitizeFactoryProfileRuleId, sanitizeTechnicalCode } from './sanitization';
import { factoryPipelineConfigurationSchema } from './schemas';
import { createFactoryStageLedger } from './stage-ledger';
import type { FactoryPipelineStageId } from './state-machine';
import { createFactoryTechnicalCheckpoint } from './technical-checkpoint';
import { createFactoryTechnicalResumeExecutor } from './technical-resume';

interface PrimaryOutcome {
  readonly status: Exclude<FactoryPipelineStatus, 'SUCCESS'>;
  readonly terminalStage: FactoryExecutionResult['terminalStage'];
  readonly failure: FactoryPipelineFailure;
}

function validLogger(value: unknown): boolean {
  return (
    value === undefined ||
    (value !== null &&
      typeof value === 'object' &&
      typeof (value as { debug?: unknown }).debug === 'function' &&
      typeof (value as { info?: unknown }).info === 'function' &&
      typeof (value as { warn?: unknown }).warn === 'function' &&
      typeof (value as { error?: unknown }).error === 'function')
  );
}

function assertDependencies(options: CreateFactoryPipelineCoordinatorOptions): void {
  const valid =
    typeof options.executionEngine?.execute === 'function' &&
    typeof options.codeGeneratorAgent?.execute === 'function' &&
    typeof options.workspace?.plan === 'function' &&
    typeof options.workspace?.materialize === 'function' &&
    typeof options.workspace?.release === 'function' &&
    typeof options.sandboxRunner?.run === 'function' &&
    validLogger(options.logger) &&
    (options.now === undefined || typeof options.now === 'function');
  if (!valid) {
    throw new FactoryPipelineError('Configuração do Factory Pipeline inválida.', {
      code: FACTORY_PIPELINE_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'EXECUTION',
    });
  }
}

function parseRequest(value: ExecutionRequest): ExecutionRequest {
  const parsed = executionRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new FactoryPipelineError('ExecutionRequest inválido.', {
      code: FACTORY_PIPELINE_ERROR_CODES.INVALID_REQUEST,
      stage: 'EXECUTION',
      cause: parsed.error,
    });
  }
  return immutableClone(parsed.data);
}

function sourceCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const candidate = error as { code?: unknown; sourceCode?: unknown };
  return sanitizeTechnicalCode(candidate.sourceCode) ?? sanitizeTechnicalCode(candidate.code);
}

function sourceReasonCode(error: unknown): string | null {
  if (error instanceof CodeGeneratorAgentError) return error.reasonCode ?? null;
  if (error instanceof FactoryPipelineError) {
    return sanitizeCodeGeneratorSourceReasonCode(error.reasonCode) ?? null;
  }
  return null;
}

function cancellationRequested(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  const code = sourceCode(error)?.toUpperCase() ?? '';
  return code.includes('CANCELLED') || code.includes('CANCELED');
}

function workspaceCleanupFailed(error: unknown): boolean {
  return (
    error instanceof ControlledWorkspaceError &&
    error.stage === CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP
  );
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  stage: FactoryExecutionResult['terminalStage'],
  executionId: string,
): void {
  if (!signal?.aborted) return;
  throw new FactoryPipelineError('A execução da Factory foi cancelada.', {
    code: FACTORY_PIPELINE_ERROR_CODES.CANCELLED,
    stage,
    executionId,
  });
}

function failureFor(
  stage: FactoryExecutionResult['terminalStage'],
  code: string,
  message: string,
  error?: unknown,
  reasonCode: string | null = null,
  profileRuleId: string | null = null,
): FactoryPipelineFailure {
  return {
    code,
    stage,
    sourceCode: sourceCode(error),
    reasonCode,
    profileRuleId: sanitizeFactoryProfileRuleId(profileRuleId),
    diagnosticSummary: null,
    message,
  };
}

function skippedStage(stageId: FactoryPipelineStageId): FactoryPipelineStageResult {
  return {
    stageId,
    status: 'SKIPPED',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    outputHash: null,
    profileRuleId: null,
    diagnosticSummary: null,
    failure: null,
  };
}

const SANDBOX_STAGE_BY_STEP = Object.freeze({
  PREPARE: 'SANDBOX_PREPARE',
  TYPECHECK: 'SANDBOX_TYPECHECK',
  BUILD: 'SANDBOX_BUILD',
  TEST: 'SANDBOX_TEST',
} as const);

function projectSandboxStage(step: SandboxRunResult['steps'][number]): FactoryPipelineStageResult {
  const stageId = SANDBOX_STAGE_BY_STEP[step.stepId];
  if (step.status === 'SKIPPED') return skippedStage(stageId);
  const status =
    step.status === 'SUCCESS' ? 'SUCCESS' : step.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
  const outputHash =
    status === 'SUCCESS'
      ? (step.stdout?.summaryHash ?? null)
      : step.stderr !== null && step.stderr.observedBytes > 0
        ? step.stderr.summaryHash
        : step.stdout !== null && step.stdout.observedBytes > 0
          ? step.stdout.summaryHash
          : (step.stderr?.summaryHash ?? step.stdout?.summaryHash ?? null);
  const diagnosticSummary = step.failure?.diagnosticSummary ?? null;
  return {
    stageId,
    status,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    durationMs: step.durationMs,
    outputHash,
    profileRuleId: null,
    diagnosticSummary,
    failure:
      status === 'SUCCESS'
        ? null
        : {
            code: step.failure?.code ?? FACTORY_PIPELINE_ERROR_CODES.SANDBOX_FAILED,
            stage: stageId,
            sourceCode: null,
            reasonCode: step.failure?.reasonCode ?? null,
            profileRuleId: null,
            diagnosticSummary,
            message:
              status === 'CANCELLED'
                ? 'A execução isolada foi cancelada.'
                : 'Uma etapa da execução isolada falhou.',
          },
  };
}

function primaryFromExecution(result: ExecutionResult): PrimaryOutcome | null {
  if (result.status === 'SUCCESS') return null;
  const stageByAgent = {
    PRODUCT_OWNER: 'PRODUCT_OWNER',
    DEVELOPER: 'DEVELOPER',
    QA: 'QA',
  } as const;
  const agent = result.workflowResult?.failure?.agent ?? null;
  const terminalStage = agent === null ? 'EXECUTION' : stageByAgent[agent];
  const cancelled = result.status === 'CANCELLED';
  return {
    status: cancelled ? 'CANCELLED' : 'FAILED',
    terminalStage,
    failure: {
      code: result.failure?.code ?? FACTORY_PIPELINE_ERROR_CODES.EXECUTION_FAILED,
      stage: terminalStage,
      sourceCode: sanitizeTechnicalCode(result.failure?.sourceCode),
      reasonCode: null,
      profileRuleId: null,
      diagnosticSummary: null,
      message: cancelled
        ? 'A execução funcional foi cancelada.'
        : 'A execução funcional não foi concluída.',
    },
  };
}

function primaryFromSandbox(result: SandboxRunResult): PrimaryOutcome | null {
  if (result.status === 'SUCCESS') return null;
  const interrupted = result.steps.find((step) =>
    ['FAILED', 'TIMEOUT', 'CANCELLED'].includes(step.status),
  );
  const terminalStage =
    result.failure?.stage === 'CLEANUP' || interrupted === undefined
      ? ('SANDBOX' as const)
      : SANDBOX_STAGE_BY_STEP[interrupted.stepId];
  const cancelled = result.status === 'CANCELLED';
  const diagnosticSummary =
    terminalStage === 'SANDBOX_TYPECHECK' &&
    interrupted?.stepId === 'TYPECHECK' &&
    interrupted.failure?.reasonCode === 'TYPESCRIPT_DIAGNOSTICS'
      ? interrupted.failure.diagnosticSummary
      : null;
  return {
    status: cancelled ? 'CANCELLED' : 'FAILED',
    terminalStage,
    failure: {
      code: result.failure?.code ?? FACTORY_PIPELINE_ERROR_CODES.SANDBOX_FAILED,
      stage: terminalStage,
      sourceCode: null,
      reasonCode:
        result.failure === null
          ? (interrupted?.failure?.reasonCode ?? null)
          : result.failure.reasonCode,
      profileRuleId: null,
      diagnosticSummary,
      message: cancelled
        ? 'A execução isolada foi cancelada.'
        : 'A execução isolada não concluiu todas as verificações.',
    },
  };
}

export function createFactoryPipelineCoordinator(
  options: CreateFactoryPipelineCoordinatorOptions,
): FactoryPipelineCoordinator {
  assertDependencies(options);
  const parsedConfiguration = factoryPipelineConfigurationSchema.safeParse(options.configuration);
  if (!parsedConfiguration.success) {
    throw new FactoryPipelineError('Configuração funcional do Factory Pipeline inválida.', {
      code: FACTORY_PIPELINE_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'EXECUTION',
      cause: parsedConfiguration.error,
    });
  }
  const configuration = immutableClone(parsedConfiguration.data);
  try {
    assertFactoryExecutionProfilePreflight({
      profile: configuration.executionProfile,
      sandboxPolicyId: configuration.sandbox.policyId,
      sandboxPolicyVersion: configuration.sandbox.policyVersion,
      sandboxProfileSnapshotHash: configuration.sandbox.profileSnapshotHash,
    });
  } catch (error) {
    throw new FactoryPipelineError('Preflight do Factory Execution Profile inválido.', {
      code: FACTORY_PIPELINE_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'EXECUTION',
      cause: error,
    });
  }
  const executionProfileValidator = createFactoryExecutionProfileValidator(
    configuration.executionProfile,
  );
  const logger = options.logger ?? createLogger();
  const observe = options.now ?? (() => performance.timeOrigin + performance.now());
  const technicalResumeExecutor =
    options.technicalBoundaryIdentity === undefined
      ? null
      : createFactoryTechnicalResumeExecutor({
          workspace: options.workspace,
          sandboxRunner: options.sandboxRunner,
          configuration,
          boundaryIdentity: options.technicalBoundaryIdentity,
          now: observe,
        });

  const runPreflight = async (
    preflightOptions: FactoryPipelinePreflightOptions = {},
  ): Promise<void> => {
    if (options.sandboxRunner.preflight === undefined) return;
    try {
      await options.sandboxRunner.preflight({
        policyId: configuration.sandbox.policyId,
        ...(preflightOptions.signal === undefined ? {} : { signal: preflightOptions.signal }),
      });
    } catch (error) {
      const observedSourceCode = sourceCode(error);
      throw new FactoryPipelineError('O runtime da sandbox não passou no preflight.', {
        code: cancellationRequested(error, preflightOptions.signal)
          ? FACTORY_PIPELINE_ERROR_CODES.CANCELLED
          : FACTORY_PIPELINE_ERROR_CODES.SANDBOX_FAILED,
        stage: 'SANDBOX_PREPARE',
        ...(observedSourceCode === null ? {} : { sourceCode: observedSourceCode }),
        cause: error,
      });
    }
  };

  return {
    preflight: runPreflight,
    ...(technicalResumeExecutor === null
      ? {}
      : { resumeTechnical: technicalResumeExecutor.resumeTechnical.bind(technicalResumeExecutor) }),
    async execute(
      rawRequest: ExecutionRequest,
      runOptions: FactoryPipelineRunOptions = {},
    ): Promise<FactoryExecutionResult> {
      const request = parseRequest(rawRequest);
      const identity = deriveExecutionIdentity(request);
      // This is the authoritative paid-work boundary. Decorators may expose preflight for
      // diagnostics, but every execution must pass it here before the Execution Engine runs.
      await runPreflight(
        runOptions.signal === undefined ? undefined : { signal: runOptions.signal },
      );
      let lastTimestamp = 0;
      const timestamp = (): number => {
        const observed = observe();
        if (!Number.isFinite(observed)) {
          throw new FactoryPipelineError('Fonte temporal do Factory Pipeline inválida.', {
            code: FACTORY_PIPELINE_ERROR_CODES.INTERNAL_ERROR,
            stage: 'EXECUTION',
            executionId: identity.executionId,
          });
        }
        lastTimestamp = Math.max(lastTimestamp, Math.max(0, Math.round(observed)));
        return lastTimestamp;
      };
      const startedAtMs = timestamp();
      logFactoryPipelineEvent(
        logger,
        'info',
        'factory.pipeline.started',
        factoryPipelineLogContext({
          executionId: identity.executionId,
          workflowId: request.workflowId,
          status: 'RUNNING',
        }),
      );

      let execution: ExecutionResult;
      try {
        const rawExecution = await options.executionEngine.execute(request, {
          ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
          ...(runOptions.cacheMode === undefined ? {} : { cacheMode: runOptions.cacheMode }),
          ...(runOptions.sourceExecutionId === undefined
            ? {}
            : { sourceExecutionId: runOptions.sourceExecutionId }),
        });
        const parsedExecution = executionResultSchema.safeParse(rawExecution);
        if (!parsedExecution.success) {
          throw new FactoryPipelineError('O Execution Engine retornou um contrato inválido.', {
            code: FACTORY_PIPELINE_ERROR_CODES.CONTRACT_VIOLATION,
            stage: 'EXECUTION',
            executionId: identity.executionId,
            cause: parsedExecution.error,
          });
        }
        execution = immutableClone(parsedExecution.data);
      } catch (error) {
        const terminalResult =
          error !== null && typeof error === 'object'
            ? (error as { result?: unknown }).result
            : undefined;
        if (terminalResult !== undefined) {
          const parsedTerminal = executionResultSchema.safeParse(terminalResult);
          if (parsedTerminal.success) {
            execution = immutableClone(parsedTerminal.data);
          } else {
            throw new FactoryPipelineError(
              'O Execution Engine anexou um resultado terminal inválido.',
              {
                code: FACTORY_PIPELINE_ERROR_CODES.CONTRACT_VIOLATION,
                stage: 'EXECUTION',
                executionId: identity.executionId,
                cause: parsedTerminal.error,
              },
            );
          }
        } else {
          if (error instanceof FactoryPipelineError) throw error;
          const observedSourceCode = sourceCode(error);
          throw new FactoryPipelineError('O Execution Engine não concluiu a execução.', {
            code: cancellationRequested(error, runOptions.signal)
              ? FACTORY_PIPELINE_ERROR_CODES.CANCELLED
              : FACTORY_PIPELINE_ERROR_CODES.EXECUTION_FAILED,
            stage: 'EXECUTION',
            executionId: identity.executionId,
            ...(observedSourceCode === null ? {} : { sourceCode: observedSourceCode }),
            cause: error,
          });
        }
      }

      if (
        execution.executionId !== identity.executionId ||
        execution.workflowId !== request.workflowId ||
        execution.hashes.executionRequestHash !== identity.executionRequestHash ||
        execution.hashes.workflowRequestHash !== identity.workflowRequestHash
      ) {
        throw new FactoryPipelineError(
          'O resultado do Execution Engine não corresponde ao request despachado.',
          {
            code: FACTORY_PIPELINE_ERROR_CODES.CONTRACT_VIOLATION,
            stage: 'EXECUTION',
            executionId: identity.executionId,
          },
        );
      }

      const ledger = createFactoryStageLedger(projectAgentStages(execution, startedAtMs));
      let primary = primaryFromExecution(execution);
      let codeGeneratorResult: CodeGeneratorAgentResult | null = null;
      let profileValidation: FactoryExecutionProfileValidation | null = null;
      let workspacePlan: WorkspacePlan | null = null;
      let workspace: WorkspaceMaterializationResult | null = null;
      let materializationCandidate: WorkspaceMaterializationResult | null = null;
      let sandbox: SandboxRunResult | null = null;
      let sandboxFallbackStatus: 'SKIPPED' | 'FAILED' | 'CANCELLED' = 'SKIPPED';
      let sandboxTerminationUnconfirmed = false;
      let releaseStatus: 'RELEASED' | 'FAILED' | 'NOT_REQUIRED' = 'NOT_REQUIRED';

      const startStage = (stage: FactoryPipelineStageId): void => {
        const observed = timestamp();
        ledger.start(stage, observed);
        logFactoryPipelineEvent(
          logger,
          'info',
          'factory.stage.started',
          factoryPipelineLogContext({
            executionId: execution.executionId,
            workflowId: execution.workflowId,
            stage,
            status: 'RUNNING',
          }),
        );
      };
      const finishStage = (
        stage: FactoryPipelineStageId,
        status: 'SUCCESS' | 'FAILED' | 'CANCELLED',
        outputHash: string | null = null,
        failure: FactoryPipelineFailure | null = null,
      ): void => {
        const observed = timestamp();
        ledger.finish(stage, status, observed, outputHash, failure);
        logFactoryPipelineEvent(
          logger,
          status === 'SUCCESS' ? 'info' : status === 'FAILED' ? 'error' : 'warn',
          status === 'SUCCESS'
            ? 'factory.stage.completed'
            : status === 'FAILED'
              ? 'factory.stage.failed'
              : 'factory.stage.cancelled',
          factoryPipelineLogContext({
            executionId: execution.executionId,
            workflowId: execution.workflowId,
            stage,
            status,
            outputHash,
            ...(failure === null ? {} : { failure }),
          }),
        );
      };

      if (primary === null) {
        startStage('CODE_GENERATOR');
        try {
          assertNotAborted(runOptions.signal, 'CODE_GENERATOR', execution.executionId);
          const generationRequest = projectExecutionToCodeGenerationRequest(
            execution,
            request,
            configuration.codeGenerator,
            configuration.executionProfile,
          );
          const rawGenerationResult = await options.codeGeneratorAgent.execute(generationRequest, {
            ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
            ...(runOptions.cacheMode === undefined ? {} : { cacheMode: runOptions.cacheMode }),
            ...(runOptions.sourceExecutionId === undefined
              ? {}
              : { sourceExecutionId: runOptions.sourceExecutionId }),
          });
          const candidate = parseCodeGeneratorBoundary(rawGenerationResult, generationRequest);
          if (candidate.outcome === 'VALIDATION_REJECTED') {
            const failure = failureFor(
              'CODE_GENERATOR',
              FACTORY_PIPELINE_ERROR_CODES.CODE_GENERATION_REJECTED,
              'O Code Generator rejeitou a saída gerada.',
            );
            finishStage('CODE_GENERATOR', 'FAILED', null, failure);
            primary = { status: 'FAILED', terminalStage: 'CODE_GENERATOR', failure };
          } else {
            assertNotAborted(runOptions.signal, 'CODE_GENERATOR', execution.executionId);
            codeGeneratorResult = candidate;
            finishStage('CODE_GENERATOR', 'SUCCESS', candidate.bundle.hashes.generationHash);
          }
        } catch (error) {
          const cancelled = cancellationRequested(error, runOptions.signal);
          const failure = failureFor(
            'CODE_GENERATOR',
            cancelled
              ? FACTORY_PIPELINE_ERROR_CODES.CANCELLED
              : error instanceof FactoryPipelineError
                ? error.code
                : FACTORY_PIPELINE_ERROR_CODES.CODE_GENERATION_FAILED,
            cancelled ? 'A geração de código foi cancelada.' : 'A geração de código falhou.',
            error,
            sourceReasonCode(error),
          );
          finishStage('CODE_GENERATOR', cancelled ? 'CANCELLED' : 'FAILED', null, failure);
          primary = {
            status: cancelled ? 'CANCELLED' : 'FAILED',
            terminalStage: 'CODE_GENERATOR',
            failure,
          };
        }
      }

      if (primary === null && codeGeneratorResult?.outcome === 'GENERATED') {
        startStage('CODE_PROFILE_VALIDATION');
        try {
          assertNotAborted(runOptions.signal, 'CODE_PROFILE_VALIDATION', execution.executionId);
          profileValidation = executionProfileValidator.validate({
            bundleHash: codeGeneratorResult.bundle.hashes.bundleHash,
            files: codeGeneratorResult.bundle.files.map((file) => ({
              path: file.path,
              content: file.content,
              mediaType: file.mediaType,
            })),
          });
          assertNotAborted(runOptions.signal, 'CODE_PROFILE_VALIDATION', execution.executionId);
          if (!profileValidation.compatible) {
            const failure = failureFor(
              'CODE_PROFILE_VALIDATION',
              FACTORY_PIPELINE_ERROR_CODES.CODE_PROFILE_VALIDATION_FAILED,
              'O bundle gerado não é compatível com o Factory Execution Profile.',
              undefined,
              profileValidation.issues[0]?.reasonCode ?? null,
              profileValidation.issues[0]?.ruleId ?? null,
            );
            finishStage(
              'CODE_PROFILE_VALIDATION',
              'FAILED',
              profileValidation.profileValidationHash,
              failure,
            );
            primary = { status: 'FAILED', terminalStage: 'CODE_PROFILE_VALIDATION', failure };
          } else {
            assertNotAborted(runOptions.signal, 'CODE_PROFILE_VALIDATION', execution.executionId);
            finishStage(
              'CODE_PROFILE_VALIDATION',
              'SUCCESS',
              profileValidation.profileValidationHash,
            );
          }
        } catch (error) {
          const cancelled = cancellationRequested(error, runOptions.signal);
          const failure = failureFor(
            'CODE_PROFILE_VALIDATION',
            cancelled
              ? FACTORY_PIPELINE_ERROR_CODES.CANCELLED
              : FACTORY_PIPELINE_ERROR_CODES.CODE_PROFILE_VALIDATION_FAILED,
            cancelled
              ? 'A validação do execution profile foi cancelada.'
              : 'O Factory Execution Profile não conseguiu validar o bundle gerado.',
            error,
          );
          finishStage('CODE_PROFILE_VALIDATION', cancelled ? 'CANCELLED' : 'FAILED', null, failure);
          primary = {
            status: cancelled ? 'CANCELLED' : 'FAILED',
            terminalStage: 'CODE_PROFILE_VALIDATION',
            failure,
          };
        }
      }

      if (primary === null && codeGeneratorResult?.outcome === 'GENERATED') {
        startStage('WORKSPACE_PLAN');
        try {
          assertNotAborted(runOptions.signal, 'WORKSPACE_PLAN', execution.executionId);
          const planRequest = projectGeneratedBundleToWorkspacePlanRequest(
            codeGeneratorResult.bundle,
          );
          workspacePlan = parseWorkspacePlanBoundary(options.workspace.plan(planRequest));
          finishStage('WORKSPACE_PLAN', 'SUCCESS', workspacePlan.metadata.planHash);
        } catch (error) {
          const cancelled = cancellationRequested(error, runOptions.signal);
          const failure = failureFor(
            'WORKSPACE_PLAN',
            cancelled
              ? FACTORY_PIPELINE_ERROR_CODES.CANCELLED
              : error instanceof FactoryPipelineError
                ? error.code
                : FACTORY_PIPELINE_ERROR_CODES.WORKSPACE_PLAN_FAILED,
            cancelled
              ? 'O planejamento do workspace foi cancelado.'
              : 'O workspace não foi planejado.',
            error,
          );
          finishStage('WORKSPACE_PLAN', cancelled ? 'CANCELLED' : 'FAILED', null, failure);
          primary = {
            status: cancelled ? 'CANCELLED' : 'FAILED',
            terminalStage: 'WORKSPACE_PLAN',
            failure,
          };
        }
      }

      if (
        primary === null &&
        codeGeneratorResult?.outcome === 'GENERATED' &&
        profileValidation?.compatible === true &&
        workspacePlan !== null &&
        runOptions.onTechnicalCheckpoint !== undefined
      ) {
        if (options.technicalBoundaryIdentity === undefined) {
          throw new FactoryPipelineError(
            'A composição não declarou as identidades exigidas pelo checkpoint técnico.',
            {
              code: FACTORY_PIPELINE_ERROR_CODES.TECHNICAL_CHECKPOINT_FAILED,
              stage: 'TECHNICAL_CHECKPOINT',
              executionId: execution.executionId,
              reasonCode: 'TECHNICAL_BOUNDARY_IDENTITY_MISSING',
            },
          );
        }
        try {
          const checkpoint = createFactoryTechnicalCheckpoint({
            requestContext: {
              ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
              ...(request.traceId === undefined ? {} : { traceId: request.traceId }),
            },
            bundle: codeGeneratorResult.bundle,
            profileValidation,
            configuration,
            boundaryIdentity: options.technicalBoundaryIdentity,
            workspacePlan,
          });
          await runOptions.onTechnicalCheckpoint(checkpoint);
        } catch (error) {
          if (error instanceof FactoryPipelineError) throw error;
          throw new FactoryPipelineError('O checkpoint técnico não pôde ser persistido.', {
            code: FACTORY_PIPELINE_ERROR_CODES.TECHNICAL_CHECKPOINT_FAILED,
            stage: 'TECHNICAL_CHECKPOINT',
            executionId: execution.executionId,
            reasonCode: 'TECHNICAL_CHECKPOINT_PERSISTENCE_FAILED',
            cause: error,
          });
        }
      }

      if (primary === null && workspacePlan !== null) {
        startStage('WORKSPACE_MATERIALIZATION');
        try {
          assertNotAborted(runOptions.signal, 'WORKSPACE_MATERIALIZATION', execution.executionId);
          materializationCandidate = await options.workspace.materialize(
            workspacePlan,
            runOptions.signal === undefined ? undefined : { signal: runOptions.signal },
          );
          workspace = parseWorkspaceMaterializationBoundary(
            materializationCandidate,
            workspacePlan,
          );
          finishStage('WORKSPACE_MATERIALIZATION', 'SUCCESS', workspace.metadata.workspaceHash);
        } catch (error) {
          if (materializationCandidate !== null && workspace === null) {
            try {
              parseWorkspaceReleaseBoundary(
                await options.workspace.release(materializationCandidate),
                materializationCandidate,
              );
              releaseStatus = 'RELEASED';
            } catch {
              // Preserve the primary boundary violation while making cleanup uncertainty fail-closed.
              releaseStatus = 'FAILED';
            }
          } else if (workspaceCleanupFailed(error)) {
            releaseStatus = 'FAILED';
          }
          const cancelled = cancellationRequested(error, runOptions.signal);
          const failure = failureFor(
            'WORKSPACE_MATERIALIZATION',
            cancelled
              ? FACTORY_PIPELINE_ERROR_CODES.CANCELLED
              : error instanceof FactoryPipelineError
                ? error.code
                : FACTORY_PIPELINE_ERROR_CODES.WORKSPACE_MATERIALIZATION_FAILED,
            cancelled ? 'A materialização foi cancelada.' : 'O workspace não foi materializado.',
            error,
          );
          finishStage(
            'WORKSPACE_MATERIALIZATION',
            cancelled ? 'CANCELLED' : 'FAILED',
            null,
            failure,
          );
          primary = {
            status: cancelled ? 'CANCELLED' : 'FAILED',
            terminalStage: 'WORKSPACE_MATERIALIZATION',
            failure,
          };
        }
      }

      if (primary === null && workspace !== null) {
        startStage('SANDBOX_PREPARE');
        try {
          assertNotAborted(runOptions.signal, 'SANDBOX_PREPARE', execution.executionId);
          const sandboxRequest = projectWorkspaceToSandboxRunRequest(
            workspace,
            execution.executionId,
            request,
            configuration.sandbox,
          );
          sandbox = parseSandboxBoundary(
            await options.sandboxRunner.run(
              sandboxRequest,
              runOptions.signal === undefined ? undefined : { signal: runOptions.signal },
            ),
            sandboxRequest,
          );
          for (const step of sandbox.steps) ledger.replace(projectSandboxStage(step));
          primary = primaryFromSandbox(sandbox);
          for (const stage of sandbox.steps.map(projectSandboxStage)) {
            logFactoryPipelineEvent(
              logger,
              stage.status === 'SUCCESS'
                ? 'info'
                : stage.status === 'CANCELLED'
                  ? 'warn'
                  : stage.status === 'SKIPPED'
                    ? 'info'
                    : 'error',
              stage.status === 'SUCCESS'
                ? 'factory.stage.completed'
                : stage.status === 'CANCELLED'
                  ? 'factory.stage.cancelled'
                  : stage.status === 'SKIPPED'
                    ? 'factory.stage.skipped'
                    : 'factory.stage.failed',
              factoryPipelineLogContext({
                executionId: execution.executionId,
                workflowId: execution.workflowId,
                stage: stage.stageId,
                status: stage.status,
                ...(stage.durationMs === null ? {} : { durationMs: stage.durationMs }),
                outputHash: stage.outputHash,
                ...(stage.failure === null ? {} : { failure: stage.failure }),
              }),
            );
          }
        } catch (error) {
          sandboxTerminationUnconfirmed = true;
          const cancelled = cancellationRequested(error, runOptions.signal);
          const failure = failureFor(
            'SANDBOX_PREPARE',
            cancelled
              ? FACTORY_PIPELINE_ERROR_CODES.CANCELLED
              : error instanceof FactoryPipelineError
                ? error.code
                : FACTORY_PIPELINE_ERROR_CODES.SANDBOX_FAILED,
            cancelled ? 'A sandbox foi cancelada.' : 'A sandbox não iniciou de forma íntegra.',
            error,
          );
          finishStage('SANDBOX_PREPARE', cancelled ? 'CANCELLED' : 'FAILED', null, failure);
          sandboxFallbackStatus = cancelled ? 'CANCELLED' : 'FAILED';
          primary = {
            status: cancelled ? 'CANCELLED' : 'FAILED',
            terminalStage: 'SANDBOX_PREPARE',
            failure,
          };
        }
      }

      if (workspace !== null) {
        startStage('WORKSPACE_RELEASE');
        try {
          parseWorkspaceReleaseBoundary(await options.workspace.release(workspace), workspace);
          releaseStatus = 'RELEASED';
          finishStage('WORKSPACE_RELEASE', 'SUCCESS', workspace.metadata.workspaceHash);
        } catch (error) {
          releaseStatus = 'FAILED';
          const releaseFailure = failureFor(
            'WORKSPACE_RELEASE',
            error instanceof FactoryPipelineError
              ? error.code
              : FACTORY_PIPELINE_ERROR_CODES.WORKSPACE_RELEASE_FAILED,
            'O workspace não foi liberado corretamente.',
            error,
          );
          finishStage('WORKSPACE_RELEASE', 'FAILED', null, releaseFailure);
          primary ??= {
            status: 'FAILED',
            terminalStage: 'WORKSPACE_RELEASE',
            failure: releaseFailure,
          };
        }
      }

      ledger.skipPending();
      const finishedAtMs = timestamp();
      const stages = ledger.result();
      const status = primary?.status ?? 'SUCCESS';
      const terminalStage = primary?.terminalStage ?? 'WORKSPACE_RELEASE';
      const failure = primary?.failure ?? null;
      const generationStage = stages.find((stage) => stage.stageId === 'CODE_GENERATOR')!;
      const planStage = stages.find((stage) => stage.stageId === 'WORKSPACE_PLAN')!;
      const materializationStage = stages.find(
        (stage) => stage.stageId === 'WORKSPACE_MATERIALIZATION',
      )!;
      const result = createFactoryExecutionResult({
        execution,
        sourceExecution: projectFactorySourceExecutionSummary(execution),
        status,
        terminalStage,
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: Math.max(0, finishedAtMs - startedAtMs),
        stages,
        agents: projectFactoryAgentsSummary(execution),
        generation: projectFactoryGenerationSummary(
          codeGeneratorResult,
          configuration.codeGenerator.agentVersion,
          generationStage.status,
        ),
        workspace: projectFactoryWorkspaceSummary({
          planStatus: planStage.status,
          materializationStatus: materializationStage.status,
          releaseStatus,
          materialization: workspace,
        }),
        sandbox: sandboxTerminationUnconfirmed
          ? projectFactorySandboxSummaryWithUnconfirmedTermination(sandbox, sandboxFallbackStatus)
          : projectFactorySandboxSummary(sandbox, sandboxFallbackStatus),
        provenance: projectFactoryPipelineProvenance({
          execution,
          codeGeneratorResult,
          codeGeneratorVersion: configuration.codeGenerator.agentVersion,
          workspace,
          sandbox,
          executionProfile: configuration.executionProfile,
          profileValidation,
        }),
        executionProfile: configuration.executionProfile,
        profileValidation,
        failure,
      });
      logFactoryPipelineEvent(
        logger,
        status === 'SUCCESS' ? 'info' : status === 'FAILED' ? 'error' : 'warn',
        status === 'SUCCESS'
          ? 'factory.pipeline.completed'
          : status === 'FAILED'
            ? 'factory.pipeline.failed'
            : 'factory.pipeline.cancelled',
        factoryPipelineLogContext({
          executionId: result.executionId,
          workflowId: result.workflowId,
          status: result.status,
          durationMs: result.durationMs,
          hashes: result.hashes,
          ...(result.failure === null ? {} : { failure: result.failure }),
        }),
      );
      return result;
    },
  };
}
