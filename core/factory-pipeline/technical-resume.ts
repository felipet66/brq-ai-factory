import { createHash } from 'node:crypto';

import {
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
  type WorkspaceMaterializationResult,
  type WorkspacePlan,
} from '@brq/controlled-workspace';
import { createFactoryExecutionProfileValidator } from '@brq/factory-execution-profile';
import {
  SANDBOX_RUNNER_ERROR_CODES,
  SandboxRunnerError,
  type SandboxRunResult,
} from '@brq/sandbox-runner';
import { identifierSchema, isoDateTimeSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import type {
  FactoryPipelineConfiguration,
  FactorySandboxSummary,
  FactoryTechnicalBoundaryIdentity,
  FactoryWorkspacePort,
} from './contracts';
import { canonicalJson } from './canonical-json';
import { immutableClone } from './immutability';
import {
  parseSandboxBoundary,
  parseWorkspaceMaterializationBoundary,
  parseWorkspacePlanBoundary,
  parseWorkspaceReleaseBoundary,
  projectFactorySandboxSummary,
  projectFactorySandboxSummaryWithUnconfirmedTermination,
  projectGeneratedBundleToWorkspacePlanRequest,
  projectWorkspaceToSandboxRunRequestFromContext,
} from './projections';
import { factoryPipelineConfigurationSchema, factorySandboxSummarySchema } from './schemas';
import {
  factoryTechnicalBoundaryIdentitySchema,
  parseFactoryTechnicalCheckpoint,
  type FactoryTechnicalCheckpoint,
} from './technical-checkpoint';
import type { SandboxRunner } from '@brq/sandbox-runner';
import { FACTORY_PIPELINE_CONTRACT_VERSION, FACTORY_PIPELINE_VERSION } from './version';

export const FACTORY_TECHNICAL_RESUME_VERSION = '1.0.0';
const RESULT_HASH_DOMAIN = 'brq-factory-pipeline:technical-resume-result:v1';
const HASH = /^[a-f0-9]{64}$/u;

function workspaceCleanupFailed(error: unknown): boolean {
  return (
    error instanceof ControlledWorkspaceError &&
    error.stage === CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP
  );
}

const technicalResumeFailureSchema = z
  .object({
    stage: z.enum([
      'CHECKPOINT_VALIDATION',
      'WORKSPACE_PLAN',
      'WORKSPACE_MATERIALIZATION',
      'SANDBOX',
      'WORKSPACE_RELEASE',
    ]),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
    message: z.string().trim().min(1).max(300),
  })
  .strict();

const technicalResumeWorkspaceSchema = z
  .object({
    planStatus: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']),
    materializationStatus: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']),
    releaseStatus: z.enum(['RELEASED', 'FAILED', 'NOT_REQUIRED']),
    workspaceId: z.string().min(1).max(128).nullable(),
    planHash: z.string().regex(HASH).nullable(),
    workspaceHash: z.string().regex(HASH).nullable(),
  })
  .strict();

const technicalResumeResultProjectionSchema = z
  .object({
    version: z.literal(FACTORY_TECHNICAL_RESUME_VERSION),
    attemptId: identifierSchema,
    checkpointHash: z.string().regex(HASH),
    sourceExecutionId: identifierSchema,
    sourceWorkflowId: identifierSchema,
    status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative(),
    workspace: technicalResumeWorkspaceSchema,
    sandbox: factorySandboxSummarySchema,
    hashes: z
      .object({
        bundleHash: z.string().regex(HASH),
        profileValidationHash: z.string().regex(HASH),
        planHash: z.string().regex(HASH).nullable(),
        workspaceHash: z.string().regex(HASH).nullable(),
        sandboxRequestHash: z.string().regex(HASH).nullable(),
        sandboxResultHash: z.string().regex(HASH).nullable(),
      })
      .strict(),
    failure: technicalResumeFailureSchema.nullable(),
  })
  .strict();

export const factoryTechnicalResumeResultSchema = technicalResumeResultProjectionSchema
  .extend({ resultHash: z.string().regex(HASH) })
  .strict()
  .superRefine((result, context) => {
    const { resultHash, ...projection } = result;
    if (resultHash !== calculateTechnicalResumeResultHash(projection)) {
      context.addIssue({
        code: 'custom',
        path: ['resultHash'],
        message: 'resultHash não corresponde ao resultado canônico.',
      });
    }
    if ((result.status === 'SUCCESS') !== (result.failure === null)) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Somente SUCCESS pode terminar sem falha.',
      });
    }
    if (Date.parse(result.finishedAt) < Date.parse(result.startedAt)) {
      context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'Término inválido.' });
    }
    if (
      (result.workspace.planStatus === 'SUCCESS') !== (result.hashes.planHash !== null) ||
      result.workspace.planHash !== result.hashes.planHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['workspace', 'planHash'],
        message: 'O hash do plano deve corresponder ao status e ao ledger de hashes.',
      });
    }
    const materialized = result.workspace.materializationStatus === 'SUCCESS';
    if (
      materialized !== (result.workspace.workspaceId !== null) ||
      materialized !== (result.hashes.workspaceHash !== null) ||
      result.workspace.workspaceHash !== result.hashes.workspaceHash ||
      (materialized && result.workspace.planStatus !== 'SUCCESS') ||
      (result.workspace.materializationStatus === 'SKIPPED' &&
        result.workspace.releaseStatus !== 'NOT_REQUIRED')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['workspace'],
        message: 'A materialização, seus hashes e o cleanup devem estar correlacionados.',
      });
    }
    if (materialized && result.workspace.releaseStatus === 'NOT_REQUIRED') {
      context.addIssue({
        code: 'custom',
        path: ['workspace', 'releaseStatus'],
        message: 'Um workspace materializado exige resultado explícito de release.',
      });
    }
    const sandboxExecuted = result.sandbox.sandboxRunId !== null;
    if (
      sandboxExecuted !== (result.sandbox.hashes !== null) ||
      sandboxExecuted !== (result.hashes.sandboxRequestHash !== null) ||
      sandboxExecuted !== (result.hashes.sandboxResultHash !== null) ||
      (result.sandbox.hashes?.sandboxRequestHash ?? null) !== result.hashes.sandboxRequestHash ||
      (result.sandbox.hashes?.sandboxResultHash ?? null) !== result.hashes.sandboxResultHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sandbox'],
        message: 'A execução da Sandbox e seus hashes devem estar correlacionados.',
      });
    }
    if (
      result.status === 'SUCCESS' &&
      (result.workspace.planStatus !== 'SUCCESS' ||
        result.workspace.materializationStatus !== 'SUCCESS' ||
        result.workspace.releaseStatus !== 'RELEASED' ||
        result.sandbox.status !== 'SUCCESS' ||
        result.sandbox.cleanupFailure !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'SUCCESS exige workspace, Sandbox e cleanup integralmente concluídos.',
      });
    }
    if ((result.status === 'CANCELLED') !== (result.failure?.reasonCode === 'CANCELLED')) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'reasonCode'],
        message: 'CANCELLED exige reasonCode correlacionado.',
      });
    }
  });

