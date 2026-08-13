import { createHash } from 'node:crypto';

import {
  calculateFactoryPipelineResultHash,
  factoryExecutionResultSchema,
  factoryTechnicalResumeResultSchema,
  type FactoryExecutionResult,
  type FactoryResultHashInput,
  type FactoryTechnicalCheckpoint,
  type FactoryTechnicalResumeResult,
} from '@brq/factory-pipeline';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';

const RESULT_HASH_DOMAIN = 'brq-factory-pipeline:technical-resume-result:v1';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function createFailedTechnicalResumeSourceResultFixture(options: {
  readonly executionId: string;
  readonly workflowId: string;
}): FactoryExecutionResult {
  const source = createFactoryExecutionResultFixture(options);
  const hashes = {
    executionHash: source.hashes.executionHash,
    workflowHash: source.hashes.workflowHash,
    generationHash: source.hashes.generationHash,
    bundleHash: source.hashes.bundleHash,
    workspacePlanHash: source.hashes.workspacePlanHash,
    workspaceHash: source.hashes.workspaceHash,
    sandboxRequestHash: source.hashes.sandboxRequestHash,
    sandboxResultHash: source.hashes.sandboxResultHash,
    lineageHash: source.hashes.lineageHash,
    provenanceHash: source.hashes.provenanceHash,
  };
  const projection: FactoryResultHashInput = {
    ...source,
    status: 'FAILED',
    terminalStage: 'SANDBOX_PREPARE',
    sandbox: {
      ...source.sandbox,
      status: 'FAILED',
      steps: source.sandbox.steps.map((step) => {
        if (step.stepId === 'PREPARE') {
          return {
            ...step,
            status: 'FAILED' as const,
            exitCode: 1,
            failure: {
              code: 'SANDBOX_STEP_FAILED',
              stage: 'PREPARE',
              sourceCode: null,
              reasonCode: 'SANDBOX_FAILED',
              diagnosticSummary: null,
              message: 'A etapa técnica falhou.',
            },
          };
        }
        return {
          ...step,
          status: 'SKIPPED' as const,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          exitCode: null,
          stdout: null,
          stderr: null,
          resourceOutcome: 'NONE' as const,
          failure: null,
        };
      }),
      cleanupFailure: null,
    },
    stages: source.stages.map((stage) => {
      if (stage.stageId === 'SANDBOX_PREPARE') {
        return {
          ...stage,
          status: 'FAILED' as const,
          failure: {
            code: 'SANDBOX_STEP_FAILED',
            stage: 'SANDBOX_PREPARE' as const,
            sourceCode: null,
            reasonCode: 'SANDBOX_FAILED',
            profileRuleId: null,
            diagnosticSummary: null,
            message: 'A etapa técnica falhou.',
          },
        };
      }
      if (
        stage.stageId === 'SANDBOX_TYPECHECK' ||
        stage.stageId === 'SANDBOX_BUILD' ||
        stage.stageId === 'SANDBOX_TEST' ||
        stage.stageId === 'WORKSPACE_RELEASE'
      ) {
        return {
          ...stage,
          status: 'SKIPPED' as const,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          outputHash: null,
          failure: null,
        };
      }
      return stage;
    }),
    hashes,
    failure: {
      code: 'SANDBOX_STEP_FAILED',
      stage: 'SANDBOX_PREPARE',
      sourceCode: null,
      reasonCode: 'SANDBOX_FAILED',
      profileRuleId: null,
      diagnosticSummary: null,
      message: 'A execução isolada falhou com cleanup confirmado.',
    },
  };
  return factoryExecutionResultSchema.parse({
    ...projection,
    hashes: {
      ...hashes,
      factoryResultHash: calculateFactoryPipelineResultHash(projection),
    },
  });
}

export function createFactoryTechnicalResumeResultFixture(options: {
  readonly checkpoint: FactoryTechnicalCheckpoint;
  readonly attemptId?: string;
  readonly checkpointHash?: string;
  readonly sourceExecutionId?: string;
  readonly sourceWorkflowId?: string;
  readonly status?: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  readonly startedAt?: string;
  readonly finishedAt?: string;
}): FactoryTechnicalResumeResult {
  const status = options.status ?? 'SUCCESS';
  const sourceExecutionId = options.sourceExecutionId ?? options.checkpoint.source.executionId;
  const sourceWorkflowId = options.sourceWorkflowId ?? options.checkpoint.source.workflowId;
  const factory = createFactoryExecutionResultFixture({
    executionId: sourceExecutionId,
    workflowId: sourceWorkflowId,
  });
  const projection = {
    version: '1.0.0' as const,
    attemptId: options.attemptId ?? 'technical-resume-123e4567-e89b-42d3-a456-426614174000',
    checkpointHash: options.checkpointHash ?? options.checkpoint.checkpointHash,
    sourceExecutionId,
    sourceWorkflowId,
    status,
    startedAt: options.startedAt ?? '2026-08-13T12:00:02.000Z',
    finishedAt: options.finishedAt ?? '2026-08-13T12:00:03.000Z',
    durationMs: 1_000,
    workspace: {
      planStatus: 'SUCCESS' as const,
      materializationStatus: 'SUCCESS' as const,
      releaseStatus: 'RELEASED' as const,
      workspaceId: factory.workspace.workspaceId,
      planHash: factory.hashes.workspacePlanHash,
      workspaceHash: factory.hashes.workspaceHash,
    },
    sandbox: factory.sandbox,
    hashes: {
      bundleHash: options.checkpoint.bundle.hashes.bundleHash,
      profileValidationHash: options.checkpoint.profileValidation.profileValidationHash,
      planHash: factory.hashes.workspacePlanHash,
      workspaceHash: factory.hashes.workspaceHash,
      sandboxRequestHash: factory.hashes.sandboxRequestHash,
      sandboxResultHash: factory.hashes.sandboxResultHash,
    },
    failure:
      status === 'SUCCESS'
        ? null
        : {
            stage: 'SANDBOX' as const,
            code: 'FACTORY_TECHNICAL_RESUME_FAILED',
            reasonCode: status === 'CANCELLED' ? 'CANCELLED' : 'SANDBOX_FAILED',
            message: 'A retomada técnica não concluiu.',
          },
  };
  const resultHash = createHash('sha256')
    .update(`${RESULT_HASH_DOMAIN}\u0000${JSON.stringify(canonicalize(projection))}`)
    .digest('hex');
  return factoryTechnicalResumeResultSchema.parse({ ...projection, resultHash });
}
