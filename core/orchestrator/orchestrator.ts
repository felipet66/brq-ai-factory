import {
  DEVELOPER_AGENT_ERROR_CODES,
  DeveloperAgentError,
  developerAgentResultSchema,
  type DeveloperAgentResult,
} from '@brq/developer-agent';
import {
  PRODUCT_OWNER_AGENT_ERROR_CODES,
  ProductOwnerAgentError,
  productOwnerAgentResultSchema,
  type ProductOwnerAgentResult,
} from '@brq/product-owner-agent';
import {
  QA_AGENT_ERROR_CODES,
  QAAgentError,
  qaAgentResultSchema,
  type QAAgentResult,
} from '@brq/qa-agent';
import { createLogger } from '@brq/shared/logger/logger';

import {
  createDeveloperRequest,
  createProductOwnerRequest,
  createQARequest,
} from './agent-request-factory';
import type {
  CreateOrchestratorOptions,
  Orchestrator,
  OrchestratorExecutionOptions,
  WorkflowAgentResults,
  WorkflowFailure,
  WorkflowLineage,
  WorkflowProvenance,
  WorkflowRequest,
  WorkflowResult,
  WorkflowStage,
  WorkflowStatus,
  WorkflowTimelineEvent,
} from './contracts';
import { ORCHESTRATOR_ERROR_CODES, OrchestratorError, type OrchestratorErrorCode } from './errors';
import { calculateCanonicalJsonHash, calculateKnowledgeHash } from './hashing';
import { workflowLogContext } from './logging';
import type { StageDurations } from './metrics';
import { createStageProvenance, createWorkflowProvenance } from './provenance';
import { workflowRequestSchema } from './schemas';
import { transitionWorkflowState } from './state-machine';
import { createWorkflowLineage, createWorkflowResult } from './workflow-result';

type AgentName = 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';
type FailureKind = WorkflowFailure['kind'];

class StageBoundaryError extends Error {
  readonly kind: FailureKind;
  readonly code: OrchestratorErrorCode;
  readonly sourceCode: string | null;

  constructor(
    message: string,
    options: {
      readonly kind: FailureKind;
      readonly code: OrchestratorErrorCode;
      readonly sourceCode?: string;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'StageBoundaryError';
    this.kind = options.kind;
    this.code = options.code;
    this.sourceCode = options.sourceCode ?? null;
  }
}

function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}

function agentForStage(stage: WorkflowStage): AgentName | null {
  if (stage === 'PRODUCT_OWNER' || stage === 'DEVELOPER' || stage === 'QA') return stage;
  return null;
}

function stageErrorCode(stage: WorkflowStage): OrchestratorErrorCode {
  if (stage === 'PRODUCT_OWNER') return ORCHESTRATOR_ERROR_CODES.PRODUCT_OWNER_FAILED;
  if (stage === 'DEVELOPER') return ORCHESTRATOR_ERROR_CODES.DEVELOPER_FAILED;
  if (stage === 'QA') return ORCHESTRATOR_ERROR_CODES.QA_FAILED;
  return ORCHESTRATOR_ERROR_CODES.INTERNAL_ERROR;
}

function isAgentCancellation(error: unknown): boolean {
  return (
    (error instanceof ProductOwnerAgentError &&
      error.code === PRODUCT_OWNER_AGENT_ERROR_CODES.CANCELLED) ||
    (error instanceof DeveloperAgentError &&
      error.code === DEVELOPER_AGENT_ERROR_CODES.CANCELLED) ||
    (error instanceof QAAgentError && error.code === QA_AGENT_ERROR_CODES.CANCELLED)
  );
}

function agentSourceCode(error: unknown): string | null {
  if (
    error instanceof ProductOwnerAgentError ||
    error instanceof DeveloperAgentError ||
    error instanceof QAAgentError
  ) {
    return error.code;
  }
  return null;
}

function assertDependencies(options: CreateOrchestratorOptions): void {
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
    typeof options.productOwnerAgent?.execute !== 'function' ||
    typeof options.developerAgent?.execute !== 'function' ||
    typeof options.qaAgent?.execute !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function') ||
    !validLogger
  ) {
    throw new OrchestratorError('Configuração do Orchestrator inválida.', {
      code: ORCHESTRATOR_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'INITIALIZATION',
      durationMs: 0,
    });
  }
}