export type FactoryTechnicalResumeResult = Readonly<
  z.infer<typeof factoryTechnicalResumeResultSchema>
>;
export interface FactoryTechnicalResumeOptions {
  readonly attemptId: string;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
}
export interface FactoryTechnicalResumeExecutor {
  resumeTechnical(
    checkpoint: FactoryTechnicalCheckpoint,
    options: FactoryTechnicalResumeOptions,
  ): Promise<FactoryTechnicalResumeResult>;
}

export class FactoryTechnicalResumeError extends Error {
  readonly code = 'FACTORY_TECHNICAL_RESUME_REJECTED';
  constructor(
    message: string,
    readonly reasonCode:
      | 'CHECKPOINT_INVALID'
      | 'CHECKPOINT_PIPELINE_DRIFT'
      | 'CHECKPOINT_PROFILE_DRIFT'
      | 'CHECKPOINT_CODE_GENERATOR_DRIFT'
      | 'CHECKPOINT_WORKSPACE_DRIFT'
      | 'CHECKPOINT_SANDBOX_DRIFT'
      | 'CHECKPOINT_VALIDATION_DRIFT'
      | 'RUNTIME_PREFLIGHT_FAILED'
      | 'RUNTIME_PREFLIGHT_CLEANUP_UNCONFIRMED'
      | 'RUNTIME_CLOCK_FAILED',
    options?: { readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FactoryTechnicalResumeError';
  }
}

type ResumeProjection = z.infer<typeof technicalResumeResultProjectionSchema>;

function calculateTechnicalResumeResultHash(projection: ResumeProjection): string {
  return createHash('sha256')
    .update(`${RESULT_HASH_DOMAIN}\u0000${canonicalJson(projection)}`)
    .digest('hex');
}

function currentTime(
  now: () => number,
  reasonCode: FactoryTechnicalResumeError['reasonCode'] = 'CHECKPOINT_INVALID',
): number {
  const observed = now();
  if (!Number.isFinite(observed)) {
    throw new FactoryTechnicalResumeError(
      'Fonte temporal inválida para retomada técnica.',
      reasonCode,
    );
  }
  return Math.max(0, Math.round(observed));
}

function failure(
  stage: z.infer<typeof technicalResumeFailureSchema>['stage'],
  reasonCode: string,
  message: string,
) {
  return {
    stage,
    code: 'FACTORY_TECHNICAL_RESUME_FAILED',
    reasonCode,
    message,
  } as const;
}

function assertCheckpointConfiguration(
  checkpoint: FactoryTechnicalCheckpoint,
  configuration: FactoryPipelineConfiguration,
  boundaryIdentity: FactoryTechnicalBoundaryIdentity,
): void {
  if (
    checkpoint.pipeline.version !== FACTORY_PIPELINE_VERSION ||
    checkpoint.pipeline.contractVersion !== FACTORY_PIPELINE_CONTRACT_VERSION
  ) {
    throw new FactoryTechnicalResumeError(
      'A versão do Factory Pipeline divergiu desde o checkpoint.',
      'CHECKPOINT_PIPELINE_DRIFT',
    );
  }
  if (
    checkpoint.executionProfile.profileId !== configuration.executionProfile.identity.profileId ||
    checkpoint.executionProfile.version !== configuration.executionProfile.identity.version ||
    checkpoint.executionProfile.contractVersion !==
      configuration.executionProfile.identity.contractVersion ||
    checkpoint.executionProfile.profileHash !== configuration.executionProfile.identity.profileHash
  ) {
    throw new FactoryTechnicalResumeError(
      'O Factory Execution Profile divergiu desde o checkpoint.',
      'CHECKPOINT_PROFILE_DRIFT',
    );
  }
  if (
    checkpoint.codeGenerator.agentVersion !== configuration.codeGenerator.agentVersion ||
    checkpoint.codeGenerator.assetBundleHash !== boundaryIdentity.codeGeneratorAssetBundleHash
  ) {
    throw new FactoryTechnicalResumeError(
      'A versão do Code Generator divergiu desde o checkpoint.',
      'CHECKPOINT_CODE_GENERATOR_DRIFT',
    );
  }
  if (
    checkpoint.workspace.version !== boundaryIdentity.workspace.version ||
    checkpoint.workspace.contractVersion !== boundaryIdentity.workspace.contractVersion ||
    checkpoint.workspace.policyHash !== boundaryIdentity.workspace.policyHash ||
    checkpoint.workspace.configurationHash !== boundaryIdentity.workspace.configurationHash
  ) {
    throw new FactoryTechnicalResumeError(
      'A configuração do Controlled Workspace divergiu desde o checkpoint.',
      'CHECKPOINT_WORKSPACE_DRIFT',
    );
  }
  if (
    checkpoint.sandbox.policyId !== configuration.sandbox.policyId ||
    checkpoint.sandbox.policyVersion !== configuration.sandbox.policyVersion ||
    checkpoint.sandbox.profileSnapshotHash !== configuration.sandbox.profileSnapshotHash ||
    checkpoint.sandbox.runnerVersion !== boundaryIdentity.sandbox.runnerVersion ||
    checkpoint.sandbox.contractVersion !== boundaryIdentity.sandbox.contractVersion ||
    checkpoint.sandbox.policyHash !== boundaryIdentity.sandbox.policyHash ||
    checkpoint.sandbox.commandPolicyHash !== boundaryIdentity.sandbox.commandPolicyHash ||
    checkpoint.sandbox.limitsHash !== boundaryIdentity.sandbox.limitsHash ||
    checkpoint.sandbox.imageDigest !== boundaryIdentity.sandbox.imageDigest ||
    checkpoint.sandbox.imageId !== boundaryIdentity.sandbox.imageId ||
    checkpoint.sandbox.platform !== boundaryIdentity.sandbox.platform
  ) {
    throw new FactoryTechnicalResumeError(
      'A policy da Sandbox divergiu desde o checkpoint.',
      'CHECKPOINT_SANDBOX_DRIFT',
    );
  }
  const validation = createFactoryExecutionProfileValidator(
    configuration.executionProfile,
  ).validate({
    bundleHash: checkpoint.bundle.hashes.bundleHash,
    files: checkpoint.bundle.files.map((file) => ({
      path: file.path,
      content: file.content,
      mediaType: file.mediaType,
    })),
  });
  if (
    !validation.compatible ||
    validation.profileValidationHash !== checkpoint.profileValidation.profileValidationHash ||
    canonicalJson(validation) !== canonicalJson(checkpoint.profileValidation)
  ) {
    throw new FactoryTechnicalResumeError(
      'A validação determinística do bundle divergiu do checkpoint.',
      'CHECKPOINT_VALIDATION_DRIFT',
    );
  }
}

export function createFactoryTechnicalResumeExecutor(options: {
  readonly workspace: FactoryWorkspacePort;
  readonly sandboxRunner: SandboxRunner;
  readonly configuration: FactoryPipelineConfiguration;
  readonly boundaryIdentity: FactoryTechnicalBoundaryIdentity;
  readonly now?: () => number;
}): FactoryTechnicalResumeExecutor {
  const parsedConfiguration = factoryPipelineConfigurationSchema.parse(options.configuration);
  const configuration = immutableClone(parsedConfiguration);
  const boundaryIdentity = immutableClone(
    factoryTechnicalBoundaryIdentitySchema.parse(options.boundaryIdentity),
  );
  const now = options.now ?? Date.now;
  return Object.freeze({
    async resumeTechnical(
      rawCheckpoint: FactoryTechnicalCheckpoint,
      resumeOptions: FactoryTechnicalResumeOptions,
    ): Promise<FactoryTechnicalResumeResult> {
      const parsedAttemptId = identifierSchema.safeParse(resumeOptions.attemptId);
      if (!parsedAttemptId.success) {
        throw new FactoryTechnicalResumeError(
          'Identificador da tentativa técnica inválido.',
          'CHECKPOINT_INVALID',
          { cause: parsedAttemptId.error },
        );
      }
      let checkpoint: FactoryTechnicalCheckpoint;
      try {
        checkpoint = parseFactoryTechnicalCheckpoint(rawCheckpoint);
      } catch (error) {
        throw new FactoryTechnicalResumeError(
          'Checkpoint técnico inválido ou adulterado.',
          'CHECKPOINT_INVALID',
          { cause: error },
        );
      }
      assertCheckpointConfiguration(checkpoint, configuration, boundaryIdentity);
      const startedAtMs = currentTime(now);
      if (options.sandboxRunner.preflight !== undefined) {
        try {
          await options.sandboxRunner.preflight({
            policyId: configuration.sandbox.policyId,
            ...(resumeOptions.signal === undefined ? {} : { signal: resumeOptions.signal }),
          });
        } catch (error) {
          const cleanupUnconfirmed =
            !(error instanceof SandboxRunnerError) ||
            error.code === SANDBOX_RUNNER_ERROR_CODES.CLEANUP_FAILED ||
            error.cleanupFailure !== undefined;
          throw new FactoryTechnicalResumeError(
            'O runtime físico não passou no preflight da retomada técnica.',
            cleanupUnconfirmed
              ? 'RUNTIME_PREFLIGHT_CLEANUP_UNCONFIRMED'
              : 'RUNTIME_PREFLIGHT_FAILED',
            { cause: error },
          );
        }
      }
      let plan: WorkspacePlan | null = null;
      let workspace: WorkspaceMaterializationResult | null = null;
      let materializationCandidate: WorkspaceMaterializationResult | null = null;
      let sandbox: SandboxRunResult | null = null;
      let sandboxCleanupUncertain = false;
      let observedFailure: z.infer<typeof technicalResumeFailureSchema> | null = null;
      let releaseStatus: 'RELEASED' | 'FAILED' | 'NOT_REQUIRED' = 'NOT_REQUIRED';

      if (resumeOptions.signal?.aborted) {
        observedFailure = failure('WORKSPACE_PLAN', 'CANCELLED', 'A retomada foi cancelada.');
      }
      if (observedFailure === null) {
        try {
          plan = parseWorkspacePlanBoundary(
            options.workspace.plan(projectGeneratedBundleToWorkspacePlanRequest(checkpoint.bundle)),
          );
          if (
            plan.metadata.workspaceVersion !== checkpoint.workspace.version ||
            plan.metadata.contractVersion !== checkpoint.workspace.contractVersion ||
            plan.metadata.policyHash !== checkpoint.workspace.policyHash ||
            plan.metadata.configurationHash !== checkpoint.workspace.configurationHash ||
            plan.metadata.planHash !== checkpoint.workspace.planHash
          ) {
            throw new FactoryTechnicalResumeError(
              'O plano de workspace divergiu do checkpoint técnico.',
              'CHECKPOINT_WORKSPACE_DRIFT',
            );
          }
        } catch (error) {
          if (error instanceof FactoryTechnicalResumeError) throw error;
          observedFailure = failure(
            'WORKSPACE_PLAN',
            'WORKSPACE_PLAN_FAILED',
            'O workspace não foi planejado.',
          );
        }
      }
      if (observedFailure === null && plan !== null) {
        try {
          materializationCandidate = await options.workspace.materialize(
            plan,
            resumeOptions.signal === undefined ? undefined : { signal: resumeOptions.signal },
          );
          workspace = parseWorkspaceMaterializationBoundary(materializationCandidate, plan);
        } catch (error) {
          if (materializationCandidate !== null && workspace === null) {
            try {
              parseWorkspaceReleaseBoundary(
                await options.workspace.release(materializationCandidate),
                materializationCandidate,
              );
              releaseStatus = 'RELEASED';
            } catch {
              releaseStatus = 'FAILED';
            }
          } else if (workspaceCleanupFailed(error)) {
            releaseStatus = 'FAILED';
          }
          observedFailure = failure(
            'WORKSPACE_MATERIALIZATION',
            'WORKSPACE_MATERIALIZATION_FAILED',
            'O workspace não foi materializado.',
          );
        }
      }
      if (observedFailure === null && workspace !== null) {
        try {
          const currentRequestId =
            resumeOptions.requestId ?? checkpoint.source.requestId ?? undefined;
          const request = projectWorkspaceToSandboxRunRequestFromContext(
            workspace,
            resumeOptions.attemptId,
            {
              ...(currentRequestId === undefined ? {} : { requestId: currentRequestId }),
              ...(checkpoint.source.traceId === null ? {} : { traceId: checkpoint.source.traceId }),
            },
            configuration.sandbox,
          );
          sandbox = parseSandboxBoundary(
            await options.sandboxRunner.run(
              request,
              resumeOptions.signal === undefined ? undefined : { signal: resumeOptions.signal },
            ),
            request,
          );
          if (
            sandbox.provenance.runnerVersion !== checkpoint.sandbox.runnerVersion ||
            sandbox.provenance.contractVersion !== checkpoint.sandbox.contractVersion ||
            sandbox.hashes.policyHash !== checkpoint.sandbox.policyHash ||
            sandbox.hashes.commandPolicyHash !== checkpoint.sandbox.commandPolicyHash ||
            sandbox.hashes.limitsHash !== checkpoint.sandbox.limitsHash ||
            sandbox.provenance.runtime.imageDigest !== checkpoint.sandbox.imageDigest ||
            sandbox.provenance.runtime.imageId !== checkpoint.sandbox.imageId ||
            sandbox.provenance.runtime.platform !== checkpoint.sandbox.platform
          ) {
            observedFailure = failure(
              'SANDBOX',
              'CHECKPOINT_SANDBOX_DRIFT',
              'A identidade observada da Sandbox divergiu do checkpoint técnico.',
            );
          }
          if (observedFailure === null && sandbox.cleanupFailure !== null) {
            observedFailure = failure(
              'SANDBOX',
              sandbox.cleanupFailure.code,
              'A Sandbox terminou sem confirmação íntegra do cleanup.',
            );
          } else if (observedFailure === null && sandbox.status !== 'SUCCESS') {
            observedFailure = failure(
              'SANDBOX',
              sandbox.failure?.reasonCode ?? sandbox.failure?.code ?? 'SANDBOX_FAILED',
              'A Sandbox não concluiu todas as verificações.',
            );
          }
        } catch {
          sandboxCleanupUncertain = true;
          observedFailure = failure(
            'SANDBOX',
            resumeOptions.signal?.aborted ? 'CANCELLED' : 'SANDBOX_FAILED',
            resumeOptions.signal?.aborted
              ? 'A retomada foi cancelada.'
              : 'A Sandbox não iniciou de forma íntegra.',
          );
        }
      }
      if (workspace !== null) {
        try {
          parseWorkspaceReleaseBoundary(await options.workspace.release(workspace), workspace);
          releaseStatus = 'RELEASED';
        } catch {
          releaseStatus = 'FAILED';
          observedFailure ??= failure(
            'WORKSPACE_RELEASE',
            'WORKSPACE_RELEASE_FAILED',
            'O workspace não foi liberado corretamente.',
          );
        }
      }
      const finishedAtMs = Math.max(startedAtMs, currentTime(now, 'RUNTIME_CLOCK_FAILED'));
      const status =
        observedFailure === null
          ? ('SUCCESS' as const)
          : observedFailure.reasonCode === 'CANCELLED'
            ? ('CANCELLED' as const)
            : ('FAILED' as const);
      const projectedSandboxSummary = projectFactorySandboxSummary(
        sandbox,
        observedFailure?.stage === 'SANDBOX'
          ? status === 'CANCELLED'
            ? 'CANCELLED'
            : 'FAILED'
          : 'SKIPPED',
      );
      const sandboxSummary: FactorySandboxSummary = sandboxCleanupUncertain
        ? projectFactorySandboxSummaryWithUnconfirmedTermination(
            sandbox,
            observedFailure?.reasonCode === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
          )
        : projectedSandboxSummary;
      const projection = technicalResumeResultProjectionSchema.parse({
        version: FACTORY_TECHNICAL_RESUME_VERSION,
        attemptId: resumeOptions.attemptId,
        checkpointHash: checkpoint.checkpointHash,
        sourceExecutionId: checkpoint.source.executionId,
        sourceWorkflowId: checkpoint.source.workflowId,
        status,
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - startedAtMs,
        workspace: {
          planStatus:
            plan === null
              ? observedFailure?.stage === 'WORKSPACE_PLAN'
                ? 'FAILED'
                : 'SKIPPED'
              : 'SUCCESS',
          materializationStatus:
            workspace === null
              ? observedFailure?.stage === 'WORKSPACE_MATERIALIZATION'
                ? 'FAILED'
                : 'SKIPPED'
              : 'SUCCESS',
          releaseStatus,
          workspaceId: workspace?.workspaceId ?? null,
          planHash: plan?.metadata.planHash ?? null,
          workspaceHash: workspace?.metadata.workspaceHash ?? null,
        },
        sandbox: sandboxSummary,
        hashes: {
          bundleHash: checkpoint.bundle.hashes.bundleHash,
          profileValidationHash: checkpoint.profileValidation.profileValidationHash,
          planHash: plan?.metadata.planHash ?? null,
          workspaceHash: workspace?.metadata.workspaceHash ?? null,
          sandboxRequestHash: sandbox?.hashes.sandboxRequestHash ?? null,
          sandboxResultHash: sandbox?.hashes.sandboxResultHash ?? null,
        },
        failure: observedFailure,
      });
      return immutableClone(
        factoryTechnicalResumeResultSchema.parse({
          ...projection,
          resultHash: calculateTechnicalResumeResultHash(projection),
        }),
      );
    },
  });
}