function assertContextCorrelation(
  result: ProductOwnerAgentResult | DeveloperAgentResult | QAAgentResult,
  expected: {
    readonly executionId: string;
    readonly agentExecutionId: string;
    readonly attempt: number;
    readonly agentVersion: string;
    readonly requestId?: string | undefined;
    readonly traceId?: string | undefined;
  },
): void {
  const actual = result.context;
  if (
    actual.executionId !== expected.executionId ||
    actual.agentExecutionId !== expected.agentExecutionId ||
    actual.attempt !== expected.attempt ||
    actual.agentVersion !== expected.agentVersion ||
    actual.requestId !== expected.requestId ||
    actual.traceId !== expected.traceId
  ) {
    throw new StageBoundaryError('O resultado do agente não corresponde à requisição da etapa.', {
      kind: 'CONTRACT_VIOLATION',
      code: ORCHESTRATOR_ERROR_CODES.CONTRACT_VIOLATION,
    });
  }
}

function parseProductOwnerResult(value: unknown): ProductOwnerAgentResult {
  const result = productOwnerAgentResultSchema.safeParse(value);
  if (!result.success) {
    throw new StageBoundaryError('O Product Owner Agent retornou um contrato inválido.', {
      kind: 'CONTRACT_VIOLATION',
      code: ORCHESTRATOR_ERROR_CODES.CONTRACT_VIOLATION,
      cause: result.error,
    });
  }
  return result.data;
}

function parseDeveloperResult(value: unknown): DeveloperAgentResult {
  const result = developerAgentResultSchema.safeParse(value);
  if (!result.success) {
    throw new StageBoundaryError('O Developer Agent retornou um contrato inválido.', {
      kind: 'CONTRACT_VIOLATION',
      code: ORCHESTRATOR_ERROR_CODES.CONTRACT_VIOLATION,
      cause: result.error,
    });
  }
  return result.data;
}

function parseQAResult(value: unknown): QAAgentResult {
  const result = qaAgentResultSchema.safeParse(value);
  if (!result.success) {
    throw new StageBoundaryError('O QA Agent retornou um contrato inválido.', {
      kind: 'CONTRACT_VIOLATION',
      code: ORCHESTRATOR_ERROR_CODES.CONTRACT_VIOLATION,
      cause: result.error,
    });
  }
  return result.data;
}

export function createOrchestrator(options: CreateOrchestratorOptions): Orchestrator {
  assertDependencies(options);
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());

  return {
    async execute(
      rawRequest: WorkflowRequest,
      executionOptions: OrchestratorExecutionOptions = {},
    ): Promise<WorkflowResult> {
      const parsedRequest = workflowRequestSchema.safeParse(rawRequest);
      if (!parsedRequest.success) {
        throw new OrchestratorError('WorkflowRequest inválido.', {
          code: ORCHESTRATOR_ERROR_CODES.INVALID_REQUEST,
          stage: 'INITIALIZATION',
          durationMs: 0,
          cause: parsedRequest.error,
        });
      }
      const request = parsedRequest.data;
      let lastTimestamp = 0;
      const timestamp = (): number => {
        const observed = now();
        if (!Number.isFinite(observed)) {
          throw new StageBoundaryError('A fonte temporal do Orchestrator é inválida.', {
            kind: 'CONTRACT_VIOLATION',
            code: ORCHESTRATOR_ERROR_CODES.INTERNAL_ERROR,
          });
        }
        lastTimestamp = Math.max(lastTimestamp, Math.max(0, Math.round(observed)));
        return lastTimestamp;
      };

      const workflowStartedAt = timestamp();
      const requestHash = calculateCanonicalJsonHash(request);
      const timeline: WorkflowTimelineEvent[] = [];
      const addTimeline = (
        event: WorkflowTimelineEvent['event'],
        stage: WorkflowStage,
        agent: AgentName | null,
        at: number,
        durationMs: number | null = null,
      ): void => {
        timeline.push({
          sequence: timeline.length + 1,
          event,
          stage,
          agent,
          timestampMs: at,
          durationMs,
        });
      };

      let state: WorkflowStatus = 'CREATED';
      let currentStage: WorkflowStage = 'INITIALIZATION';
      let currentStageStartedAt: number | null = null;
      const completedStages: WorkflowStage[] = [];
      let productOwner: ProductOwnerAgentResult | null = null;
      let developer: DeveloperAgentResult | null = null;
      let qa: QAAgentResult | null = null;
      const provenanceStages: WorkflowProvenance['stages'][number][] = [];
      const stageDurations: StageDurations = {
        productOwner: null,
        developer: null,
        qa: null,
        finalization: null,
      };
      const stageHashes = { productOwner: null, developer: null, qa: null } as {
        productOwner: string | null;
        developer: string | null;
        qa: string | null;
      };

      const results = (): WorkflowAgentResults => ({ productOwner, developer, qa });
      const provenance = (): WorkflowProvenance => createWorkflowProvenance(provenanceStages);
      const startStage = (stage: WorkflowStage): number => {
        currentStage = stage;
        currentStageStartedAt = timestamp();
        const agent = agentForStage(stage);
        addTimeline('STAGE_STARTED', stage, agent, currentStageStartedAt);
        logger.info(
          'workflow.stage.started',
          workflowLogContext(request.workflowId, request.executionId, stage, {
            ...(agent === null ? {} : { agent }),
          }),
        );
        return currentStageStartedAt;
      };
      const assertNotAborted = (stage: WorkflowStage): void => {
        if (!executionOptions.signal?.aborted) return;
        currentStage = stage;
        throw new StageBoundaryError('O workflow foi cancelado.', {
          kind: 'CANCELLED',
          code: ORCHESTRATOR_ERROR_CODES.CANCELLED,
        });
      };
      const completeStage = (
        stage: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA',
        result: ProductOwnerAgentResult | DeveloperAgentResult | QAAgentResult,
        startedAt: number,
      ): { duration: number; stageHash: string } => {
        const endedAt = timestamp();
        const duration = elapsed(startedAt, endedAt);
        const stageProvenance = createStageProvenance(stage, result);
        provenanceStages.push(stageProvenance);
        const specificationHash =
          result.outcome === 'GENERATED' ? calculateKnowledgeHash(result.specification) : null;
        const stageHash = calculateCanonicalJsonHash({
          stage,
          provenance: stageProvenance,
          specificationHash,
        });
        addTimeline(
          result.outcome === 'GENERATED' ? 'STAGE_COMPLETED' : 'STAGE_REJECTED',
          stage,
          stage,
          endedAt,
          duration,
        );
        completedStages.push(stage);
        currentStageStartedAt = null;
        logger[result.outcome === 'GENERATED' ? 'info' : 'warn'](
          result.outcome === 'GENERATED' ? 'workflow.stage.completed' : 'workflow.stage.rejected',
          workflowLogContext(request.workflowId, request.executionId, stage, {
            agent: stage,
            durationMs: duration,
            hashes: {
              stageHashes: {
                productOwner: stage === 'PRODUCT_OWNER' ? stageHash : null,
                developer: stage === 'DEVELOPER' ? stageHash : null,
                qa: stage === 'QA' ? stageHash : null,
              },
            },
          }),
        );
        return { duration, stageHash };
      };
      const functionalFailure = (
        stage: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA',
        sourceCode: string,
      ): WorkflowResult => {
        const endedAt = timestamp();
        addTimeline('WORKFLOW_FAILED', stage, stage, endedAt, elapsed(workflowStartedAt, endedAt));
        state = transitionWorkflowState(state, 'FAILED');
        const failure: WorkflowFailure = {
          kind: 'VALIDATION_REJECTED',
          stage,
          agent: stage,
          code: stageErrorCode(stage),
          sourceCode,
          message: 'O workflow foi interrompido por rejeição funcional de uma etapa.',
        };
        const lineage = createWorkflowLineage(results());
        const result = createWorkflowResult({
          workflowId: request.workflowId,
          executionId: request.executionId,
          requestHash,
          status: 'FAILED',
          terminalStage: stage,
          completedStages,
          results: results(),
          timeline,
          lineage,
          provenance: provenance(),
          stageHashes,
          stageDurations,
          totalDurationMs: elapsed(workflowStartedAt, endedAt),
          failure,
        });
        logger.warn(
          'workflow.failed',
          workflowLogContext(request.workflowId, request.executionId, stage, {
            agent: stage,
            durationMs: result.metrics.observed.totalDurationMs,
            hashes: result.hashes,
            metrics: result.metrics,
            failure,
          }),
        );
        return result;
      };

      addTimeline('WORKFLOW_STARTED', 'INITIALIZATION', null, workflowStartedAt);
      logger.info(
        'workflow.started',
        workflowLogContext(request.workflowId, request.executionId, 'INITIALIZATION'),
      );

      try {
        assertNotAborted('INITIALIZATION');
        state = transitionWorkflowState(state, 'RUNNING');

        const productOwnerStartedAt = startStage('PRODUCT_OWNER');
        const productOwnerRequest = createProductOwnerRequest(request);
        const productOwnerResult = parseProductOwnerResult(
          await options.productOwnerAgent.execute(
            productOwnerRequest,
            executionOptions.signal === undefined ? {} : { signal: executionOptions.signal },
          ),
        );
        assertContextCorrelation(productOwnerResult, productOwnerRequest.context);
        productOwner = productOwnerResult;
        const productOwnerCompletion = completeStage(
          'PRODUCT_OWNER',
          productOwnerResult,
          productOwnerStartedAt,
        );
        stageDurations.productOwner = productOwnerCompletion.duration;
        stageHashes.productOwner = productOwnerCompletion.stageHash;
        if (productOwnerResult.outcome === 'VALIDATION_REJECTED') {
          return functionalFailure('PRODUCT_OWNER', productOwnerResult.rejectedAt);
        }

        assertNotAborted('DEVELOPER');
        const developerStartedAt = startStage('DEVELOPER');
        const developerRequest = createDeveloperRequest(request, productOwnerResult.specification);
        const developerResult = parseDeveloperResult(
          await options.developerAgent.execute(
            developerRequest,
            executionOptions.signal === undefined ? {} : { signal: executionOptions.signal },
          ),
        );
        assertContextCorrelation(developerResult, developerRequest.context);
        const productOwnerSpecificationHash = calculateKnowledgeHash(
          productOwnerResult.specification,
        );
        if (developerResult.metadata.sourceSpecificationHash !== productOwnerSpecificationHash) {
          throw new StageBoundaryError('A linhagem Product Owner → Developer é incompatível.', {
            kind: 'LINEAGE_MISMATCH',
            code: ORCHESTRATOR_ERROR_CODES.LINEAGE_MISMATCH,
          });
        }
        developer = developerResult;
        const developerCompletion = completeStage('DEVELOPER', developerResult, developerStartedAt);
        stageDurations.developer = developerCompletion.duration;
        stageHashes.developer = developerCompletion.stageHash;
        if (developerResult.outcome === 'VALIDATION_REJECTED') {
          return functionalFailure('DEVELOPER', developerResult.rejectedAt);
        }

        assertNotAborted('QA');
        const qaStartedAt = startStage('QA');
        const qaRequest = createQARequest(
          request,
          productOwnerResult.specification,
          developerResult.specification,
        );
        const qaResult = parseQAResult(
          await options.qaAgent.execute(
            qaRequest,
            executionOptions.signal === undefined ? {} : { signal: executionOptions.signal },
          ),
        );
        assertContextCorrelation(qaResult, qaRequest.context);
        const technicalSpecificationHash = calculateKnowledgeHash(developerResult.specification);
        if (
          qaResult.metadata.productOwnerSpecificationHash !== productOwnerSpecificationHash ||
          qaResult.metadata.technicalSpecificationHash !== technicalSpecificationHash
        ) {
          throw new StageBoundaryError('A linhagem de entrada do QA Agent é incompatível.', {
            kind: 'LINEAGE_MISMATCH',
            code: ORCHESTRATOR_ERROR_CODES.LINEAGE_MISMATCH,
          });
        }
        qa = qaResult;
        const qaCompletion = completeStage('QA', qaResult, qaStartedAt);
        stageDurations.qa = qaCompletion.duration;
        stageHashes.qa = qaCompletion.stageHash;
        if (qaResult.outcome === 'VALIDATION_REJECTED') {
          return functionalFailure('QA', qaResult.rejectedAt);
        }

        assertNotAborted('FINALIZATION');
        const finalizationStartedAt = startStage('FINALIZATION');
        const lineage: WorkflowLineage = createWorkflowLineage(results());
        const finalizationEndedAt = timestamp();
        stageDurations.finalization = elapsed(finalizationStartedAt, finalizationEndedAt);
        addTimeline(
          'STAGE_COMPLETED',
          'FINALIZATION',
          null,
          finalizationEndedAt,
          stageDurations.finalization,
        );
        completedStages.push('FINALIZATION');
        currentStageStartedAt = null;
        addTimeline(
          'WORKFLOW_COMPLETED',
          'FINALIZATION',
          null,
          finalizationEndedAt,
          elapsed(workflowStartedAt, finalizationEndedAt),
        );
        state = transitionWorkflowState(state, 'SUCCESS');
        const result = createWorkflowResult({
          workflowId: request.workflowId,
          executionId: request.executionId,
          requestHash,
          status: 'SUCCESS',
          terminalStage: 'FINALIZATION',
          completedStages,
          results: results(),
          timeline,
          lineage,
          provenance: provenance(),
          stageHashes,
          stageDurations,
          totalDurationMs: elapsed(workflowStartedAt, finalizationEndedAt),
          failure: null,
        });
        logger.info(
          'workflow.stage.completed',
          workflowLogContext(request.workflowId, request.executionId, 'FINALIZATION', {
            durationMs: stageDurations.finalization,
          }),
        );
        logger.info(
          'workflow.completed',
          workflowLogContext(request.workflowId, request.executionId, 'FINALIZATION', {
            durationMs: result.metrics.observed.totalDurationMs,
            hashes: result.hashes,
            metrics: result.metrics,
          }),
        );
        return result;
      } catch (error) {
        const endedAt = timestamp();
        const failureStage = currentStage as WorkflowStage;
        const cancelled =
          executionOptions.signal?.aborted ||
          isAgentCancellation(error) ||
          (error instanceof StageBoundaryError && error.kind === 'CANCELLED');
        const status = cancelled ? 'CANCELLED' : 'FAILED';
        const kind: FailureKind = cancelled
          ? 'CANCELLED'
          : error instanceof StageBoundaryError
            ? error.kind
            : 'AGENT_ERROR';
        const code = cancelled
          ? ORCHESTRATOR_ERROR_CODES.CANCELLED
          : error instanceof StageBoundaryError
            ? error.code
            : stageErrorCode(failureStage);
        const sourceCode =
          error instanceof StageBoundaryError ? error.sourceCode : agentSourceCode(error);
        const agent = agentForStage(failureStage);
        if (currentStageStartedAt !== null) {
          const duration = elapsed(currentStageStartedAt, endedAt);
          if (failureStage === 'PRODUCT_OWNER') stageDurations.productOwner = duration;
          if (failureStage === 'DEVELOPER') stageDurations.developer = duration;
          if (failureStage === 'QA') stageDurations.qa = duration;
          if (failureStage === 'FINALIZATION') stageDurations.finalization = duration;
          addTimeline(
            cancelled ? 'STAGE_CANCELLED' : 'STAGE_FAILED',
            failureStage,
            agent,
            endedAt,
            duration,
          );
        }
        addTimeline(
          cancelled ? 'WORKFLOW_CANCELLED' : 'WORKFLOW_FAILED',
          failureStage,
          agent,
          endedAt,
          elapsed(workflowStartedAt, endedAt),
        );
        state = transitionWorkflowState(state, status);
        const failure: WorkflowFailure = {
          kind,
          stage: failureStage,
          agent,
          code,
          sourceCode,
          message: cancelled
            ? 'O workflow foi cancelado.'
            : 'O workflow foi interrompido por uma falha sanitizada.',
        };
        const lineage = createWorkflowLineage(results());
        const result = createWorkflowResult({
          workflowId: request.workflowId,
          executionId: request.executionId,
          requestHash,
          status,
          terminalStage: failureStage,
          completedStages,
          results: results(),
          timeline,
          lineage,
          provenance: provenance(),
          stageHashes,
          stageDurations,
          totalDurationMs: elapsed(workflowStartedAt, endedAt),
          failure,
        });
        logger[cancelled ? 'warn' : 'error'](
          cancelled ? 'workflow.cancelled' : 'workflow.failed',
          workflowLogContext(request.workflowId, request.executionId, failureStage, {
            ...(agent === null ? {} : { agent }),
            durationMs: result.metrics.observed.totalDurationMs,
            hashes: result.hashes,
            metrics: result.metrics,
            failure,
          }),
        );
        throw new OrchestratorError(
          cancelled ? 'Workflow cancelado.' : 'Falha durante a execução do workflow.',
          {
            code,
            stage: failureStage,
            durationMs: result.metrics.observed.totalDurationMs,
            workflowId: request.workflowId,
            executionId: request.executionId,
            ...(sourceCode === null ? {} : { sourceCode }),
            result,
            cause: error,
          },
        );
      }
    },
  };
}
